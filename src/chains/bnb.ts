import type { NetworkConfig, TokenConfig } from '../types/index.js';

// ============================================================================
// BNB Smart Chain Configuration
// ============================================================================

/**
 * BNB Smart Chain (BSC) Mainnet Chain ID
 */
export const BSC_CHAIN_ID = 56 as const;

/**
 * BNB Smart Chain CAIP-2 Identifier
 */
export const BSC_CAIP_ID = 'eip155:56' as const;

/**
 * BNB Smart Chain public RPC endpoints
 * Using multiple for fallback support
 */
export const BSC_RPC_URLS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed4.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
] as const;

/**
 * Default BSC RPC URL
 */
export const BSC_DEFAULT_RPC = BSC_RPC_URLS[0];

/**
 * BscScan block explorer URL
 */
export const BSC_BLOCK_EXPLORER = 'https://bscscan.com' as const;

// ============================================================================
// Token Configurations
// ============================================================================

/**
 * BSC-USDT (Tether USD) Token Configuration
 * @see https://bscscan.com/token/0x55d398326f99059fF775485246999027B3197955
 */
export const BSC_USDT: TokenConfig = {
  address: '0x55d398326f99059fF775485246999027B3197955',
  symbol: 'USDT',
  decimals: 18,
  name: 'Tether USD',
} as const;

/**
 * BSC-USDC (USD Coin) Token Configuration
 * @see https://bscscan.com/token/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
 */
export const BSC_USDC: TokenConfig = {
  address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  symbol: 'USDC',
  decimals: 18,
  name: 'USD Coin',
} as const;

/**
 * BSC-BUSD (Binance USD) Token Configuration
 * @see https://bscscan.com/token/0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56
 */
export const BSC_BUSD: TokenConfig = {
  address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  symbol: 'BUSD',
  decimals: 18,
  name: 'Binance USD',
} as const;

/**
 * Wrapped BNB (WBNB) Token Configuration
 * @see https://bscscan.com/token/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
 */
export const BSC_WBNB: TokenConfig = {
  address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  symbol: 'BNB',
  decimals: 18,
  name: 'Wrapped BNB',
} as const;

/**
 * Default token for payments (BSC-USDT)
 */
export const BSC_DEFAULT_TOKEN = BSC_USDT;

/**
 * All supported tokens on BSC
 */
export const BSC_TOKENS = {
  USDT: BSC_USDT,
  USDC: BSC_USDC,
  BUSD: BSC_BUSD,
  WBNB: BSC_WBNB,
} as const;

/**
 * Token address to config mapping for quick lookup
 */
export const BSC_TOKEN_BY_ADDRESS: Record<string, TokenConfig> = {
  [BSC_USDT.address.toLowerCase()]: BSC_USDT,
  [BSC_USDC.address.toLowerCase()]: BSC_USDC,
  [BSC_BUSD.address.toLowerCase()]: BSC_BUSD,
  [BSC_WBNB.address.toLowerCase()]: BSC_WBNB,
};

// ============================================================================
// Network Configuration
// ============================================================================

/**
 * Complete BNB Smart Chain network configuration
 */
export const BSC_NETWORK_CONFIG: NetworkConfig = {
  caipId: BSC_CAIP_ID,
  chainId: BSC_CHAIN_ID,
  name: 'BNB Smart Chain',
  rpcUrl: BSC_DEFAULT_RPC,
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  blockExplorer: BSC_BLOCK_EXPLORER,
  tokens: BSC_TOKENS,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get token configuration by address
 */
export function getTokenByAddress(address: string): TokenConfig | undefined {
  return BSC_TOKEN_BY_ADDRESS[address.toLowerCase()];
}

/**
 * Get token configuration by symbol
 */
export function getTokenBySymbol(symbol: string): TokenConfig | undefined {
  const upperSymbol = symbol.toUpperCase();
  return BSC_TOKENS[upperSymbol as keyof typeof BSC_TOKENS];
}

/**
 * Check if a token address is supported on BSC
 */
export function isTokenSupported(address: string): boolean {
  return address.toLowerCase() in BSC_TOKEN_BY_ADDRESS;
}

/**
 * Format token amount from wei to human-readable string
 */
export function formatTokenAmount(
  amount: bigint | string,
  tokenAddress: string
): string {
  const token = getTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  
  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');
  
  return `${wholePart}.${trimmedFractional}`;
}

/**
 * Parse human-readable amount to wei
 */
export function parseTokenAmount(
  amount: string,
  tokenAddress: string
): bigint {
  const token = getTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;
  
  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  
  return BigInt(whole + paddedFractional);
}

/**
 * Get BscScan URL for a transaction
 */
export function getTxUrl(txHash: string): string {
  return `${BSC_BLOCK_EXPLORER}/tx/${txHash}`;
}

/**
 * Get BscScan URL for an address
 */
export function getAddressUrl(address: string): string {
  return `${BSC_BLOCK_EXPLORER}/address/${address}`;
}

/**
 * Get BscScan URL for a token
 */
export function getTokenUrl(tokenAddress: string): string {
  return `${BSC_BLOCK_EXPLORER}/token/${tokenAddress}`;
}
