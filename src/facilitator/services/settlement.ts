/**
 * Settlement Service
 *
 * Handles x402 payment settlement via WazabiSettlement contract.
 *
 * Two settlement paths (non-custodial):
 *   1. Permit2 — calls WazabiSettlement.settle() with the payer's batch witness signature.
 *      Funds move directly from payer → recipient (net) and payer → treasury (fee).
 *
 *   2. ERC-3009 — calls WazabiSettlement.settleWithAuthorization() with the payer's
 *      transferWithAuthorization signature. Contract receives gross, immediately splits.
 *
 * The facilitator pays gas but cannot redirect funds. The payer's EIP-712 signature
 * cryptographically commits to the recipient and fee rate.
 *
 * Identity layer integration:
 *   - verifyPayment() and getHistory() still support handle-based lookups.
 *   - The old custodial settle() is replaced by settleX402().
 */

import { randomUUID } from 'crypto';
import type { PublicClient, WalletClient } from 'viem';
import type { InMemoryStore } from '../db/schema.js';
import type { Transaction } from '../types.js';
import {
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  isAddress,
} from '../types.js';
import type { HandleService } from './handle.js';
import type {
  PaymentPayload,
  Permit2Payload,
  ERC3009Payload,
  PaymentResponse,
} from '../../types/index.js';

// ============================================================================
// WazabiSettlement Contract ABI (minimal)
// ============================================================================

