// Re-export all BNB chain configurations
export * from './bnb.js';

// Export a registry of all supported networks for future expansion
import { BSC_NETWORK_CONFIG, BSC_CAIP_ID } from './bnb.js';
import type { NetworkConfig } from '../types/index.js';

/**
 * Registry of all supported networks
 * Currently only BSC, but structured for future expansion
 */
export const SUPPORTED_NETWORKS: Record<string, NetworkConfig> = {
  [BSC_CAIP_ID]: BSC_NETWORK_CONFIG,
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
