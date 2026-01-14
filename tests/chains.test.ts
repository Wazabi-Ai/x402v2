import { describe, it, expect } from 'vitest';
import {
  BSC_CHAIN_ID,
  BSC_CAIP_ID,
  BSC_RPC_URLS,
  BSC_DEFAULT_RPC,
  BSC_BLOCK_EXPLORER,
  BSC_USDT,
  BSC_USDC,
  BSC_BUSD,
  BSC_WBNB,
  BSC_DEFAULT_TOKEN,
  BSC_TOKENS,
  BSC_TOKEN_BY_ADDRESS,
  BSC_NETWORK_CONFIG,
  getTokenByAddress,
  getTokenBySymbol,
  isTokenSupported,
  formatTokenAmount,
  parseTokenAmount,
  getTxUrl,
  getAddressUrl,
  getTokenUrl,
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

  describe('BSC_BUSD', () => {
    it('should have correct configuration', () => {
      expect(BSC_BUSD.address).toBe('0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56');
      expect(BSC_BUSD.symbol).toBe('BUSD');
      expect(BSC_BUSD.decimals).toBe(18);
    });
  });

  describe('BSC_WBNB', () => {
    it('should have correct configuration', () => {
      expect(BSC_WBNB.address).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
      expect(BSC_WBNB.symbol).toBe('BNB');
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
      expect(BSC_TOKENS.BUSD).toEqual(BSC_BUSD);
      expect(BSC_TOKENS.WBNB).toEqual(BSC_WBNB);
    });

    it('should have 4 tokens', () => {
      expect(Object.keys(BSC_TOKENS)).toHaveLength(4);
    });
  });

  describe('BSC_TOKEN_BY_ADDRESS', () => {
    it('should map lowercase addresses to tokens', () => {
      expect(BSC_TOKEN_BY_ADDRESS[BSC_USDT.address.toLowerCase()]).toEqual(BSC_USDT);
      expect(BSC_TOKEN_BY_ADDRESS[BSC_USDC.address.toLowerCase()]).toEqual(BSC_USDC);
      expect(BSC_TOKEN_BY_ADDRESS[BSC_BUSD.address.toLowerCase()]).toEqual(BSC_BUSD);
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

describe('getTokenByAddress', () => {
  it('should find token by exact address', () => {
    expect(getTokenByAddress(BSC_USDT.address)).toEqual(BSC_USDT);
    expect(getTokenByAddress(BSC_USDC.address)).toEqual(BSC_USDC);
  });

  it('should find token by lowercase address', () => {
    expect(getTokenByAddress(BSC_USDT.address.toLowerCase())).toEqual(BSC_USDT);
  });

  it('should find token by uppercase address', () => {
    expect(getTokenByAddress(BSC_USDT.address.toUpperCase())).toEqual(BSC_USDT);
  });

  it('should return undefined for unknown address', () => {
    expect(getTokenByAddress('0x0000000000000000000000000000000000000000')).toBeUndefined();
  });
});

describe('getTokenBySymbol', () => {
  it('should find token by symbol', () => {
    expect(getTokenBySymbol('USDT')).toEqual(BSC_USDT);
    expect(getTokenBySymbol('USDC')).toEqual(BSC_USDC);
    expect(getTokenBySymbol('BUSD')).toEqual(BSC_BUSD);
    expect(getTokenBySymbol('WBNB')).toEqual(BSC_WBNB);
  });

  it('should be case-insensitive', () => {
    expect(getTokenBySymbol('usdt')).toEqual(BSC_USDT);
    expect(getTokenBySymbol('Usdt')).toEqual(BSC_USDT);
    expect(getTokenBySymbol('UsDt')).toEqual(BSC_USDT);
  });

  it('should return undefined for unknown symbol', () => {
    expect(getTokenBySymbol('ETH')).toBeUndefined();
    expect(getTokenBySymbol('DAI')).toBeUndefined();
  });
});

describe('isTokenSupported', () => {
  it('should return true for supported tokens', () => {
    expect(isTokenSupported(BSC_USDT.address)).toBe(true);
    expect(isTokenSupported(BSC_USDC.address)).toBe(true);
    expect(isTokenSupported(BSC_BUSD.address)).toBe(true);
    expect(isTokenSupported(BSC_WBNB.address)).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isTokenSupported(BSC_USDT.address.toLowerCase())).toBe(true);
    expect(isTokenSupported(BSC_USDT.address.toUpperCase())).toBe(true);
  });

  it('should return false for unsupported tokens', () => {
    expect(isTokenSupported('0x0000000000000000000000000000000000000000')).toBe(false);
    expect(isTokenSupported('invalid')).toBe(false);
  });
});

// ============================================================================
// Amount Formatting Tests
// ============================================================================

describe('formatTokenAmount', () => {
  it('should format whole amounts correctly', () => {
    // 1 token (18 decimals)
    expect(formatTokenAmount('1000000000000000000', BSC_USDT.address)).toBe('1.00');
    // 10 tokens
    expect(formatTokenAmount('10000000000000000000', BSC_USDT.address)).toBe('10.00');
    // 100 tokens
    expect(formatTokenAmount('100000000000000000000', BSC_USDT.address)).toBe('100.00');
  });

  it('should format fractional amounts correctly', () => {
    // 1.5 tokens
    expect(formatTokenAmount('1500000000000000000', BSC_USDT.address)).toBe('1.50');
    // 0.1 tokens
    expect(formatTokenAmount('100000000000000000', BSC_USDT.address)).toBe('0.10');
    // 0.01 tokens
    expect(formatTokenAmount('10000000000000000', BSC_USDT.address)).toBe('0.01');
  });

  it('should handle small fractions', () => {
    // 0.001 tokens - should trim trailing zeros but keep 2 decimals
    expect(formatTokenAmount('1000000000000000', BSC_USDT.address)).toBe('0.001');
    // Very small amount
    expect(formatTokenAmount('1', BSC_USDT.address)).toBe('0.000000000000000001');
  });

  it('should handle bigint input', () => {
    expect(formatTokenAmount(BigInt('1000000000000000000'), BSC_USDT.address)).toBe('1.00');
  });

  it('should handle zero', () => {
    expect(formatTokenAmount('0', BSC_USDT.address)).toBe('0.00');
  });

  it('should default to 18 decimals for unknown tokens', () => {
    expect(formatTokenAmount('1000000000000000000', '0x0000000000000000000000000000000000000000')).toBe('1.00');
  });
});

describe('parseTokenAmount', () => {
  it('should parse whole amounts correctly', () => {
    expect(parseTokenAmount('1', BSC_USDT.address)).toBe(BigInt('1000000000000000000'));
    expect(parseTokenAmount('10', BSC_USDT.address)).toBe(BigInt('10000000000000000000'));
    expect(parseTokenAmount('100', BSC_USDT.address)).toBe(BigInt('100000000000000000000'));
  });

  it('should parse fractional amounts correctly', () => {
    expect(parseTokenAmount('1.5', BSC_USDT.address)).toBe(BigInt('1500000000000000000'));
    expect(parseTokenAmount('0.1', BSC_USDT.address)).toBe(BigInt('100000000000000000'));
    expect(parseTokenAmount('0.01', BSC_USDT.address)).toBe(BigInt('10000000000000000'));
  });

  it('should handle amounts without decimal point', () => {
    expect(parseTokenAmount('5', BSC_USDT.address)).toBe(BigInt('5000000000000000000'));
  });

  it('should truncate excess decimal places', () => {
    // More than 18 decimal places should be truncated
    expect(parseTokenAmount('1.0000000000000000001', BSC_USDT.address)).toBe(BigInt('1000000000000000000'));
  });

  it('should be inverse of formatTokenAmount', () => {
    const testAmounts = ['1', '10.5', '0.123456789', '1000000'];
    for (const amount of testAmounts) {
      const parsed = parseTokenAmount(amount, BSC_USDT.address);
      const formatted = formatTokenAmount(parsed, BSC_USDT.address);
      // Re-parse the formatted value and compare
      const reparsed = parseTokenAmount(formatted, BSC_USDT.address);
      expect(reparsed).toBe(parsed);
    }
  });
});

// ============================================================================
// URL Generation Tests
// ============================================================================

describe('getTxUrl', () => {
  it('should generate correct transaction URL', () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    expect(getTxUrl(txHash)).toBe(`https://bscscan.com/tx/${txHash}`);
  });
});

describe('getAddressUrl', () => {
  it('should generate correct address URL', () => {
    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123';
    expect(getAddressUrl(address)).toBe(`https://bscscan.com/address/${address}`);
  });
});

describe('getTokenUrl', () => {
  it('should generate correct token URL', () => {
    expect(getTokenUrl(BSC_USDT.address)).toBe(`https://bscscan.com/token/${BSC_USDT.address}`);
  });
});

// ============================================================================
// Network Registry Tests
// ============================================================================

describe('SUPPORTED_NETWORKS', () => {
  it('should contain BSC network', () => {
    expect(SUPPORTED_NETWORKS['eip155:56']).toEqual(BSC_NETWORK_CONFIG);
  });

  it('should only contain BSC for now', () => {
    expect(Object.keys(SUPPORTED_NETWORKS)).toHaveLength(1);
  });
});

describe('getNetworkConfig', () => {
  it('should return BSC config for BSC CAIP ID', () => {
    expect(getNetworkConfig('eip155:56')).toEqual(BSC_NETWORK_CONFIG);
  });

  it('should return undefined for unsupported networks', () => {
    expect(getNetworkConfig('eip155:1')).toBeUndefined();
    expect(getNetworkConfig('eip155:137')).toBeUndefined();
    expect(getNetworkConfig('invalid')).toBeUndefined();
  });
});

describe('isNetworkSupported', () => {
  it('should return true for BSC', () => {
    expect(isNetworkSupported('eip155:56')).toBe(true);
  });

  it('should return false for other networks', () => {
    expect(isNetworkSupported('eip155:1')).toBe(false);
    expect(isNetworkSupported('eip155:137')).toBe(false);
    expect(isNetworkSupported('')).toBe(false);
  });
});

describe('getSupportedNetworkIds', () => {
  it('should return array of supported network IDs', () => {
    const ids = getSupportedNetworkIds();
    expect(ids).toContain('eip155:56');
    expect(ids).toHaveLength(1);
  });
});
