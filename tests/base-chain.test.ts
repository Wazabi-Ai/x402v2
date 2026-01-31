import { describe, it, expect } from 'vitest';
import {
  BASE_CHAIN_ID,
  BASE_CAIP_ID,
  BASE_RPC_URLS,
  BASE_DEFAULT_RPC,
  BASE_BLOCK_EXPLORER,
  BASE_USDC,
  BASE_DEFAULT_TOKEN,
  BASE_TOKENS,
  BASE_TOKEN_BY_ADDRESS,
  BASE_NETWORK_CONFIG,
  getBaseTokenByAddress,
  getBaseTokenBySymbol,
  isBaseTokenSupported,
  getBaseTxUrl,
  getBaseAddressUrl,
} from '../src/chains/base.js';
import {
  SUPPORTED_NETWORKS,
  getNetworkConfig,
  isNetworkSupported,
  getSupportedNetworkIds,
  getTokenForNetwork,
} from '../src/chains/index.js';

// ============================================================================
// Base Constants Tests
// ============================================================================

describe('Base Constants', () => {
  it('should export correct BASE_CHAIN_ID', () => {
    expect(BASE_CHAIN_ID).toBe(8453);
  });

  it('should export correct BASE_CAIP_ID', () => {
    expect(BASE_CAIP_ID).toBe('eip155:8453');
  });

  it('should export multiple RPC URLs', () => {
    expect(BASE_RPC_URLS).toBeInstanceOf(Array);
    expect(BASE_RPC_URLS.length).toBeGreaterThan(0);
    expect(BASE_RPC_URLS[0]).toContain('base.org');
  });

  it('should export correct default RPC', () => {
    expect(BASE_DEFAULT_RPC).toBe('https://mainnet.base.org');
  });

  it('should export correct block explorer', () => {
    expect(BASE_BLOCK_EXPLORER).toBe('https://basescan.org');
  });
});

// ============================================================================
// Token Configuration Tests
// ============================================================================

describe('Base Token Configs', () => {
  describe('BASE_USDC', () => {
    it('should have correct address', () => {
      expect(BASE_USDC.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });

    it('should have correct symbol', () => {
      expect(BASE_USDC.symbol).toBe('USDC');
    });

    it('should have 6 decimals (native USDC)', () => {
      expect(BASE_USDC.decimals).toBe(6);
    });

    it('should have correct name', () => {
      expect(BASE_USDC.name).toBe('USD Coin');
    });
  });

  it('should set USDC as default token', () => {
    expect(BASE_DEFAULT_TOKEN).toEqual(BASE_USDC);
  });

  it('should include USDC in BASE_TOKENS', () => {
    expect(BASE_TOKENS.USDC).toEqual(BASE_USDC);
  });

  it('should have token lookup by address', () => {
    const lowercaseAddr = BASE_USDC.address.toLowerCase();
    expect(BASE_TOKEN_BY_ADDRESS[lowercaseAddr]).toEqual(BASE_USDC);
  });
});

// ============================================================================
// Network Configuration Tests
// ============================================================================

describe('Base Network Config', () => {
  it('should have correct CAIP ID', () => {
    expect(BASE_NETWORK_CONFIG.caipId).toBe('eip155:8453');
  });

  it('should have correct chain ID', () => {
    expect(BASE_NETWORK_CONFIG.chainId).toBe(8453);
  });

  it('should have correct name', () => {
    expect(BASE_NETWORK_CONFIG.name).toBe('Base');
  });

  it('should have ETH as native currency', () => {
    expect(BASE_NETWORK_CONFIG.nativeCurrency.symbol).toBe('ETH');
    expect(BASE_NETWORK_CONFIG.nativeCurrency.decimals).toBe(18);
  });

  it('should include tokens', () => {
    expect(BASE_NETWORK_CONFIG.tokens).toHaveProperty('USDC');
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Base Utility Functions', () => {
  describe('getBaseTokenByAddress', () => {
    it('should find USDC by address', () => {
      const token = getBaseTokenByAddress(BASE_USDC.address);
      expect(token).toEqual(BASE_USDC);
    });

    it('should find token with case-insensitive address', () => {
      const token = getBaseTokenByAddress(BASE_USDC.address.toLowerCase());
      expect(token).toEqual(BASE_USDC);
    });

    it('should return undefined for unknown address', () => {
      const token = getBaseTokenByAddress('0x0000000000000000000000000000000000000000');
      expect(token).toBeUndefined();
    });
  });

  describe('getBaseTokenBySymbol', () => {
    it('should find USDC by symbol', () => {
      const token = getBaseTokenBySymbol('USDC');
      expect(token).toEqual(BASE_USDC);
    });

    it('should be case-insensitive', () => {
      const token = getBaseTokenBySymbol('usdc');
      expect(token).toEqual(BASE_USDC);
    });

    it('should return undefined for unsupported symbol', () => {
      const token = getBaseTokenBySymbol('BUSD');
      expect(token).toBeUndefined();
    });
  });

  describe('isBaseTokenSupported', () => {
    it('should return true for USDC address', () => {
      expect(isBaseTokenSupported(BASE_USDC.address)).toBe(true);
    });

    it('should return false for unknown address', () => {
      expect(isBaseTokenSupported('0x0000000000000000000000000000000000000000')).toBe(false);
    });
  });

  describe('getBaseTxUrl', () => {
    it('should return BaseScan tx URL', () => {
      const url = getBaseTxUrl('0xabc123');
      expect(url).toBe('https://basescan.org/tx/0xabc123');
    });
  });

  describe('getBaseAddressUrl', () => {
    it('should return BaseScan address URL', () => {
      const url = getBaseAddressUrl('0x1234567890abcdef1234567890abcdef12345678');
      expect(url).toBe('https://basescan.org/address/0x1234567890abcdef1234567890abcdef12345678');
    });
  });
});

// ============================================================================
// Multi-Chain Registry Tests
// ============================================================================

describe('Multi-Chain Registry', () => {
  it('should include both BSC and Base in SUPPORTED_NETWORKS', () => {
    expect(SUPPORTED_NETWORKS).toHaveProperty('eip155:56');
    expect(SUPPORTED_NETWORKS).toHaveProperty('eip155:8453');
  });

  it('should return Base config by CAIP ID', () => {
    const config = getNetworkConfig('eip155:8453');
    expect(config).toBeDefined();
    expect(config?.name).toBe('Base');
  });

  it('should recognize Base as supported', () => {
    expect(isNetworkSupported('eip155:8453')).toBe(true);
  });

  it('should list both network IDs', () => {
    const ids = getSupportedNetworkIds();
    expect(ids).toContain('eip155:56');
    expect(ids).toContain('eip155:8453');
  });

  it('should find USDC on Base via getTokenForNetwork', () => {
    const token = getTokenForNetwork('eip155:8453', 'USDC');
    expect(token).toBeDefined();
    expect(token?.symbol).toBe('USDC');
  });

  it('should find USDT on BSC via getTokenForNetwork', () => {
    const token = getTokenForNetwork('eip155:56', 'USDT');
    expect(token).toBeDefined();
    expect(token?.symbol).toBe('USDT');
  });

  it('should return undefined for unsupported network', () => {
    const token = getTokenForNetwork('eip155:999', 'USDC');
    expect(token).toBeUndefined();
  });
});
