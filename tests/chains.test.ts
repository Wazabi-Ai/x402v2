import { describe, it, expect } from 'vitest';
import {
  BSC_CHAIN_ID,
  BSC_CAIP_ID,
  BSC_RPC_URLS,
  BSC_DEFAULT_RPC,
  BSC_BLOCK_EXPLORER,
  BSC_USDT,
  BSC_USDC,
  BSC_WBNB,
  BSC_DEFAULT_TOKEN,
  BSC_TOKENS,
  BSC_TOKEN_BY_ADDRESS,
  BSC_NETWORK_CONFIG,
  getBscTokenByAddress,
  getBscTokenBySymbol,
  isBscTokenSupported,
  formatBscTokenAmount,
  parseBscTokenAmount,
  getBscTxUrl,
  getBscAddressUrl,
  getBscTokenUrl,
} from '../src/chains/bnb.js';
import {
  SUPPORTED_NETWORKS,
  getNetworkConfig,
  isNetworkSupported,
  getSupportedNetworkIds,
} from '../src/chains/index.js';

// ============================================================================
// Constants Tests
// ============================================================================

describe('BSC Constants', () => {
  it('should export correct BSC_CHAIN_ID', () => {
    expect(BSC_CHAIN_ID).toBe(56);
  });

  it('should export correct BSC_CAIP_ID', () => {
    expect(BSC_CAIP_ID).toBe('eip155:56');
  });

  it('should export multiple RPC URLs', () => {
    expect(BSC_RPC_URLS).toBeInstanceOf(Array);
    expect(BSC_RPC_URLS.length).toBeGreaterThan(1);
    expect(BSC_RPC_URLS[0]).toContain('binance.org');
  });

  it('should export default RPC URL', () => {
    expect(BSC_DEFAULT_RPC).toBe(BSC_RPC_URLS[0]);
    expect(BSC_DEFAULT_RPC).toContain('https://');
  });

  it('should export correct block explorer URL', () => {
    expect(BSC_BLOCK_EXPLORER).toBe('https://bscscan.com');
  });
});

// ============================================================================
// Token Configuration Tests
// ============================================================================

