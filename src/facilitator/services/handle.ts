/**
 * Handle Service
 *
 * Manages agent handle registration, validation, and resolution.
 * Handles are human-readable identifiers in the format name.wazabi-x402
 * that resolve to ERC-4337 smart wallet addresses.
 */

import { randomUUID } from 'crypto';
import type { InMemoryStore } from '../db/schema.js';
import type { Agent, RegisterRequest, RegisterResponse } from '../types.js';
import {
  HANDLE_REGEX,
  AGENT_SUPPORTED_NETWORKS,
  toFullHandle,
} from '../types.js';
import { WalletService } from './wallet.js';

// ============================================================================
// Reserved Handles
// ============================================================================

/**
 * Handles that cannot be registered (reserved for system use)
 */
const RESERVED_HANDLES = new Set([
  'admin', 'wazabi', 'system', 'root', 'api', 'www',
  'support', 'help', 'info', 'contact', 'billing',
  'treasury', 'facilitator', 'x402', 'protocol',
  'openclaw', 'moltbook', 'agent', 'agents',
  'register', 'resolve', 'balance', 'history', 'profile',
  'settle', 'verify', 'supported', 'skill', 'health',
]);

// ============================================================================
// Handle Service
// ============================================================================

export class HandleService {
  private readonly store: InMemoryStore;
  private readonly walletService: WalletService;

  constructor(store: InMemoryStore, walletService?: WalletService) {
    this.store = store;
    this.walletService = walletService ?? new WalletService();
  }

  /**
   * Register a new agent handle with associated ERC-4337 wallet
   */
  async register(request: RegisterRequest): Promise<RegisterResponse> {
    const { handle, networks, owner, metadata } = request;

    // Validate handle format
    this.validateHandle(handle);

    // Check if handle is available
    const exists = await this.store.handleExists(handle);
    if (exists) {
      throw new HandleError(`Handle "${handle}" is already taken`, 'HANDLE_TAKEN');
    }

    // Generate session key
    const sessionKey = this.walletService.generateSessionKey();

    // Determine owner address
    // The publicKey is a bytes32-padded Ethereum address (from secp256k1 derivation).
    // Extract the last 20 bytes (40 hex chars) to recover the address.
    const ownerAddress = owner ?? ('0x' + sessionKey.publicKey.slice(-40));

    // Compute deterministic wallet address
    const walletAddress = this.walletService.computeWalletAddress(
      handle,
      ownerAddress,
      sessionKey.publicKey
    );

    // Check deployment status on requested networks
    const deployed: Record<string, boolean> = {};
    for (const network of networks) {
      // Wallets are lazily deployed on first transaction
      deployed[network] = false;
    }

    // Create agent record
    const agent: Agent = {
      id: randomUUID(),
      handle,
      full_handle: toFullHandle(handle),
      wallet_address: walletAddress,
      owner_address: owner ?? null,
      session_key_public: sessionKey.publicKey,
      created_at: new Date(),
      metadata: metadata ?? {},
    };

    await this.store.createAgent(agent);

    // Kick off wallet deployment on all supported networks (non-blocking, fire and forget)
    this.deployAgentWallet(handle).catch(error => {
      console.error(`[handle-service] Background wallet deployment failed for ${handle}:`, error);
    });

    // Initialize balance records for each network
    for (const network of networks) {
      const tokens = this.getTokensForNetwork(network);
      for (const token of tokens) {
        await this.store.setBalance({
          agent_id: agent.id,
          network,
          token,
          balance: '0',
          updated_at: new Date(),
        });
      }
    }

    return {
      handle: agent.full_handle,
      wallet: {
        address: walletAddress,
        type: 'ERC-4337',
        deployed,
      },
      session_key: {
        public: sessionKey.publicKey,
        private: sessionKey.privateKey,
        expires: sessionKey.expires.toISOString(),
      },
    };
  }

  /**
   * Resolve a handle to its wallet address and metadata
   */
  async resolve(handle: string): Promise<{
    handle: string;
    address: string;
    networks: string[];
    active: boolean;
  } | null> {
    const agent = await this.store.getAgentByHandle(handle);
    if (!agent) return null;

    return {
      handle: agent.full_handle,
      address: agent.wallet_address,
      networks: [...AGENT_SUPPORTED_NETWORKS],
      active: true,
    };
  }

  /**
   * Get full agent profile
   */
  async getProfile(handle: string): Promise<{
    agent: Agent;
    balances: { network: string; token: string; balance: string }[];
    totalTransactions: number;
  } | null> {
    const agent = await this.store.getAgentByHandle(handle);
    if (!agent) return null;

    const balances = await this.store.getBalances(agent.id);
    const totalTransactions = await this.store.getTransactionCount(agent.handle);

    return {
      agent,
      balances: balances.map(b => ({
        network: b.network,
        token: b.token,
        balance: b.balance,
      })),
      totalTransactions,
    };
  }

