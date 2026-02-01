import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_NETWORK_IDS,
  VerifyRequestSchema,
  isAddress,
  calculateFee,
  calculateNet,
} from '../src/facilitator/types.js';
import { DEFAULT_FEE_BPS } from '../src/types/index.js';

// ============================================================================
// Constants Tests
// ============================================================================

describe('Facilitator Constants', () => {
  it('should have correct default fee basis points', () => {
    expect(DEFAULT_FEE_BPS).toBe(50);
  });

  it('should support Ethereum, BNB Chain, and Base', () => {
    expect(SUPPORTED_NETWORK_IDS).toContain('eip155:1');
    expect(SUPPORTED_NETWORK_IDS).toContain('eip155:56');
    expect(SUPPORTED_NETWORK_IDS).toContain('eip155:8453');
    expect(SUPPORTED_NETWORK_IDS).toHaveLength(3);
  });
});

// ============================================================================
// VerifyRequestSchema Tests
// ============================================================================

describe('VerifyRequestSchema', () => {
  it('should accept valid verify request', () => {
    const result = VerifyRequestSchema.safeParse({
      from: '0x1234567890abcdef1234567890abcdef12345678',
      amount: '10.00',
      token: 'USDC',
      network: 'eip155:8453',
    });
    expect(result.success).toBe(true);
  });

  it('should default token and network', () => {
    const result = VerifyRequestSchema.safeParse({
      from: '0x1234567890abcdef1234567890abcdef12345678',
      amount: '5.00',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBe('USDC');
      expect(result.data.network).toBe('eip155:8453');
    }
  });

  it('should reject invalid address', () => {
    const result = VerifyRequestSchema.safeParse({
      from: 'not-an-address',
      amount: '10.00',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid amount format', () => {
    const result = VerifyRequestSchema.safeParse({
      from: '0x1234567890abcdef1234567890abcdef12345678',
      amount: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing from', () => {
    const result = VerifyRequestSchema.safeParse({
      amount: '10.00',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('isAddress', () => {
  it('should return true for valid address', () => {
    expect(isAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('should return false for non-address string', () => {
    expect(isAddress('molty')).toBe(false);
  });

  it('should return false for short hex', () => {
    expect(isAddress('0x1234')).toBe(false);
  });
});

describe('Fee Calculation', () => {
  describe('calculateFee', () => {
    it('should calculate 0.5% of $100', () => {
      expect(calculateFee('100')).toBe('0.50');
    });

    it('should calculate 0.5% of $10', () => {
      expect(calculateFee('10')).toBe('0.05');
    });

    it('should calculate 0.5% of $1000', () => {
      expect(calculateFee('1000')).toBe('5.00');
    });

    it('should handle small amounts', () => {
      const fee = calculateFee('0.10');
      expect(parseFloat(fee)).toBeCloseTo(0.0005, 4);
    });
  });

  describe('calculateNet', () => {
    it('should calculate net after fee and gas', () => {
      const net = calculateNet('100', '0.50', '0.02');
      expect(parseFloat(net)).toBeCloseTo(99.48, 2);
    });

    it('should handle zero gas', () => {
      const net = calculateNet('10', '0.05', '0');
      expect(parseFloat(net)).toBeCloseTo(9.95, 2);
    });
  });
});