const wazabiSettlementAbi = [
  {
    name: 'settle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'permit',
        type: 'tuple',
        components: [
          {
            name: 'permitted',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { name: 'payer', type: 'address' },
      {
        name: 'witness',
        type: 'tuple',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'feeBps', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'settleWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'payer', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

// ============================================================================
// Settlement Configuration
// ============================================================================

export interface SettlementConfig {
  /** Treasury wallet address that receives protocol fees */
  treasuryAddress: `0x${string}`;
  /** WazabiSettlement contract addresses keyed by CAIP-2 network ID */
  settlementAddresses: Record<string, `0x${string}`>;
  /** Public clients keyed by CAIP-2 network ID */
  publicClients: Record<string, PublicClient>;
  /** Wallet clients keyed by CAIP-2 network ID (facilitator account, pays gas) */
  walletClients: Record<string, WalletClient>;
}

// ============================================================================
// Utility: Split packed EIP-712 signature into v, r, s
// ============================================================================

function splitSignature(sig: string): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const bytes = sig.startsWith('0x') ? sig.slice(2) : sig;
  const r = `0x${bytes.slice(0, 64)}` as `0x${string}`;
  const s = `0x${bytes.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(bytes.slice(128, 130), 16);
  return { v, r, s };
}

// ============================================================================
// Settlement Service
// ============================================================================

export class SettlementService {
  private readonly handleService: HandleService;
  private readonly store: InMemoryStore;
  private readonly config: SettlementConfig;

  constructor(
    handleService: HandleService,
    store: InMemoryStore,
    config: SettlementConfig
  ) {
    this.handleService = handleService;
    this.store = store;
    this.config = config;
  }

  get handles(): HandleService {
    return this.handleService;
  }

  // ==========================================================================
  // x402 Settlement (non-custodial, via WazabiSettlement contract)
  // ==========================================================================

  /**
   * Settle an x402 payment on-chain via the WazabiSettlement contract.
   *
   * Routes to the appropriate settlement path based on the payment scheme:
   *   - permit2 → WazabiSettlement.settle()
   *   - erc3009 → WazabiSettlement.settleWithAuthorization()
   */
  async settleX402(payload: PaymentPayload): Promise<PaymentResponse> {
    const { network } = payload;

    const publicClient = this.config.publicClients[network];
    const walletClient = this.config.walletClients[network];
    const settlementAddress = this.config.settlementAddresses[network];

    if (!publicClient || !walletClient) {
      throw new SettlementError(
        `No clients configured for network "${network}".`,
        'NETWORK_NOT_CONFIGURED'
      );
    }

    if (!settlementAddress) {
      throw new SettlementError(
        `No WazabiSettlement contract configured for network "${network}".`,
        'SETTLEMENT_NOT_CONFIGURED'
      );
    }

    if (!walletClient.account) {
      throw new SettlementError(
        `Wallet client for network "${network}" has no account configured.`,
        'WALLET_NOT_CONFIGURED'
      );
    }

    // Create transaction record
    const settlementId = randomUUID();
    const payer = payload.payer;
    const recipient = payload.scheme === 'permit2'
      ? payload.witness.recipient
      : payload.recipient;

    const grossAmount = payload.scheme === 'permit2'
      ? (BigInt(payload.permit.permitted[0]!.amount) + BigInt(payload.permit.permitted[1]!.amount)).toString()
      : payload.authorization.value;

    const token = payload.scheme === 'permit2'
      ? payload.permit.permitted[0]!.token
      : 'USDC';

    const transaction: Transaction = {
      id: settlementId,
      from_handle: payer,
      to_address: recipient,
      amount: grossAmount,
      token,
      network,
      fee: '0',
      gas_cost: '0',
      tx_hash: null,
      status: 'pending',
      created_at: new Date(),
    };

    await this.store.createTransaction(transaction);

    try {
      let txHash: `0x${string}`;

      if (payload.scheme === 'permit2') {
        txHash = await this.executePermit2Settlement(
          payload,
          settlementAddress,
          walletClient
        );
      } else {
        txHash = await this.executeERC3009Settlement(
          payload,
          settlementAddress,
          walletClient
        );
      }

      // Mark as submitted
      await this.store.updateTransactionStatus(settlementId, 'submitted', txHash);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
        const nativeUsdPrice = this.getNativeTokenUsdPrice(network);
        const gasCostUsd = Number(gasCostWei) / 1e18 * nativeUsdPrice;
        const gasStr = gasCostUsd < 0.01 ? gasCostUsd.toFixed(6) : gasCostUsd.toFixed(2);

        await this.store.updateTransactionGas(settlementId, gasStr);
        await this.store.updateTransactionStatus(settlementId, 'confirmed', txHash);

        return {
          success: true,
          txHash,
          network,
          settlementId,
        };
      } else {
        await this.store.updateTransactionStatus(settlementId, 'failed', txHash);
        throw new SettlementError(
          `Transaction reverted on-chain. Tx hash: ${txHash}`,
          'TX_REVERTED'
        );
      }
    } catch (err) {
      if (err instanceof SettlementError) throw err;

      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.store.updateTransactionStatus(settlementId, 'failed');
      throw new SettlementError(
        `On-chain settlement failed: ${errorMessage}`,
        'SETTLEMENT_FAILED'
      );
    }
  }

  /**
   * Execute Permit2 settlement via WazabiSettlement.settle()
   */
  private async executePermit2Settlement(
    payload: Permit2Payload,
    settlementAddress: `0x${string}`,
    walletClient: WalletClient
  ): Promise<`0x${string}`> {
    const permit = {
      permitted: payload.permit.permitted.map(p => ({
        token: p.token as `0x${string}`,
        amount: BigInt(p.amount),
      })),
      nonce: BigInt(payload.permit.nonce),
      deadline: BigInt(payload.permit.deadline),
    };

    const witness = {
      recipient: payload.witness.recipient as `0x${string}`,
      feeBps: BigInt(payload.witness.feeBps),
    };

    return walletClient.writeContract({
      address: settlementAddress,
      abi: wazabiSettlementAbi,
      functionName: 'settle',
      args: [permit, payload.payer as `0x${string}`, witness, payload.signature as `0x${string}`],
      account: walletClient.account!,
      chain: walletClient.chain!,
    });
  }

  /**
   * Execute ERC-3009 settlement via WazabiSettlement.settleWithAuthorization()
   */
  private async executeERC3009Settlement(
    payload: ERC3009Payload,
    settlementAddress: `0x${string}`,
    walletClient: WalletClient
  ): Promise<`0x${string}`> {
    const { v, r, s } = splitSignature(payload.signature);
    const tokenAddress = this.resolveERC3009Token(payload.network);

    return walletClient.writeContract({
      address: settlementAddress,
      abi: wazabiSettlementAbi,
      functionName: 'settleWithAuthorization',
      args: [
        tokenAddress,
        payload.payer as `0x${string}`,
        payload.recipient as `0x${string}`,
        BigInt(payload.authorization.value),
        BigInt(payload.authorization.validAfter),
        BigInt(payload.authorization.validBefore),
        payload.authorization.nonce as `0x${string}`,
        v,
        r,
        s,
      ],
      account: walletClient.account!,
      chain: walletClient.chain!,
    });
  }

  /**
   * Resolve ERC-3009 token address for a network (USDC only)
   */
  private resolveERC3009Token(network: string): `0x${string}` {
    const usdcAddresses: Record<string, `0x${string}`> = {
      'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    };

    const addr = usdcAddresses[network];
    if (!addr) {
      throw new SettlementError(
        `ERC-3009 not supported on network "${network}". Only Ethereum and Base USDC.`,
        'ERC3009_NOT_SUPPORTED'
      );
    }
    return addr;
  }

  /**
   * Conservative native token USD prices per chain.
   */
  private getNativeTokenUsdPrice(network: string): number {
    switch (network) {
      case 'eip155:1':    return 4000;
      case 'eip155:56':   return 700;
      case 'eip155:8453': return 4000;
      default:            return 4000;
    }
  }

  // ==========================================================================
  // Identity Layer (handle-based lookups, history, etc.)
  // ==========================================================================

  /**
   * Verify a payment (identity-based check + optional balance check)
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
      const sender = await this.store.getAgentByWallet(from);
      if (sender) {
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
      return {
        valid: true,
        signer: from,
        registered: false,
      };
    }

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
    let agent = await this.store.getAgentByHandle(handleOrAddress);
    if (!agent && isAddress(handleOrAddress)) {
      agent = await this.store.getAgentByWallet(handleOrAddress);
    }

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
        pagination: { limit, offset, total },
      };
    }

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
        pagination: { limit, offset, total },
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
      treasury: this.config.treasuryAddress,
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
