import type { NetworkConfig, TokenConfig } from '../types/index.js';

// ============================================================================
// Base (Coinbase L2) Configuration
// ============================================================================

/**
 * Base Mainnet Chain ID
 */
export const BASE_CHAIN_ID = 8453 as const;

/**
 * Base CAIP-2 Identifier
 */
export const BASE_CAIP_ID = 'eip155:8453' as const;

/**
 * Base public RPC endpoints
 */
export const BASE_RPC_URLS = [
  'https://mainnet.base.org',
  'https://base.gateway.tenderly.co',
  'https://base-mainnet.public.blastapi.io',
] as const;

/**
 * Default Base RPC URL
 */
export const BASE_DEFAULT_RPC = BASE_RPC_URLS[0];

/**
 * BaseScan block explorer URL
 */
export const BASE_BLOCK_EXPLORER = 'https://basescan.org' as const;

// ============================================================================
// Token Configurations
// ============================================================================

/**
 * Base USDC (USD Coin) Token Configuration
 * Native USDC on Base (6 decimals)
 * @see https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */
export const BASE_USDC: TokenConfig = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
} as const;

/**
 * Default token for payments on Base (USDC)
 */
export const BASE_DEFAULT_TOKEN = BASE_USDC;

/**
 * All supported tokens on Base
 */
export const BASE_TOKENS = {
  USDC: BASE_USDC,
} as const;

/**
 * Token address to config mapping for quick lookup
 */
export const BASE_TOKEN_BY_ADDRESS: Record<string, TokenConfig> = {
  [BASE_USDC.address.toLowerCase()]: BASE_USDC,
};

// ============================================================================
// Network Configuration
// ============================================================================

/**
 * Complete Base network configuration
 */
export const BASE_NETWORK_CONFIG: NetworkConfig = {
  caipId: BASE_CAIP_ID,
  chainId: BASE_CHAIN_ID,
  name: 'Base',
  rpcUrl: BASE_DEFAULT_RPC,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  blockExplorer: BASE_BLOCK_EXPLORER,
  tokens: BASE_TOKENS,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get token configuration by address on Base
 */
export function getBaseTokenByAddress(address: string): TokenConfig | undefined {
  return BASE_TOKEN_BY_ADDRESS[address.toLowerCase()];
}

/**
 * Get token configuration by symbol on Base
 */
export function getBaseTokenBySymbol(symbol: string): TokenConfig | undefined {
  const upperSymbol = symbol.toUpperCase();
  return BASE_TOKENS[upperSymbol as keyof typeof BASE_TOKENS];
}

/**
 * Check if a token address is supported on Base
 */
export function isBaseTokenSupported(address: string): boolean {
  return address.toLowerCase() in BASE_TOKEN_BY_ADDRESS;
}

/**
 * Get BaseScan URL for a transaction
 */
export function getBaseTxUrl(txHash: string): string {
  return `${BASE_BLOCK_EXPLORER}/tx/${txHash}`;
}

/**
 * Get BaseScan URL for an address
 */
export function getBaseAddressUrl(address: string): string {
  return `${BASE_BLOCK_EXPLORER}/address/${address}`;
}
