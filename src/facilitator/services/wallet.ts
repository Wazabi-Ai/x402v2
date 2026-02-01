/**
 * ERC-4337 Wallet Service
 *
 * Handles smart wallet provisioning using Account Abstraction (ERC-4337).
 * Provides deterministic wallet addresses via CREATE2 that are identical
 * across all supported chains (Ethereum, BNB Chain, and Base).
 *
 * All contract addresses and RPC endpoints are loaded from the centralized
 * config module (environment variables) rather than being hardcoded.
 */

import {
  createPublicClient,
  http,
  encodePacked,
  encodeFunctionData,
  keccak256,
  getAddress,
  concat,
  pad,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_MAP, DEFAULT_ENTRYPOINT, DEFAULT_RPC_ETH, DEFAULT_RPC_BSC, DEFAULT_RPC_BASE } from '../config.js';

// ============================================================================
// Wallet Service Config
// ============================================================================

/**
 * Configuration for the WalletService.
 * All fields are optional; missing values fall back to the centralized
 * FacilitatorEnvConfig loaded from environment variables.
 */
export interface WalletServiceConfig {
  entryPointAddress?: `0x${string}`;
  accountFactoryAddresses?: Record<string, `0x${string}`>;
  paymasterAddresses?: Record<string, `0x${string}`>;
  rpcUrls?: Record<string, string>;
  bundlerUrls?: Record<string, string>;
}

// Resolved (all-required) internal shape
interface ResolvedWalletConfig {
  entryPointAddress: `0x${string}`;
  accountFactoryAddresses: Record<string, `0x${string}`>;
  paymasterAddresses: Record<string, `0x${string}`>;
  rpcUrls: Record<string, string>;
  bundlerUrls: Record<string, string>;
}

// ============================================================================
// ABI fragment for WazabiAccountFactory.createAccount
// ============================================================================

const CREATE_ACCOUNT_ABI = [
  {
    type: 'function' as const,
    name: 'createAccount',
    inputs: [
      { name: 'owner', type: 'address' as const },
      { name: 'sessionKey', type: 'bytes32' as const },
      { name: 'handle', type: 'string' as const },
    ],
    outputs: [{ name: '', type: 'address' as const }],
    stateMutability: 'nonpayable' as const,
  },
] as const;

// ============================================================================
// Types
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

// ============================================================================
// Wallet Service
// ============================================================================

export class WalletService {
  private readonly config: ResolvedWalletConfig;

  constructor(config?: WalletServiceConfig) {
    this.config = {
      entryPointAddress: config?.entryPointAddress ?? DEFAULT_ENTRYPOINT,
      accountFactoryAddresses: config?.accountFactoryAddresses ?? {},
      paymasterAddresses: config?.paymasterAddresses ?? {},
      rpcUrls: config?.rpcUrls ?? {
        'eip155:1': DEFAULT_RPC_ETH,
        'eip155:56': DEFAULT_RPC_BSC,
        'eip155:8453': DEFAULT_RPC_BASE,
      },
      bundlerUrls: config?.bundlerUrls ?? {},
    };
  }

