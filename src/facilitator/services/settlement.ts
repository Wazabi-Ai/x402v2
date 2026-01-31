/**
 * Settlement Service
 *
 * Handles payment settlement with 0.5% fee collection.
 *
 * Supports two modes:
 *   1. Registered agents — identified by handle (e.g., "molty" or "molty.wazabi-x402")
 *   2. Unregistered users — identified by raw Ethereum address (e.g., "0x...")
 *
 * Registration is NOT required. Any valid Ethereum address can use /settle and /verify.
 * Registered agents get additional benefits (handles, gasless UX, history tracking).
 */

import { randomUUID } from 'crypto';
import type { InMemoryStore } from '../db/schema.js';
import type { Transaction, SettleRequest, SettleResponse } from '../types.js';
import {
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  calculateFee,
  calculateNet,
  toFullHandle,
  isFullHandle,
  isAddress,
} from '../types.js';
import { WAZABI_TREASURY } from './wallet.js';

// ============================================================================
// Settlement Service
// ============================================================================

export class SettlementService {
  private readonly store: InMemoryStore;

  constructor(store: InMemoryStore) {
    this.store = store;
  }

  /**
   * Execute a payment settlement with 0.5% fee
   *
   * Accepts both registered handles and raw wallet addresses as sender/recipient.
   * Registration is optional — unregistered addresses are treated as pass-through.
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const { from, to, amount, token, network } = request;

    // Resolve sender: try registered agent first, fall back to raw address
    let fromIdentifier: string;
    let fromAddress: string;

    if (isAddress(from)) {
      // Raw address — check if registered, but don't require it
      const sender = await this.store.getAgentByWallet(from);
      fromIdentifier = sender?.full_handle ?? from;
      fromAddress = from;
    } else {
      // Handle — must be registered
      const sender = await this.store.getAgentByHandle(from);
      if (!sender) {
        throw new SettlementError(
          `Handle "${from}" not found. Use a raw wallet address or register first at POST /register.`,
          'HANDLE_NOT_FOUND'
        );
      }
      fromIdentifier = sender.full_handle;
      fromAddress = sender.wallet_address;
    }

    // Resolve recipient: try registered agent first, fall back to raw address
    let toAddress: string;
    let toIdentifier: string;
    if (isAddress(to)) {
      const recipient = await this.store.getAgentByWallet(to);
      toAddress = to;
      toIdentifier = recipient?.full_handle ?? to;
    } else {
      const recipient = await this.store.getAgentByHandle(to);
      if (!recipient) {
        throw new SettlementError(
          `Recipient handle "${to}" not found. Use a raw wallet address or register the handle first.`,
          'HANDLE_NOT_FOUND'
        );
      }
      toAddress = recipient.wallet_address;
      toIdentifier = recipient.full_handle;
    }

    // Calculate fees
    const fee = calculateFee(amount);
    const estimatedGas = '0.02'; // Estimated gas cost in token units
    const net = calculateNet(amount, fee, estimatedGas);

    if (parseFloat(net) <= 0) {
      throw new SettlementError(
        `Amount too small. After fee ($${fee}) and gas ($${estimatedGas}), net would be $${net}.`,
        'AMOUNT_TOO_SMALL'
      );
    }

    // Create transaction record
    const transaction: Transaction = {
      id: randomUUID(),
      from_handle: fromIdentifier,
      to_address: toAddress,
      amount,
      token,
      network,
      fee,
      gas_cost: estimatedGas,
      tx_hash: null,
      status: 'pending',
      created_at: new Date(),
    };

    await this.store.createTransaction(transaction);

    // In production:
    // For registered agents (ERC-4337):
    //   1. Build UserOp with batch execute
    //   2. Set paymaster data (gas paid in token)
    //   3. Sign with session key
    //   4. Submit to bundler
    // For unregistered users (standard EOA):
    //   1. Verify EIP-712 signature from the x402 payment header
    //   2. Submit standard ERC-20 transfer

    // Simulate successful settlement
    const simulatedTxHash = `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 32)}`;

    await this.store.updateTransactionStatus(
      transaction.id,
      'confirmed',
      simulatedTxHash
    );

    return {
      success: true,
      tx_hash: simulatedTxHash,
      settlement: {
        gross: amount,
        fee,
        gas: estimatedGas,
        net,
      },
      from: fromIdentifier,
      to: toIdentifier,
      network,
    };
  }

  /**
   * Verify a payment (x402 standard verification + optional balance check)
   *
   * Works with both registered handles and raw addresses.
   * For registered agents, also checks on-chain balance sufficiency.
   * For raw addresses, verifies the address format and returns valid.
   */
  async verifyPayment(params: {
    from: string;
    amount: string;
    token: string;
    network: string;
  }): Promise<{
    valid: boolean;
    signer?: string;
    registered?: boolean;
    error?: string;
    balanceSufficient?: boolean;
  }> {
    const { from, amount, token, network } = params;

    if (isAddress(from)) {
      // Raw address — valid without registration
      const sender = await this.store.getAgentByWallet(from);
      if (sender) {
        // Registered agent — include balance check
        const balances = await this.store.getBalances(sender.id);
        const tokenBalance = balances.find(
          b => b.network === network && b.token === token
        );
        const balance = parseFloat(tokenBalance?.balance ?? '0');
        const required = parseFloat(amount) * (1 + SETTLEMENT_FEE_RATE);
        return {
          valid: true,
          signer: from,
          registered: true,
          balanceSufficient: balance >= required,
        };
      }
      // Unregistered address — valid, no balance info available
      return {
        valid: true,
        signer: from,
        registered: false,
      };
    }

    // Handle — must be registered
    const sender = await this.store.getAgentByHandle(from);
    if (!sender) {
      return { valid: false, error: `Handle "${from}" not found` };
    }

    const balances = await this.store.getBalances(sender.id);
    const tokenBalance = balances.find(
      b => b.network === network && b.token === token
    );
    const balance = parseFloat(tokenBalance?.balance ?? '0');
    const required = parseFloat(amount) * (1 + SETTLEMENT_FEE_RATE);

    return {
      valid: true,
      signer: sender.wallet_address,
      registered: true,
      balanceSufficient: balance >= required,
    };
  }

