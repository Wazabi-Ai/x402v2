/**
 * Settlement Service
 *
 * Handles payment settlement with 0.5% fee collection.
 * Integrates with ERC-4337 UserOperations for gasless transfers
 * paid from the agent's token balance via the Paymaster.
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
   * Flow:
   * 1. Validate sender and recipient
   * 2. Calculate fee (0.5% of gross amount)
   * 3. Build UserOperation for ERC-4337 batch execution:
   *    a. Transfer (amount - fee) to recipient
   *    b. Transfer fee to Wazabi treasury
   * 4. Submit via bundler
   * 5. Record transaction
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const { from, to, amount, token, network } = request;

    // Resolve sender
    const fromHandle = isAddress(from) ? from : toFullHandle(from);
    const sender = isAddress(from)
      ? await this.store.getAgentByWallet(from)
      : await this.store.getAgentByHandle(from);

    if (!sender) {
      throw new SettlementError(
        `Sender "${from}" not found. Register first at POST /register.`,
        'SENDER_NOT_FOUND'
      );
    }

    // Resolve recipient
    let toAddress: string;
    let toIdentifier: string;
    if (isAddress(to)) {
      toAddress = to;
      toIdentifier = to;
    } else {
      const recipient = await this.store.getAgentByHandle(to);
      if (!recipient) {
        throw new SettlementError(
          `Recipient "${to}" not found.`,
          'RECIPIENT_NOT_FOUND'
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
      from_handle: sender.full_handle,
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
    // 1. Build UserOp with batch execute:
    //    - Transfer `net` amount to recipient
    //    - Transfer `fee` to WAZABI_TREASURY
    // 2. Set paymaster data (gas paid in token)
    // 3. Sign with session key
    // 4. Submit to bundler
    // 5. Wait for confirmation
    // 6. Update transaction record

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
      from: sender.full_handle,
      to: toIdentifier,
      network,
    };
  }

  /**
   * Verify a payment (x402 standard verification + balance check)
   */
  async verifyPayment(params: {
    from: string;
    amount: string;
    token: string;
    network: string;
  }): Promise<{
    valid: boolean;
    signer?: string;
    error?: string;
    balanceSufficient?: boolean;
  }> {
    const { from, amount, token, network } = params;

    // Resolve sender
    const sender = isAddress(from)
      ? await this.store.getAgentByWallet(from)
      : await this.store.getAgentByHandle(from);

    if (!sender) {
      return { valid: false, error: 'Sender not found' };
    }

    // Check balance
    const balances = await this.store.getBalances(sender.id);
    const tokenBalance = balances.find(
      b => b.network === network && b.token === token
    );
    const balance = parseFloat(tokenBalance?.balance ?? '0');
    const required = parseFloat(amount) * (1 + SETTLEMENT_FEE_RATE); // Include fee

    return {
      valid: true,
      signer: sender.wallet_address,
      balanceSufficient: balance >= required,
    };
  }

  /**
   * Get transaction history for a handle
   */
  async getHistory(
    handle: string,
    limit: number = 20,
    offset: number = 0
  ) {
    const agent = await this.store.getAgentByHandle(handle);
    if (!agent) {
      throw new SettlementError(
        `Agent "${handle}" not found.`,
        'AGENT_NOT_FOUND'
      );
    }

    const { transactions, total } = await this.store.getTransactionsByHandle(
      handle,
      limit,
      offset
    );

    return {
      handle: agent.full_handle,
      transactions: transactions.map(tx => ({
        type: tx.from_handle === agent.full_handle
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