describe('Token Configurations', () => {
  describe('BSC_USDT', () => {
    it('should have correct address', () => {
      expect(BSC_USDT.address).toBe('0x55d398326f99059fF775485246999027B3197955');
    });

    it('should have correct symbol', () => {
      expect(BSC_USDT.symbol).toBe('USDT');
    });

    it('should have 18 decimals', () => {
      expect(BSC_USDT.decimals).toBe(18);
    });

    it('should have correct name', () => {
      expect(BSC_USDT.name).toBe('Tether USD');
    });
  });

  describe('BSC_USDC', () => {
    it('should have correct address', () => {
      expect(BSC_USDC.address).toBe('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
    });

    it('should have correct symbol', () => {
      expect(BSC_USDC.symbol).toBe('USDC');
    });

    it('should have 18 decimals', () => {
      expect(BSC_USDC.decimals).toBe(18);
    });
  });

  describe('BSC_WBNB', () => {
    it('should have correct configuration', () => {
      expect(BSC_WBNB.address).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
      expect(BSC_WBNB.symbol).toBe('WBNB');
      expect(BSC_WBNB.decimals).toBe(18);
    });
  });

  describe('BSC_DEFAULT_TOKEN', () => {
    it('should be USDT', () => {
      expect(BSC_DEFAULT_TOKEN).toEqual(BSC_USDT);
    });
  });

  describe('BSC_TOKENS', () => {
    it('should contain all tokens', () => {
      expect(BSC_TOKENS.USDT).toEqual(BSC_USDT);
      expect(BSC_TOKENS.USDC).toEqual(BSC_USDC);
      expect(BSC_TOKENS.WBNB).toEqual(BSC_WBNB);
    });

    it('should have 3 tokens', () => {
      expect(Object.keys(BSC_TOKENS)).toHaveLength(3);
    });
  });

  describe('BSC_TOKEN_BY_ADDRESS', () => {
    it('should map lowercase addresses to tokens', () => {
      expect(BSC_TOKEN_BY_ADDRESS[BSC_USDT.address.toLowerCase()]).toEqual(BSC_USDT);
      expect(BSC_TOKEN_BY_ADDRESS[BSC_USDC.address.toLowerCase()]).toEqual(BSC_USDC);
      expect(BSC_TOKEN_BY_ADDRESS[BSC_WBNB.address.toLowerCase()]).toEqual(BSC_WBNB);
    });
  });
});

// ============================================================================
// Network Configuration Tests
// ============================================================================

describe('BSC_NETWORK_CONFIG', () => {
  it('should have correct chain identifiers', () => {
    expect(BSC_NETWORK_CONFIG.caipId).toBe('eip155:56');
    expect(BSC_NETWORK_CONFIG.chainId).toBe(56);
  });

  it('should have correct network name', () => {
    expect(BSC_NETWORK_CONFIG.name).toBe('BNB Smart Chain');
  });

  it('should have correct native currency', () => {
    expect(BSC_NETWORK_CONFIG.nativeCurrency).toEqual({
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    });
  });

  it('should have block explorer URL', () => {
    expect(BSC_NETWORK_CONFIG.blockExplorer).toBe('https://bscscan.com');
  });

  it('should include tokens', () => {
    expect(BSC_NETWORK_CONFIG.tokens).toEqual(BSC_TOKENS);
  });
});

// ============================================================================
// Token Lookup Functions Tests
// ============================================================================

describe('getBscTokenByAddress', () => {
  it('should find token by exact address', () => {
    expect(getBscTokenByAddress(BSC_USDT.address)).toEqual(BSC_USDT);
    expect(getBscTokenByAddress(BSC_USDC.address)).toEqual(BSC_USDC);
  });

  it('should find token by lowercase address', () => {
    expect(getBscTokenByAddress(BSC_USDT.address.toLowerCase())).toEqual(BSC_USDT);
  });

  it('should find token by uppercase address', () => {
    expect(getBscTokenByAddress(BSC_USDT.address.toUpperCase())).toEqual(BSC_USDT);
  });

  it('should return undefined for unknown address', () => {
    expect(getBscTokenByAddress('0x0000000000000000000000000000000000000000')).toBeUndefined();
  });
});

describe('getBscTokenBySymbol', () => {
  it('should find token by symbol', () => {
    expect(getBscTokenBySymbol('USDT')).toEqual(BSC_USDT);
    expect(getBscTokenBySymbol('USDC')).toEqual(BSC_USDC);
    expect(getBscTokenBySymbol('WBNB')).toEqual(BSC_WBNB);
  });

  it('should be case-insensitive', () => {
    expect(getBscTokenBySymbol('usdt')).toEqual(BSC_USDT);
    expect(getBscTokenBySymbol('Usdt')).toEqual(BSC_USDT);
    expect(getBscTokenBySymbol('UsDt')).toEqual(BSC_USDT);
  });

  it('should return undefined for unknown symbol', () => {
    expect(getBscTokenBySymbol('ETH')).toBeUndefined();
    expect(getBscTokenBySymbol('DAI')).toBeUndefined();
  });
});

describe('isBscTokenSupported', () => {
  it('should return true for supported tokens', () => {
    expect(isBscTokenSupported(BSC_USDT.address)).toBe(true);
    expect(isBscTokenSupported(BSC_USDC.address)).toBe(true);
    expect(isBscTokenSupported(BSC_WBNB.address)).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isBscTokenSupported(BSC_USDT.address.toLowerCase())).toBe(true);
    expect(isBscTokenSupported(BSC_USDT.address.toUpperCase())).toBe(true);
  });

  it('should return false for unsupported tokens', () => {
    expect(isBscTokenSupported('0x0000000000000000000000000000000000000000')).toBe(false);
    expect(isBscTokenSupported('invalid')).toBe(false);
  });
});

// ============================================================================
// Amount Formatting Tests
// ============================================================================

describe('formatBscTokenAmount', () => {
  it('should format whole amounts correctly', () => {
    // 1 token (18 decimals)
    expect(formatBscTokenAmount('1000000000000000000', BSC_USDT.address)).toBe('1.00');
    // 10 tokens
    expect(formatBscTokenAmount('10000000000000000000', BSC_USDT.address)).toBe('10.00');
    // 100 tokens
    expect(formatBscTokenAmount('100000000000000000000', BSC_USDT.address)).toBe('100.00');
  });

  it('should format fractional amounts correctly', () => {
    // 1.5 tokens
    expect(formatBscTokenAmount('1500000000000000000', BSC_USDT.address)).toBe('1.50');
    // 0.1 tokens
    expect(formatBscTokenAmount('100000000000000000', BSC_USDT.address)).toBe('0.10');
    // 0.01 tokens
    expect(formatBscTokenAmount('10000000000000000', BSC_USDT.address)).toBe('0.01');
  });

  it('should handle small fractions', () => {
    // 0.001 tokens - should trim trailing zeros but keep 2 decimals
    expect(formatBscTokenAmount('1000000000000000', BSC_USDT.address)).toBe('0.001');
    // Very small amount
    expect(formatBscTokenAmount('1', BSC_USDT.address)).toBe('0.000000000000000001');
  });

  it('should handle bigint input', () => {
    expect(formatBscTokenAmount(BigInt('1000000000000000000'), BSC_USDT.address)).toBe('1.00');
  });

  it('should handle zero', () => {
    expect(formatBscTokenAmount('0', BSC_USDT.address)).toBe('0.00');
  });

  it('should default to 18 decimals for unknown tokens', () => {
    expect(formatBscTokenAmount('1000000000000000000', '0x0000000000000000000000000000000000000000')).toBe('1.00');
  });
});

