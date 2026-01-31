import { describe, it, expect } from 'vitest';
import {
  HANDLE_SUFFIX,
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  AGENT_SUPPORTED_NETWORKS,
  HANDLE_REGEX,
  HandleSchema,
  RegisterRequestSchema,
  SettleRequestSchema,
  toFullHandle,
  toShortHandle,
  isFullHandle,
  isAddress,
  calculateFee,
  calculateNet,
} from '../src/facilitator/types.js';

// ============================================================================
// Constants Tests
// ============================================================================

describe('Facilitator Constants', () => {
  it('should have correct handle suffix', () => {
    expect(HANDLE_SUFFIX).toBe('.wazabi-x402');
  });

  it('should have correct settlement fee rate (0.5%)', () => {
    expect(SETTLEMENT_FEE_RATE).toBe(0.005);
  });

  it('should have correct settlement fee basis points', () => {
    expect(SETTLEMENT_FEE_BPS).toBe(50);
  });

  it('should support BNB Chain and Base', () => {
    expect(AGENT_SUPPORTED_NETWORKS).toContain('eip155:56');
    expect(AGENT_SUPPORTED_NETWORKS).toContain('eip155:8453');
    expect(AGENT_SUPPORTED_NETWORKS).toHaveLength(2);
  });
});

// ============================================================================
// Handle Validation Tests
// ============================================================================

describe('Handle Validation', () => {
  describe('HANDLE_REGEX', () => {
    it('should accept valid handles', () => {
      expect(HANDLE_REGEX.test('molty')).toBe(true);
      expect(HANDLE_REGEX.test('agent-x')).toBe(true);
      expect(HANDLE_REGEX.test('my_agent')).toBe(true);
      expect(HANDLE_REGEX.test('agent123')).toBe(true);
      expect(HANDLE_REGEX.test('a2b')).toBe(true);
    });

    it('should reject handles shorter than 3 chars', () => {
      expect(HANDLE_REGEX.test('ab')).toBe(false);
      expect(HANDLE_REGEX.test('a')).toBe(false);
    });

    it('should reject handles starting with hyphen/underscore', () => {
      expect(HANDLE_REGEX.test('-agent')).toBe(false);
      expect(HANDLE_REGEX.test('_agent')).toBe(false);
    });

    it('should reject handles ending with hyphen/underscore', () => {
      expect(HANDLE_REGEX.test('agent-')).toBe(false);
      expect(HANDLE_REGEX.test('agent_')).toBe(false);
    });

    it('should reject handles with uppercase letters', () => {
      expect(HANDLE_REGEX.test('Molty')).toBe(false);
      expect(HANDLE_REGEX.test('AGENT')).toBe(false);
    });

    it('should reject handles with special characters', () => {
      expect(HANDLE_REGEX.test('agent.name')).toBe(false);
      expect(HANDLE_REGEX.test('agent@name')).toBe(false);
      expect(HANDLE_REGEX.test('agent name')).toBe(false);
    });
  });

  describe('HandleSchema (Zod)', () => {
    it('should accept valid handle', () => {
      const result = HandleSchema.safeParse('molty');
      expect(result.success).toBe(true);
    });

    it('should reject empty string', () => {
      const result = HandleSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should reject too-short handle', () => {
      const result = HandleSchema.safeParse('ab');
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('RegisterRequestSchema', () => {
  it('should accept valid registration', () => {
    const result = RegisterRequestSchema.safeParse({
      handle: 'molty',
      networks: ['eip155:56', 'eip155:8453'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept registration with owner', () => {
    const result = RegisterRequestSchema.safeParse({
      handle: 'molty',
      networks: ['eip155:8453'],
      owner: '0x1234567890abcdef1234567890abcdef12345678',
    });
    expect(result.success).toBe(true);
  });

  it('should accept registration with metadata', () => {
    const result = RegisterRequestSchema.safeParse({
      handle: 'molty',
      metadata: { agent_type: 'openclaw', moltbook_id: 'u/molty' },
    });
    expect(result.success).toBe(true);
  });

  it('should default networks to both chains', () => {
    const result = RegisterRequestSchema.safeParse({ handle: 'molty' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.networks).toEqual(['eip155:56', 'eip155:8453']);
    }
  });

  it('should reject invalid handle', () => {
    const result = RegisterRequestSchema.safeParse({
      handle: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid owner address', () => {
    const result = RegisterRequestSchema.safeParse({
      handle: 'molty',
      owner: 'not-an-address',
    });
    expect(result.success).toBe(false);
  });
});

describe('SettleRequestSchema', () => {
  it('should accept valid settle request', () => {
    const result = SettleRequestSchema.safeParse({
      from: 'molty',
      to: 'agent-b',
      amount: '10.00',
      token: 'USDC',
      network: 'eip155:8453',
    });
    expect(result.success).toBe(true);
  });

  it('should default token and network', () => {
    const result = SettleRequestSchema.safeParse({
      from: 'molty',
      to: '0x1234567890abcdef1234567890abcdef12345678',
      amount: '5.00',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBe('USDC');
      expect(result.data.network).toBe('eip155:8453');
    }
  });

  it('should reject missing from', () => {
    const result = SettleRequestSchema.safeParse({
      to: 'agent-b',
      amount: '10.00',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid amount format', () => {
    const result = SettleRequestSchema.safeParse({
      from: 'molty',
      to: 'agent-b',
      amount: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Handle Utility Functions', () => {
  describe('toFullHandle', () => {
    it('should append suffix to short handle', () => {
      expect(toFullHandle('molty')).toBe('molty.wazabi-x402');
    });

    it('should not double-append suffix', () => {
      expect(toFullHandle('molty.wazabi-x402')).toBe('molty.wazabi-x402');
    });
  });

  describe('toShortHandle', () => {
    it('should remove suffix from full handle', () => {
      expect(toShortHandle('molty.wazabi-x402')).toBe('molty');
    });

    it('should return unchanged if no suffix', () => {
      expect(toShortHandle('molty')).toBe('molty');
    });
  });

  describe('isFullHandle', () => {
    it('should return true for full handle', () => {
      expect(isFullHandle('molty.wazabi-x402')).toBe(true);
    });

    it('should return false for short handle', () => {
      expect(isFullHandle('molty')).toBe(false);
    });
  });

  describe('isAddress', () => {
    it('should return true for valid address', () => {
      expect(isAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
    });

    it('should return false for handle', () => {
      expect(isAddress('molty')).toBe(false);
    });

    it('should return false for short hex', () => {
      expect(isAddress('0x1234')).toBe(false);
    });
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
