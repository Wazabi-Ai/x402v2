/**
 * Settlement Service
 *
 * Handles payment settlement with 0.5% fee collection.
 *
 * Supports two operating modes:
 *   1. Live mode  -- when SettlementConfig is provided, executes real on-chain
 *      ERC-20 transfers from the treasury wallet to the recipient.
 *   2. Demo mode  -- when no config is provided, simulates settlement with
 *      generated transaction hashes (suitable for testing / demos).
 *
 * Supports two identity types:
 *   1. Registered agents -- identified by handle (e.g., "molty" or "molty.wazabi-x402")
 *   2. Unregistered users -- identified by raw Ethereum address (e.g., "0x...")
 *
 * Registration is NOT required. Any valid Ethereum address can use /settle and /verify.
 * Registered agents get additional benefits (handles, gasless UX, history tracking).
 *
 * Settlement flow (live mode):
 *   - The payer has already transferred the full gross amount to the treasury
 *     via the verified x402 payment authorization.
 *   - The treasury wallet forwards the net amount (gross minus 0.5% fee) to
 *     the recipient via an ERC-20 transfer.
 *   - The fee remains in the treasury automatically.
 */

import { randomUUID } from 'crypto';
import type { PublicClient, WalletClient } from 'viem';
import type { InMemoryStore } from '../db/schema.js';
import type { Transaction, SettleRequest, SettleResponse } from '../types.js';
import {
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  calculateFee,
  calculateNet,
  isAddress,
} from '../types.js';
import { WAZABI_TREASURY } from './wallet.js';
import { getTokenForNetwork } from '../../chains/index.js';
import type { HandleService } from './handle.js';

// ============================================================================
// ERC-20 ABI (minimal subset for transfer + balanceOf)
// ============================================================================

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ============================================================================
// Settlement Configuration
// ============================================================================

/**
 * Configuration for live on-chain settlement.
 *
 * When provided to SettlementService, enables real ERC-20 transfers.
 * When omitted, the service falls back to demo/simulation mode.
 */
export interface SettlementConfig {
  /** Treasury wallet address that holds funds and executes transfers */
  treasuryAddress: `0x${string}`;
  /** Public clients keyed by CAIP-2 network ID (e.g. "eip155:8453") */
  publicClients: Record<string, PublicClient>;
  /** Wallet clients keyed by CAIP-2 network ID, with account + chain configured */
  walletClients: Record<string, WalletClient>;
}

// ============================================================================
// Utility: Parse human-readable amount to on-chain token units
// ============================================================================

/**
 * Convert a human-readable decimal string (e.g. "100.50") to the smallest
 * on-chain unit for a token with the given number of decimals.
 *
 * Example: parseAmountToUnits("100.50", 6) => 100500000n
 */
function parseAmountToUnits(amount: string, decimals: number): bigint {
  const [whole = '0', fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFractional);
}

// ============================================================================
// Settlement Service
// ============================================================================

export class SettlementService {
  private readonly handleService: HandleService;
  private readonly store: InMemoryStore;
  private readonly config?: SettlementConfig;

  constructor(
    handleService: HandleService,
    store: InMemoryStore,
    config?: SettlementConfig
  ) {
    this.handleService = handleService;
    this.store = store;
    this.config = config;
  }

  /**
   * Whether the service is configured for real on-chain settlement.
   */
  get isLiveMode(): boolean {
    return this.config !== undefined;
  }

  /**
   * Access to the underlying HandleService for handle resolution.
   */
  get handles(): HandleService {
    return this.handleService;
  }