describe('parseBscTokenAmount', () => {
  it('should parse whole amounts correctly', () => {
    expect(parseBscTokenAmount('1', BSC_USDT.address)).toBe(BigInt('1000000000000000000'));
    expect(parseBscTokenAmount('10', BSC_USDT.address)).toBe(BigInt('10000000000000000000'));
    expect(parseBscTokenAmount('100', BSC_USDT.address)).toBe(BigInt('100000000000000000000'));
  });

  it('should parse fractional amounts correctly', () => {
    expect(parseBscTokenAmount('1.5', BSC_USDT.address)).toBe(BigInt('1500000000000000000'));
    expect(parseBscTokenAmount('0.1', BSC_USDT.address)).toBe(BigInt('100000000000000000'));
    expect(parseBscTokenAmount('0.01', BSC_USDT.address)).toBe(BigInt('10000000000000000'));
  });

  it('should handle amounts without decimal point', () => {
    expect(parseBscTokenAmount('5', BSC_USDT.address)).toBe(BigInt('5000000000000000000'));
  });

  it('should truncate excess decimal places', () => {
    // More than 18 decimal places should be truncated
    expect(parseBscTokenAmount('1.0000000000000000001', BSC_USDT.address)).toBe(BigInt('1000000000000000000'));
  });

  it('should be inverse of formatBscTokenAmount', () => {
    const testAmounts = ['1', '10.5', '0.123456789', '1000000'];
    for (const amount of testAmounts) {
      const parsed = parseBscTokenAmount(amount, BSC_USDT.address);
      const formatted = formatBscTokenAmount(parsed, BSC_USDT.address);
      // Re-parse the formatted value and compare
      const reparsed = parseBscTokenAmount(formatted, BSC_USDT.address);
      expect(reparsed).toBe(parsed);
    }
  });
});

// ============================================================================
// URL Generation Tests
// ============================================================================

describe('getBscTxUrl', () => {
  it('should generate correct transaction URL', () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    expect(getBscTxUrl(txHash)).toBe(`https://bscscan.com/tx/${txHash}`);
  });
});

describe('getBscAddressUrl', () => {
  it('should generate correct address URL', () => {
    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123';
    expect(getBscAddressUrl(address)).toBe(`https://bscscan.com/address/${address}`);
  });
});

describe('getBscTokenUrl', () => {
  it('should generate correct token URL', () => {
    expect(getBscTokenUrl(BSC_USDT.address)).toBe(`https://bscscan.com/token/${BSC_USDT.address}`);
  });
});

// ============================================================================
// Network Registry Tests
// ============================================================================

describe('SUPPORTED_NETWORKS', () => {
  it('should contain BSC network', () => {
    expect(SUPPORTED_NETWORKS['eip155:56']).toEqual(BSC_NETWORK_CONFIG);
  });

  it('should contain Ethereum, BSC, and Base', () => {
    expect(Object.keys(SUPPORTED_NETWORKS)).toHaveLength(3);
    expect(SUPPORTED_NETWORKS).toHaveProperty('eip155:1');
    expect(SUPPORTED_NETWORKS).toHaveProperty('eip155:56');
    expect(SUPPORTED_NETWORKS).toHaveProperty('eip155:8453');
  });
});

describe('getNetworkConfig', () => {
  it('should return BSC config for BSC CAIP ID', () => {
    expect(getNetworkConfig('eip155:56')).toEqual(BSC_NETWORK_CONFIG);
  });

  it('should return ETH config for Ethereum CAIP ID', () => {
    expect(getNetworkConfig('eip155:1')).toBeDefined();
    expect(getNetworkConfig('eip155:1')?.name).toBe('Ethereum');
  });

  it('should return undefined for unsupported networks', () => {
    expect(getNetworkConfig('eip155:137')).toBeUndefined();
    expect(getNetworkConfig('invalid')).toBeUndefined();
  });
});

describe('isNetworkSupported', () => {
  it('should return true for BSC', () => {
    expect(isNetworkSupported('eip155:56')).toBe(true);
  });

  it('should return true for Ethereum', () => {
    expect(isNetworkSupported('eip155:1')).toBe(true);
  });

  it('should return false for other networks', () => {
    expect(isNetworkSupported('eip155:137')).toBe(false);
    expect(isNetworkSupported('')).toBe(false);
  });
});

describe('getSupportedNetworkIds', () => {
  it('should return array of supported network IDs', () => {
    const ids = getSupportedNetworkIds();
    expect(ids).toContain('eip155:1');
    expect(ids).toContain('eip155:56');
    expect(ids).toContain('eip155:8453');
    expect(ids).toHaveLength(3);
  });
});