  /**
   * Deploy agent wallet on all supported networks
   *
   * Attempts deployment on each network independently. Failures on
   * individual networks are logged but do not affect other networks.
   *
   * After deployment, estimates the total gas cost across all networks
   * and stores it as a pending deployment fee on the agent record.
   * This fee is recovered from the user's first settlement.
   */
  async deployAgentWallet(handle: string): Promise<Record<string, { deployed: boolean; txHash?: string }>> {
    const agent = await this.store.getAgentByHandle(handle);
    if (!agent) {
      throw new HandleError(`Handle "${handle}" not found`, 'HANDLE_NOT_FOUND');
    }

    const results: Record<string, { deployed: boolean; txHash?: string }> = {};

    for (const network of AGENT_SUPPORTED_NETWORKS) {
      try {
        const result = await this.walletService.deployWallet(
          agent.wallet_address,
          network,
          agent.owner_address ?? agent.wallet_address,
          agent.session_key_public,
          agent.handle
        );
        results[network] = result;
      } catch (error) {
        console.error(`[handle-service] Wallet deployment failed on ${network} for ${handle}:`, error);
        results[network] = { deployed: false };
      }
    }

    // Estimate total deployment gas cost and store as pending fee
    let totalDeploymentFee = 0;
    for (const [network, result] of Object.entries(results)) {
      if (result.deployed) {
        totalDeploymentFee += this.estimateDeploymentCostUsd(network);
      }
    }
    if (totalDeploymentFee > 0) {
      await this.store.updateAgent(agent.id, {
        pending_deployment_fee: totalDeploymentFee.toFixed(2),
      });
    }

    return results;
  }

  /**
   * Estimate wallet deployment gas cost in USD for a given network.
   *
   * Uses conservative gas price assumptions and a 500,000 gas budget
   * for the CREATE2 proxy deployment + initialization.
   */
  private estimateDeploymentCostUsd(network: string): number {
    const DEPLOYMENT_GAS = 500_000;
    const estimates: Record<string, { gasPriceGwei: number; nativeUsdPrice: number }> = {
      'eip155:1':    { gasPriceGwei: 30,   nativeUsdPrice: 4000 },
      'eip155:56':   { gasPriceGwei: 3,    nativeUsdPrice: 700 },
      'eip155:8453': { gasPriceGwei: 0.01, nativeUsdPrice: 4000 },
    };

    const est = estimates[network];
    if (!est) return 0;

    const gasCostNative = DEPLOYMENT_GAS * est.gasPriceGwei * 1e-9;
    return gasCostNative * est.nativeUsdPrice;
  }

  /**
   * Get on-chain deployment status for an agent's wallet across all networks
   */
  async getDeploymentStatus(handle: string): Promise<{
    handle: string;
    wallet_address: string;
    networks: Record<string, boolean>;
  }> {
    const agent = await this.store.getAgentByHandle(handle);
    if (!agent) {
      throw new HandleError(`Handle "${handle}" not found`, 'HANDLE_NOT_FOUND');
    }

    const networks = await this.walletService.getDeploymentStatus(
      agent.wallet_address,
      [...AGENT_SUPPORTED_NETWORKS]
    );

    return {
      handle: agent.full_handle,
      wallet_address: agent.wallet_address,
      networks,
    };
  }

  /**
   * Check if a handle is available
   */
  async isAvailable(handle: string): Promise<boolean> {
    if (!HANDLE_REGEX.test(handle)) return false;
    if (RESERVED_HANDLES.has(handle.toLowerCase())) return false;
    return !(await this.store.handleExists(handle));
  }

  /**
   * Validate a handle string
   */
  private validateHandle(handle: string): void {
    if (!HANDLE_REGEX.test(handle)) {
      throw new HandleError(
        `Invalid handle format: "${handle}". Must be 3-50 characters, alphanumeric with hyphens/underscores.`,
        'INVALID_HANDLE'
      );
    }

    if (RESERVED_HANDLES.has(handle.toLowerCase())) {
      throw new HandleError(
        `Handle "${handle}" is reserved and cannot be registered.`,
        'HANDLE_RESERVED'
      );
    }
  }

  /**
   * Get supported token symbols for a network
   */
  private getTokensForNetwork(network: string): string[] {
    switch (network) {
      case 'eip155:1':
        return ['USDC', 'USDT', 'WETH'];
      case 'eip155:56':
        return ['USDT', 'USDC'];
      case 'eip155:8453':
        return ['USDC', 'WETH'];
      default:
        return ['USDC'];
    }
  }
}

// ============================================================================
// Error Types
// ============================================================================

export class HandleError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'HandleError';
    Object.setPrototypeOf(this, HandleError.prototype);
  }
}
