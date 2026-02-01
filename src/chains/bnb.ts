import type { NetworkConfig, TokenConfig } from '../types/index.js';

// ============================================================================
// BNB Smart Chain Configuration
// ============================================================================

export const BSC_CHAIN_ID = 56 as const;

export const BSC_CAIP_ID = 'eip155:56' as const;

export const BSC_RPC_URLS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed4.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
] as const;

export const BSC_DEFAULT_RPC = BSC_RPC_URLS[0];

export const BSC_BLOCK_EXPLORER = 'https://bscscan.com' as const;

// ============================================================================
// Token Configurations
// ============================================================================

export const BSC_USDT: TokenConfig = {
  address: '0x55d398326f99059fF775485246999027B3197955',
  symbol: 'USDT',
  decimals: 18,
  name: 'Tether USD',
} as const;

export const BSC_USDC: TokenConfig = {
  address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  symbol: 'USDC',
  decimals: 18,
  name: 'USD Coin',
} as const;

export const BSC_WBNB: TokenConfig = {
  address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  symbol: 'WBNB',
  decimals: 18,
  name: 'Wrapped BNB',
} as const;

export const BSC_DEFAULT_TOKEN = BSC_USDT;

export const BSC_TOKENS = {
  USDT: BSC_USDT,
  USDC: BSC_USDC,
  WBNB: BSC_WBNB,
} as const;

export const BSC_TOKEN_BY_ADDRESS: Record<string, TokenConfig> = {
  [BSC_USDT.address.toLowerCase()]: BSC_USDT,
  [BSC_USDC.address.toLowerCase()]: BSC_USDC,
  [BSC_WBNB.address.toLowerCase()]: BSC_WBNB,
};

// ============================================================================
// Network Configuration
// ============================================================================

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

export function getBscTokenByAddress(address: string): TokenConfig | undefined {
  return BSC_TOKEN_BY_ADDRESS[address.toLowerCase()];
}

export function getBscTokenBySymbol(symbol: string): TokenConfig | undefined {
  const upperSymbol = symbol.toUpperCase();
  return BSC_TOKENS[upperSymbol as keyof typeof BSC_TOKENS];
}

export function isBscTokenSupported(address: string): boolean {
  return address.toLowerCase() in BSC_TOKEN_BY_ADDRESS;
}

export function formatBscTokenAmount(
  amount: bigint | string,
  tokenAddress: string
): string {
  const token = getBscTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;

  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${wholePart}.${trimmedFractional}`;
}

export function parseBscTokenAmount(
  amount: string,
  tokenAddress: string
): bigint {
  const token = getBscTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;

  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);

  return BigInt(whole + paddedFractional);
}

export function getBscTxUrl(txHash: string): string {
  return `${BSC_BLOCK_EXPLORER}/tx/${txHash}`;
}

export function getBscAddressUrl(address: string): string {
  return `${BSC_BLOCK_EXPLORER}/address/${address}`;
}

export function getBscTokenUrl(tokenAddress: string): string {
  return `${BSC_BLOCK_EXPLORER}/token/${tokenAddress}`;
}
