import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, type PublicClient, type WalletClient, type Chain } from 'viem';
import { mainnet, bsc, base } from 'viem/chains';

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_RPC_ETH = 'https://eth.llamarpc.com';
export const DEFAULT_RPC_BSC = 'https://bsc-dataseed.binance.org';
export const DEFAULT_RPC_BASE = 'https://mainnet.base.org';

export const CHAIN_MAP: Record<string, Chain> = {
  'eip155:1': mainnet,
  'eip155:56': bsc,
  'eip155:8453': base,
};

// ============================================================================
// Environment Config
// ============================================================================

export interface FacilitatorEnvConfig {
  treasuryAddress: `0x${string}`;
  treasuryPrivateKey: `0x${string}`;
  settlementAddresses: Record<string, `0x${string}`>;
  rpcUrls: Record<string, string>;
  port: number;
  portalDir: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): FacilitatorEnvConfig {
  const treasuryPrivateKey = requireEnv('TREASURY_PRIVATE_KEY') as `0x${string}`;
  const account = privateKeyToAccount(
    treasuryPrivateKey.startsWith('0x') ? treasuryPrivateKey : `0x${treasuryPrivateKey}`
  );

  return {
    treasuryAddress: account.address,
    treasuryPrivateKey: treasuryPrivateKey.startsWith('0x') ? treasuryPrivateKey : `0x${treasuryPrivateKey}`,
    settlementAddresses: {
      'eip155:1': optionalEnv('SETTLEMENT_ETH', '0x') as `0x${string}`,
      'eip155:56': optionalEnv('SETTLEMENT_BSC', '0x') as `0x${string}`,
      'eip155:8453': optionalEnv('SETTLEMENT_BASE', '0x') as `0x${string}`,
    },
    rpcUrls: {
      'eip155:1': optionalEnv('RPC_ETH', DEFAULT_RPC_ETH),
      'eip155:56': optionalEnv('RPC_BSC', DEFAULT_RPC_BSC),
      'eip155:8453': optionalEnv('RPC_BASE', DEFAULT_RPC_BASE),
    },
    port: parseInt(optionalEnv('PORT', '3000')),
    portalDir: optionalEnv('PORTAL_DIR', 'facilitator-portal'),
  };
}

// ============================================================================
// Create Viem Clients
// ============================================================================

export function createClients(config: FacilitatorEnvConfig): {
  publicClients: Record<string, PublicClient>;
  walletClients: Record<string, WalletClient>;
} {
  const account = privateKeyToAccount(config.treasuryPrivateKey);
  const publicClients: Record<string, PublicClient> = {};
  const walletClients: Record<string, WalletClient> = {};

  for (const [networkId, rpcUrl] of Object.entries(config.rpcUrls)) {
    const chain = CHAIN_MAP[networkId];
    if (!chain) continue;

    publicClients[networkId] = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    walletClients[networkId] = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
  }

  return { publicClients, walletClients };
}
