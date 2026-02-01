import type { NetworkConfig, TokenConfig } from '../types/index.js';

// ============================================================================
// Ethereum Mainnet Configuration
// ============================================================================

/**
 * Ethereum Mainnet Chain ID
 */
export const ETH_CHAIN_ID = 1 as const;

/**
 * Ethereum CAIP-2 Identifier
 */
export const ETH_CAIP_ID = 'eip155:1' as const;

/**
 * Ethereum public RPC endpoints
 */
export const ETH_RPC_URLS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum-rpc.publicnode.com',
] as const;

/**
 * Default Ethereum RPC URL
 */
export const ETH_DEFAULT_RPC = ETH_RPC_URLS[0];

/**
 * Etherscan block explorer URL
 */
export const ETH_BLOCK_EXPLORER = 'https://etherscan.io' as const;

// ============================================================================
// Token Configurations
// ============================================================================

/**
 * Ethereum USDC (USD Coin) Token Configuration
 * Native USDC on Ethereum (6 decimals)
 * @see https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 */
export const ETH_USDC: TokenConfig = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  supportsERC3009: true,
} as const;

/**
 * Ethereum USDT (Tether USD) Token Configuration
 * @see https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7
 */
export const ETH_USDT: TokenConfig = {
  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD',
} as const;

/**
 * Wrapped Ether (WETH) Token Configuration
 * @see https://etherscan.io/token/0xC02aaA39b223FE8D0A0e5CBf4476fA5052862670
 */
export const ETH_WETH: TokenConfig = {
  address: '0xC02aaA39b223FE8D0A0e5CBf4476fA5052862670',
  symbol: 'WETH',
  decimals: 18,
  name: 'Wrapped Ether',
} as const;

/**
 * Default token for payments on Ethereum (USDC)
 */
export const ETH_DEFAULT_TOKEN = ETH_USDC;

/**
 * All supported tokens on Ethereum
 */
export const ETH_TOKENS = {
  USDC: ETH_USDC,
  USDT: ETH_USDT,
  WETH: ETH_WETH,
} as const;

/**
 * Token address to config mapping for quick lookup
 */
export const ETH_TOKEN_BY_ADDRESS: Record<string, TokenConfig> = {
  [ETH_USDC.address.toLowerCase()]: ETH_USDC,
  [ETH_USDT.address.toLowerCase()]: ETH_USDT,
  [ETH_WETH.address.toLowerCase()]: ETH_WETH,
};

// ============================================================================
// Network Configuration
// ============================================================================

/**
 * Complete Ethereum mainnet network configuration
 */
export const ETH_NETWORK_CONFIG: NetworkConfig = {
  caipId: ETH_CAIP_ID,
  chainId: ETH_CHAIN_ID,
  name: 'Ethereum',
  rpcUrl: ETH_DEFAULT_RPC,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  blockExplorer: ETH_BLOCK_EXPLORER,
  tokens: ETH_TOKENS,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get token configuration by address on Ethereum
 */
export function getEthTokenByAddress(address: string): TokenConfig | undefined {
  return ETH_TOKEN_BY_ADDRESS[address.toLowerCase()];
}

/**
 * Get token configuration by symbol on Ethereum
 */
export function getEthTokenBySymbol(symbol: string): TokenConfig | undefined {
  const upperSymbol = symbol.toUpperCase();
  return ETH_TOKENS[upperSymbol as keyof typeof ETH_TOKENS];
}

/**
 * Check if a token address is supported on Ethereum
 */
export function isEthTokenSupported(address: string): boolean {
  return address.toLowerCase() in ETH_TOKEN_BY_ADDRESS;
}

/**
 * Get Etherscan URL for a transaction
 */
export function getEthTxUrl(txHash: string): string {
  return `${ETH_BLOCK_EXPLORER}/tx/${txHash}`;
}

/**
 * Get Etherscan URL for an address
 */
export function getEthAddressUrl(address: string): string {
  return `${ETH_BLOCK_EXPLORER}/address/${address}`;
}

/**
 * Get Etherscan URL for a token
 */
export function getEthTokenUrl(tokenAddress: string): string {
  return `${ETH_BLOCK_EXPLORER}/token/${tokenAddress}`;
}

/**
 * Format token amount from smallest unit to human-readable string (Ethereum tokens)
 */
export function formatEthTokenAmount(
  amount: bigint | string,
  tokenAddress: string
): string {
  const token = getEthTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;

  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${wholePart}.${trimmedFractional}`;
}

/**
 * Parse human-readable amount to smallest unit (Ethereum tokens)
 */
export function parseEthTokenAmount(
  amount: string,
  tokenAddress: string
): bigint {
  const token = getEthTokenByAddress(tokenAddress);
  const decimals = token?.decimals ?? 18;

  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);

  return BigInt(whole + paddedFractional);
}
