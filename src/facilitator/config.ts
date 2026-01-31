import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, type PublicClient, type WalletClient, type Chain } from 'viem';
import { mainnet, bsc, base } from 'viem/chains';

// Load and validate environment configuration
export interface FacilitatorEnvConfig {
  // Treasury
  treasuryPrivateKey: `0x${string}`;
  treasuryAddress: `0x${string}`;

  // Contract addresses (per network CAIP-2 ID)
  entryPointAddress: `0x${string}`;
  accountFactoryAddresses: Record<string, `0x${string}`>;
  paymasterAddresses: Record<string, `0x${string}`>;

  // RPC endpoints
  rpcUrls: Record<string, string>;

  // Bundler
  bundlerUrls: Record<string, string>;

  // Database
  databaseUrl?: string;

  // Server
  port: number;
  portalDir?: string;
}

// Well-known ERC-4337 EntryPoint v0.7
export const DEFAULT_ENTRYPOINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as `0x${string}`;

// Default RPCs
export const DEFAULT_RPC_ETH = 'https://eth.llamarpc.com';
export const DEFAULT_RPC_BSC = 'https://bsc-dataseed.binance.org';
export const DEFAULT_RPC_BASE = 'https://mainnet.base.org';

export function loadConfig(): FacilitatorEnvConfig {
  const treasuryPrivateKey = requireEnv('TREASURY_PRIVATE_KEY') as `0x${string}`;
  const normalizedKey = treasuryPrivateKey.startsWith('0x')
    ? treasuryPrivateKey
    : `0x${treasuryPrivateKey}` as `0x${string}`;

  const account = privateKeyToAccount(normalizedKey);

  return {
    treasuryPrivateKey: normalizedKey,
    treasuryAddress: account.address,

    entryPointAddress: (process.env['ENTRYPOINT_ADDRESS'] as `0x${string}`) || DEFAULT_ENTRYPOINT,

    accountFactoryAddresses: {
      'eip155:1': requireEnv('ACCOUNT_FACTORY_ETH') as `0x${string}`,
      'eip155:56': requireEnv('ACCOUNT_FACTORY_BSC') as `0x${string}`,
      'eip155:8453': requireEnv('ACCOUNT_FACTORY_BASE') as `0x${string}`,
    },

    paymasterAddresses: {
      'eip155:1': requireEnv('PAYMASTER_ETH') as `0x${string}`,
      'eip155:56': requireEnv('PAYMASTER_BSC') as `0x${string}`,
      'eip155:8453': requireEnv('PAYMASTER_BASE') as `0x${string}`,
    },

    rpcUrls: {
      'eip155:1': process.env['RPC_ETH'] || DEFAULT_RPC_ETH,
      'eip155:56': process.env['RPC_BSC'] || DEFAULT_RPC_BSC,
      'eip155:8453': process.env['RPC_BASE'] || DEFAULT_RPC_BASE,
    },

    bundlerUrls: {
      'eip155:1': requireEnv('BUNDLER_URL_ETH'),
      'eip155:56': requireEnv('BUNDLER_URL_BSC'),
      'eip155:8453': requireEnv('BUNDLER_URL_BASE'),
    },

    databaseUrl: process.env['DATABASE_URL'],
    port: parseInt(process.env['PORT'] || '3000', 10),
    portalDir: process.env['PORTAL_DIR'],
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Viem chain objects by CAIP-2 ID
export const CHAIN_MAP: Record<string, Chain> = {
  'eip155:1': mainnet,
  'eip155:56': bsc,
  'eip155:8453': base,
};

// Create viem clients from config
export function createClients(config: FacilitatorEnvConfig) {
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

  return { account, publicClients, walletClients };
}