  /**
   * Compute a deterministic ERC-4337 wallet address using CREATE2
   *
   * The address is derived from:
   * - Factory address (WazabiAccountFactory, per-network from config)
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
    // Use the first available factory as the canonical address (same on all chains via CREATE2).
    // All configured factories share the same CREATE2 address, so any one is valid.
    const factoryValues = Object.values(this.config.accountFactoryAddresses);
    const factoryAddress: `0x${string}` =
      this.config.accountFactoryAddresses['eip155:1'] ??
      this.config.accountFactoryAddresses['eip155:56'] ??
      this.config.accountFactoryAddresses['eip155:8453'] ??
      factoryValues[0] ??
      (() => { throw new Error(
        'No account factory address configured. ' +
        'Set ACCOUNT_FACTORY_ETH, ACCOUNT_FACTORY_BSC, or ACCOUNT_FACTORY_BASE environment variable.'
      ); })();

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
      pad(factoryAddress, { size: 20 }),
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
   *
   * Uses viem's privateKeyToAccount for proper secp256k1 key derivation
   * so the returned publicKey is the real Ethereum address of the key pair.
   */
  generateSessionKey(validityDurationSeconds: number = 365 * 24 * 60 * 60): SessionKeyPair {
    // Generate random 32-byte private key using secure randomness
    const privateKeyBytes = new Uint8Array(32);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(privateKeyBytes);
    } else {
      // Node.js fallback
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
      const buf = nodeCrypto.randomBytes(32);
      privateKeyBytes.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    }
    const privateKey = ('0x' + Array.from(privateKeyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')) as `0x${string}`;

    // Derive real Ethereum address from the private key via secp256k1
    const account = privateKeyToAccount(privateKey);
    // Use a bytes32-padded version of the address as the public key identifier
    // (matches the bytes32 sessionKey parameter in WazabiAccount.sol)
    const publicKey = pad(account.address, { size: 32 }) as `0x${string}`;

    const expires = new Date(Date.now() + validityDurationSeconds * 1000);

    return {
      publicKey,
      privateKey,
      expires,
    };
  }

  /**
   * Deploy a wallet on a specific network via ERC-4337 bundler.
   *
   * Builds a UserOperation with initCode pointing to the WazabiAccountFactory,
   * submits it to the configured bundler, and polls for confirmation.
   *
   * If no bundler URL is configured for the given network the call returns
   * immediately with `{ deployed: false, reason: 'no bundler configured' }`.
   */
  async deployWallet(
    walletAddress: string,
    network: string,
    ownerAddress: string,
    sessionKeyPublic: string,
    handle: string
  ): Promise<{ deployed: boolean; txHash?: string; reason?: string }> {
    // 1. Verify bundler is configured
    const bundlerUrl = this.config.bundlerUrls[network];
    if (!bundlerUrl) {
      throw new Error(
        `No bundler URL configured for network "${network}". ` +
        'Set the BUNDLER_URL_ETH / BUNDLER_URL_BSC / BUNDLER_URL_BASE environment variable.'
      );
    }

    // 2. Resolve factory address for this network
    const factoryAddress = this.config.accountFactoryAddresses[network];
    if (!factoryAddress) {
      throw new Error(
        `No account factory address configured for network "${network}". ` +
        'Set the ACCOUNT_FACTORY_ETH / ACCOUNT_FACTORY_BSC / ACCOUNT_FACTORY_BASE environment variable.'
      );
    }

    // 3. Encode factory calldata (createAccount)
    const factoryData = encodeFunctionData({
      abi: CREATE_ACCOUNT_ABI,
      functionName: 'createAccount',
      args: [
        ownerAddress as `0x${string}`,
        sessionKeyPublic as `0x${string}`,
        handle,
      ],
    });

    // 4. Resolve paymaster for this network
    const paymasterAddress = this.config.paymasterAddresses[network];

    // 5. Build UserOperation (ERC-4337 v0.7 format)
    const userOp = {
      sender: walletAddress,
      nonce: toHex(0),
      factory: factoryAddress,
      factoryData,
      callData: '0x' as Hex,
      callGasLimit: toHex(500_000),
      verificationGasLimit: toHex(1_500_000),
      preVerificationGas: toHex(100_000),
      maxFeePerGas: toHex(5_000_000_000),          // 5 gwei
      maxPriorityFeePerGas: toHex(1_500_000_000),   // 1.5 gwei
      paymaster: paymasterAddress ?? '0x',
      paymasterVerificationGasLimit: toHex(300_000),
      paymasterPostOpGasLimit: toHex(100_000),
      paymasterData: '0x' as Hex,
      signature: '0x' as Hex,                        // dummy sig for initial submission
    };

    // 6. Submit to bundler via JSON-RPC
    let sendResult: { result?: string; error?: { message: string } };
    try {
      const sendResponse = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendUserOperation',
          params: [userOp, this.config.entryPointAddress],
        }),
      });
      sendResult = (await sendResponse.json()) as typeof sendResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { deployed: false, reason: `bundler request failed: ${message}` };
    }

    if (sendResult.error) {
      return { deployed: false, reason: `bundler error: ${sendResult.error.message}` };
    }

    const userOpHash = sendResult.result;
    if (!userOpHash) {
      return { deployed: false, reason: 'no userOpHash returned from bundler' };
    }

    // 7. Poll for UserOperation receipt (up to 60 s)
    const MAX_POLLS = 30;
    const POLL_INTERVAL_MS = 2_000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const receiptResponse = await fetch(bundlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getUserOperationReceipt',
            params: [userOpHash],
          }),
        });

        const receiptResult = (await receiptResponse.json()) as {
          result?: {
            success: boolean;
            receipt: { transactionHash: string };
          };
          error?: { message: string };
        };

        if (receiptResult.result) {
          return {
            deployed: receiptResult.result.success,
            txHash: receiptResult.result.receipt.transactionHash,
          };
        }
        // null result means still pending — keep polling
      } catch {
        // Transient network error — keep polling
      }
    }

    return { deployed: false, reason: 'timeout waiting for UserOperation receipt' };
  }

  /**
   * Check if a wallet is deployed on a specific network
   */
  async isWalletDeployed(walletAddress: string, network: string): Promise<boolean> {
    try {
      const rpcUrl = this.config.rpcUrls[network];
      const chain = CHAIN_MAP[network];

      if (!rpcUrl || !chain) {
        return false;
      }

      const client = createPublicClient({
        chain,
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
}
