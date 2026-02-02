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

/** Known deployed WazabiSettlement contract addresses */
export const KNOWN_SETTLEMENTS: Record<string, `0x${string}`> = {
  'eip155:56': '0x7c831477A025e05DbaB31ab91A792c1006beb0c6',
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

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function optionalAddress(name: string): `0x${string}` | undefined {
  const value = process.env[name];
  if (value && ADDRESS_RE.test(value)) return value as `0x${string}`;
  return undefined;
}

function buildSettlementAddresses(): Record<string, `0x${string}`> {
  // Start with known deployed addresses as defaults
  const result: Record<string, `0x${string}`> = { ...KNOWN_SETTLEMENTS };
  // Environment variables override known defaults
  const entries: [string, string][] = [
    ['eip155:1', 'SETTLEMENT_ETH'],
    ['eip155:56', 'SETTLEMENT_BSC'],
    ['eip155:8453', 'SETTLEMENT_BASE'],
  ];
  for (const [networkId, envName] of entries) {
    const addr = optionalAddress(envName);
    if (addr) result[networkId] = addr;
  }
  return result;
}

export function loadConfig(): FacilitatorEnvConfig {
  const treasuryPrivateKey = requireEnv('TREASURY_PRIVATE_KEY') as `0x${string}`;
  const account = privateKeyToAccount(
    treasuryPrivateKey.startsWith('0x') ? treasuryPrivateKey : `0x${treasuryPrivateKey}`
  );

  return {
    treasuryAddress: account.address,
    treasuryPrivateKey: treasuryPrivateKey.startsWith('0x') ? treasuryPrivateKey : `0x${treasuryPrivateKey}`,
    settlementAddresses: buildSettlementAddresses(),
    rpcUrls: {
      'eip155:1': optionalEnv('RPC_ETH', DEFAULT_RPC_ETH),
      'eip155:56': optionalEnv('RPC_BSC', DEFAULT_RPC_BSC),
      'eip155:8453': optionalEnv('RPC_BASE', DEFAULT_RPC_BASE),
    },
    port: parseInt(optionalEnv('PORT', '3000')),
    portalDir: optionalEnv('PORTAL_DIR', 'apps/facilitator-portal'),
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
