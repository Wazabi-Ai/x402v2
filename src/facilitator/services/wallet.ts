/**
 * ERC-4337 Wallet Service
 *
 * Handles smart wallet provisioning using Account Abstraction (ERC-4337).
 * Provides deterministic wallet addresses via CREATE2 that are identical
 * across all supported chains (BNB Chain + Base).
 */

import { createPublicClient, http, encodePacked, keccak256, getAddress, concat, pad } from 'viem';
import { bsc } from 'viem/chains';
import { BSC_DEFAULT_RPC } from '../../chains/bnb.js';

// ============================================================================
// ERC-4337 Contract Addresses
// ============================================================================

/**
 * ERC-4337 EntryPoint v0.7 address (same on all EVM chains)
 */
export const ENTRYPOINT_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;

/**
 * WazabiAccountFactory address (deployed via CREATE2, same on all chains)
 */
export const WAZABI_ACCOUNT_FACTORY = '0x' + '0'.repeat(38) + '01' as `0x${string}`;

/**
 * WazabiPaymaster address per network
 */
export const WAZABI_PAYMASTERS: Record<string, `0x${string}`> = {
  'eip155:56': '0x' + '0'.repeat(38) + '02' as `0x${string}`,
  'eip155:8453': '0x' + '0'.repeat(38) + '03' as `0x${string}`,
} as const;

/**
 * Wazabi Treasury address (fee collection)
 */
export const WAZABI_TREASURY = '0x' + '0'.repeat(38) + '04' as `0x${string}`;

// ============================================================================
// Wallet Service
// ============================================================================

export interface WalletDeploymentResult {
  address: string;
  deployed: Record<string, boolean>;
}

export interface SessionKeyPair {
  publicKey: string;
  privateKey: string;
  expires: Date;
}

export class WalletService {
  private readonly rpcUrl: string;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl ?? BSC_DEFAULT_RPC;
  }

  /**
   * Compute a deterministic ERC-4337 wallet address using CREATE2
   *
   * The address is derived from:
   * - Factory address (WazabiAccountFactory)
   * - Salt (derived from handle + owner)
   * - Init code hash (WazabiAccount bytecode + constructor args)
   *
   * This produces the same address on every EVM chain.
   */
  computeWalletAddress(
    handle: string,
    ownerAddress: string,
    sessionKeyPublic: string
  ): string {
    // Compute salt from handle, owner, and session key
    // Uses bytes32 for session key since it's a 32-byte hash, not a 20-byte address
    const salt = keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        [
          handle,
          pad(ownerAddress as `0x${string}`, { size: 32 }),
          sessionKeyPublic as `0x${string}`,
        ]
      )
    );

    // Compute init code hash (simplified - in production this would use actual bytecode)
    const initCodeHash = keccak256(
      encodePacked(
        ['bytes32', 'bytes32', 'string'],
        [
          pad(ownerAddress as `0x${string}`, { size: 32 }),
          sessionKeyPublic as `0x${string}`,
          handle,
        ]
      )
    );

    // CREATE2 address computation: keccak256(0xff ++ factory ++ salt ++ initCodeHash)
    const create2Input = concat([
      '0xff' as `0x${string}`,
      pad(WAZABI_ACCOUNT_FACTORY, { size: 20 }),
      salt,
      initCodeHash,
    ]);

    const hash = keccak256(create2Input);
    // Take the last 20 bytes as the address
    const address = `0x${hash.slice(-40)}` as `0x${string}`;

    return getAddress(address);
  }

  /**
   * Generate a session key pair for an agent
   *
   * Session keys allow agents to sign transactions without exposing
   * the owner's private key. They have spending limits and expiration.
   */
  generateSessionKey(validityDurationSeconds: number = 365 * 24 * 60 * 60): SessionKeyPair {
    // Generate random 32-byte private key
    const privateKeyBytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(privateKeyBytes);
    } else {
      for (let i = 0; i < privateKeyBytes.length; i++) {
        privateKeyBytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const privateKey = '0x' + Array.from(privateKeyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Derive public key (simplified - in production use proper EC key derivation)
    const publicKey = keccak256(privateKey as `0x${string}`).slice(0, 66);

    const expires = new Date(Date.now() + validityDurationSeconds * 1000);

    return {
      publicKey,
      privateKey,
      expires,
    };
  }

  /**
   * Deploy a wallet on a specific network (lazy deployment)
   *
   * In production, this submits a UserOperation to the EntryPoint
   * via the bundler. The wallet is deployed on the first transaction.
   */
  async deployWallet(
    _walletAddress: string,
    _network: string,
    _ownerAddress: string,
    _sessionKeyPublic: string,
    _handle: string
  ): Promise<{ deployed: boolean; txHash?: string }> {
    // In production:
    // 1. Build UserOp with initCode (factory + createAccount calldata)
    // 2. Sign UserOp
    // 3. Submit to bundler
    // 4. Wait for confirmation

    // For now, return lazy deployment status
    // Wallet will be deployed on first transaction
    return { deployed: false };
  }

  /**
   * Check if a wallet is deployed on a specific network
   */
  async isWalletDeployed(walletAddress: string, network: string): Promise<boolean> {
    try {
      const rpcUrl = this.getRpcForNetwork(network);
      const client = createPublicClient({
        chain: bsc,
        transport: http(rpcUrl),
      });

      const code = await client.getCode({
        address: walletAddress as `0x${string}`,
      });

      return code !== undefined && code !== '0x';
    } catch {
      return false;
    }
  }

  /**
   * Get the deployment status across all networks
   */
  async getDeploymentStatus(
    walletAddress: string,
    networks: string[]
  ): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const network of networks) {
      status[network] = await this.isWalletDeployed(walletAddress, network);
    }
    return status;
  }

  /**
   * Get the RPC URL for a given network
   */
  private getRpcForNetwork(network: string): string {
    switch (network) {
      case 'eip155:56':
        return 'https://bsc-dataseed.binance.org';
      case 'eip155:8453':
        return 'https://mainnet.base.org';
      default:
        return this.rpcUrl;
    }
  }
}