  /**
   * Get transaction history for a handle or address
   */
  async getHistory(
    handleOrAddress: string,
    limit: number = 20,
    offset: number = 0
  ) {
    // Try to resolve as handle first, then as address
    let agent = await this.store.getAgentByHandle(handleOrAddress);
    if (!agent && isAddress(handleOrAddress)) {
      agent = await this.store.getAgentByWallet(handleOrAddress);
    }

    // For registered agents, return full history
    if (agent) {
      const identifier = agent.full_handle;
      const { transactions, total } = await this.store.getTransactionsByHandle(
        handleOrAddress,
        limit,
        offset
      );

      return {
        handle: identifier,
        transactions: transactions.map(tx => ({
          type: tx.from_handle === identifier
            ? 'payment_sent' as const
            : 'payment_received' as const,
          amount: tx.amount,
          token: tx.token,
          fee: tx.fee,
          gas: tx.gas_cost,
          to: tx.to_address,
          from: tx.from_handle,
          tx_hash: tx.tx_hash ?? '',
          network: tx.network,
          timestamp: tx.created_at.toISOString(),
        })),
        pagination: {
          limit,
          offset,
          total,
        },
      };
    }

    // For unregistered addresses, search by from_handle (stored as raw address)
    if (isAddress(handleOrAddress)) {
      const { transactions, total } = await this.store.getTransactionsByHandle(
        handleOrAddress,
        limit,
        offset
      );

      return {
        address: handleOrAddress,
        transactions: transactions.map(tx => ({
          type: tx.from_handle === handleOrAddress
            ? 'payment_sent' as const
            : 'payment_received' as const,
          amount: tx.amount,
          token: tx.token,
          fee: tx.fee,
          gas: tx.gas_cost,
          to: tx.to_address,
          from: tx.from_handle,
          tx_hash: tx.tx_hash ?? '',
          network: tx.network,
          timestamp: tx.created_at.toISOString(),
        })),
        pagination: {
          limit,
          offset,
          total,
        },
      };
    }

    throw new SettlementError(
      `"${handleOrAddress}" not found. Provide a registered handle or a valid wallet address.`,
      'NOT_FOUND'
    );
  }

  /**
   * Get fee schedule
   */
  getFeeSchedule() {
    return {
      rate: SETTLEMENT_FEE_RATE,
      bps: SETTLEMENT_FEE_BPS,
      description: '0.5% settlement fee on every transaction',
      treasury: WAZABI_TREASURY,
    };
  }
}

// ============================================================================
// Error Types
// ============================================================================

export class SettlementError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'SettlementError';
    Object.setPrototypeOf(this, SettlementError.prototype);
  }
}
