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
  HANDLE_SUFFIX,
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
    // When no owner is provided, derive one from the session key (first 20 bytes = valid address)
    const ownerAddress = owner ?? ('0x' + sessionKey.publicKey.slice(2, 42));

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
      case 'eip155:56':
        return ['USDT', 'USDC'];
      case 'eip155:8453':
        return ['USDC'];
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