  /**
   * Execute a payment settlement with 0.5% fee
   *
   * Accepts both registered handles and raw wallet addresses as sender/recipient.
   * Registration is optional -- unregistered addresses are treated as pass-through.
   *
   * In live mode the treasury wallet executes an ERC-20 transfer of the net
   * amount to the recipient. The 0.5% fee is retained in the treasury.
   *
   * In demo mode a simulated tx hash is generated and returned immediately.
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const { from, to, amount, token, network } = request;

    // Resolve sender: try registered agent first, fall back to raw address
    let fromIdentifier: string;

    if (isAddress(from)) {
      // Raw address -- check if registered, but don't require it
      const sender = await this.store.getAgentByWallet(from);
      fromIdentifier = sender?.full_handle ?? from;
    } else {
      // Handle -- must be registered
      const sender = await this.store.getAgentByHandle(from);
      if (!sender) {
        throw new SettlementError(
          `Handle "${from}" not found. Use a raw wallet address or register first at POST /register.`,
          'HANDLE_NOT_FOUND'
        );
      }
      fromIdentifier = sender.full_handle;
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

    // ------------------------------------------------------------------
    // Determine settlement mode based on available clients
    // ------------------------------------------------------------------

    const publicClient = this.config?.publicClients[network];
    const walletClient = this.config?.walletClients[network];
    const treasuryAddress = this.config?.treasuryAddress;

    if (publicClient && walletClient && treasuryAddress) {
      // ================================================================
      // LIVE ON-CHAIN SETTLEMENT
      // ================================================================
      return this.executeLiveSettlement({
        transaction,
        publicClient,
        walletClient,
        treasuryAddress,
        toAddress,
        toIdentifier,
        fromIdentifier,
        amount,
        token,
        network,
        fee,
        estimatedGas,
        net,
      });
    } else {
      // ================================================================
      // DEMO MODE: Simulated settlement (no wallet clients configured)
      // ================================================================
      return this.executeDemoSettlement({
        transaction,
        fromIdentifier,
        toIdentifier,
        amount,
        fee,
        estimatedGas,
        net,
        network,
      });
    }
  }

  // ------------------------------------------------------------------
  // Live on-chain settlement
  // ------------------------------------------------------------------

  private async executeLiveSettlement(params: {
    transaction: Transaction;
    publicClient: PublicClient;
    walletClient: WalletClient;
    treasuryAddress: `0x${string}`;
    toAddress: string;
    toIdentifier: string;
    fromIdentifier: string;
    amount: string;
    token: string;
    network: string;
    fee: string;
    estimatedGas: string;
    net: string;
  }): Promise<SettleResponse> {
    const {
      transaction,
      publicClient,
      walletClient,
      treasuryAddress,
      toAddress,
      toIdentifier,
      fromIdentifier,
      amount,
      token,
      network,
      fee,
      estimatedGas,
      net,
    } = params;

    // 1. Resolve token address from chain config
    const tokenConfig = getTokenForNetwork(network, token);
    if (!tokenConfig) {
      await this.store.updateTransactionStatus(transaction.id, 'failed');
      throw new SettlementError(
        `Token "${token}" is not supported on network "${network}".`,
        'UNSUPPORTED_TOKEN'
      );
    }

    const tokenAddress = tokenConfig.address;
    const decimals = tokenConfig.decimals;

    // 2. Convert net amount to on-chain units (smallest token unit)
    const netAmountUnits = parseAmountToUnits(net, decimals);

    // 3. Validate wallet client has an account configured
    if (!walletClient.account) {
      await this.store.updateTransactionStatus(transaction.id, 'failed');
      throw new SettlementError(
        `Wallet client for network "${network}" has no account configured. ` +
        'Ensure the wallet client was created with a private key account.',
        'WALLET_NOT_CONFIGURED'
      );
    }

    try {
      // 4. Check treasury balance before attempting transfer
      const treasuryBalance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [treasuryAddress],
      });

      if (treasuryBalance < netAmountUnits) {
        await this.store.updateTransactionStatus(transaction.id, 'failed');
        throw new SettlementError(
          `Insufficient treasury balance for ${token} on ${network}. ` +
          `Required: ${net} ${token} (${netAmountUnits.toString()} units), ` +
          `available: ${treasuryBalance.toString()} units.`,
          'INSUFFICIENT_BALANCE'
        );
      }

      // 5. Execute ERC-20 transfer: treasury -> recipient for the net amount.
      //    The 0.5% fee stays in the treasury automatically since the payer
      //    sent the full gross amount to the treasury via the x402 payment.
      const txHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [toAddress as `0x${string}`, netAmountUnits],
        account: walletClient.account,
        chain: walletClient.chain ?? undefined,
      } as any);

      // 6. Mark as submitted (transaction broadcast to network)
      await this.store.updateTransactionStatus(
        transaction.id,
        'submitted',
        txHash
      );

      // 7. Wait for transaction to be mined
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === 'success') {
        // 8a. Confirmed -- update record and return success
        await this.store.updateTransactionStatus(
          transaction.id,
          'confirmed',
          txHash
        );

        return {
          success: true,
          tx_hash: txHash,
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
      } else {
        // 8b. Transaction was mined but reverted
        await this.store.updateTransactionStatus(
          transaction.id,
          'failed',
          txHash
        );
        throw new SettlementError(
          `Transaction reverted on-chain. Tx hash: ${txHash}`,
          'TX_REVERTED'
        );
      }
    } catch (err) {
      // Re-throw SettlementErrors as-is (they already updated the record)
      if (err instanceof SettlementError) throw err;

      // Unexpected errors (RPC timeout, gas estimation failure, nonce issues, etc.)
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.store.updateTransactionStatus(transaction.id, 'failed');
      throw new SettlementError(
        `On-chain settlement failed: ${errorMessage}`,
        'SETTLEMENT_FAILED'
      );
    }
  }

  // ------------------------------------------------------------------
  // Demo / simulated settlement
  // ------------------------------------------------------------------

  private async executeDemoSettlement(params: {
    transaction: Transaction;
    fromIdentifier: string;
    toIdentifier: string;
    amount: string;
    fee: string;
    estimatedGas: string;
    net: string;
    network: string;
  }): Promise<SettleResponse> {
    const {
      transaction,
      fromIdentifier,
      toIdentifier,
      amount,
      fee,
      estimatedGas,
      net,
      network,
    } = params;

    // Generate a deterministic-looking simulated tx hash
    const simulatedTxHash =
      `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 32)}`;

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
      // Raw address -- valid without registration
      const sender = await this.store.getAgentByWallet(from);
      if (sender) {
        // Registered agent -- include balance check
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
      // Unregistered address -- valid, no balance info available
      return {
        valid: true,
        signer: from,
        registered: false,
      };
    }

    // Handle -- must be registered
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
      treasury: this.config?.treasuryAddress ?? WAZABI_TREASURY,
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
