// Re-export all chain configurations
export * from './bnb.js';
export * from './base.js';
export * from './ethereum.js';

// Export a registry of all supported networks
import { BSC_NETWORK_CONFIG, BSC_CAIP_ID } from './bnb.js';
import { BASE_NETWORK_CONFIG, BASE_CAIP_ID } from './base.js';
import { ETH_NETWORK_CONFIG, ETH_CAIP_ID } from './ethereum.js';
import type { NetworkConfig, TokenConfig } from '../types/index.js';

/**
 * Registry of all supported networks
 * Ethereum Mainnet + BNB Smart Chain + Base (Coinbase L2)
 */
export const SUPPORTED_NETWORKS: Record<string, NetworkConfig> = {
  [ETH_CAIP_ID]: ETH_NETWORK_CONFIG,
  [BSC_CAIP_ID]: BSC_NETWORK_CONFIG,
  [BASE_CAIP_ID]: BASE_NETWORK_CONFIG,
} as const;

/**
 * Get network configuration by CAIP-2 ID
 */
export function getNetworkConfig(caipId: string): NetworkConfig | undefined {
  return SUPPORTED_NETWORKS[caipId];
}

/**
 * Check if a network is supported
 */
export function isNetworkSupported(caipId: string): boolean {
  return caipId in SUPPORTED_NETWORKS;
}

/**
 * Get all supported network IDs
 */
export function getSupportedNetworkIds(): string[] {
  return Object.keys(SUPPORTED_NETWORKS);
}

/**
 * Get token config by symbol across all networks for a given network
 */
export function getTokenForNetwork(caipId: string, symbol: string): TokenConfig | undefined {
  const network = SUPPORTED_NETWORKS[caipId];
  if (!network) return undefined;
  return network.tokens[symbol.toUpperCase()];
}
