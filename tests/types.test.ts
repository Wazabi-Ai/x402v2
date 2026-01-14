import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  X402_VERSION,
  X402_DOMAIN_NAME,
  X402_HEADERS,
  PAYMENT_TYPES,
  PaymentRequirementSchema,
  PaymentPayloadSchema,
  SignedPaymentSchema,
  X402Error,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  PaymentExpiredError,
  extractChainId,
  createCaipId,
  generateNonce,
  calculateDeadline,
} from '../src/types/index.js';

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
  it('should export correct X402_VERSION', () => {
    expect(X402_VERSION).toBe('2.0.0');
  });

  it('should export correct X402_DOMAIN_NAME', () => {
    expect(X402_DOMAIN_NAME).toBe('x402');
  });

  it('should export correct X402_HEADERS', () => {
    expect(X402_HEADERS).toEqual({
      PAYMENT_REQUIRED: 'x-payment-required',
      PAYMENT_SIGNATURE: 'x-payment-signature',
      PAYMENT_PAYLOAD: 'x-payment-payload',
    });
  });

  it('should export correct PAYMENT_TYPES for EIP-712', () => {
    expect(PAYMENT_TYPES.Payment).toHaveLength(8);
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'amount', type: 'uint256' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'token', type: 'address' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'chainId', type: 'uint256' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'payTo', type: 'address' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'payer', type: 'address' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'deadline', type: 'uint256' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'nonce', type: 'string' });
    expect(PAYMENT_TYPES.Payment).toContainEqual({ name: 'resource', type: 'string' });
  });
});

// ============================================================================
// PaymentRequirementSchema Tests
// ============================================================================

describe('PaymentRequirementSchema', () => {
  const validRequirement = {
    amount: '1000000000000000000',
    token: '0x55d398326f99059fF775485246999027B3197955',
    network_id: 'eip155:56',
    pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
  };

  it('should validate a minimal valid payment requirement', () => {
    const result = PaymentRequirementSchema.safeParse(validRequirement);
    expect(result.success).toBe(true);
  });

  it('should validate a complete payment requirement with all optional fields', () => {
    const complete = {
      ...validRequirement,
      description: 'Premium API access',
      resource: '/api/premium/data',
      expires_at: Math.floor(Date.now() / 1000) + 300,
      nonce: 'abc123',
      version: '2.0.0',
    };
    const result = PaymentRequirementSchema.safeParse(complete);
    expect(result.success).toBe(true);
  });

  it('should reject invalid amount (non-numeric string)', () => {
    const invalid = { ...validRequirement, amount: 'not-a-number' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('numeric');
    }
  });

  it('should reject invalid amount (negative number)', () => {
    const invalid = { ...validRequirement, amount: '-100' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid token address (too short)', () => {
    const invalid = { ...validRequirement, token: '0x123' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid token address (no 0x prefix)', () => {
    const invalid = { ...validRequirement, token: '55d398326f99059fF775485246999027B3197955' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid network_id (wrong format)', () => {
    const invalid = { ...validRequirement, network_id: 'eth:56' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid pay_to address', () => {
    const invalid = { ...validRequirement, pay_to: 'not-an-address' };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept valid addresses with both uppercase and lowercase hex', () => {
    const mixedCase = {
      ...validRequirement,
      token: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
      pay_to: '0xabcdef0123456789ABCDEF0123456789abcdef01',
    };
    const result = PaymentRequirementSchema.safeParse(mixedCase);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// PaymentPayloadSchema Tests
// ============================================================================

describe('PaymentPayloadSchema', () => {
  const validPayload = {
    amount: '1000000000000000000',
    token: '0x55d398326f99059fF775485246999027B3197955',
    chainId: 56,
    payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    payer: '0xABC123def456789012345678901234567890abcd',
    deadline: Math.floor(Date.now() / 1000) + 300,
    nonce: 'abc123def456',
  };

  it('should validate a valid payment payload', () => {
    const result = PaymentPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should validate payload with optional resource', () => {
    const withResource = { ...validPayload, resource: '/api/resource' };
    const result = PaymentPayloadSchema.safeParse(withResource);
    expect(result.success).toBe(true);
  });

  it('should reject invalid chainId (not positive)', () => {
    const invalid = { ...validPayload, chainId: 0 };
    const result = PaymentPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid chainId (negative)', () => {
    const invalid = { ...validPayload, chainId: -1 };
    const result = PaymentPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid chainId (float)', () => {
    const invalid = { ...validPayload, chainId: 56.5 };
    const result = PaymentPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const incomplete = { amount: '100', token: '0x123' };
    const result = PaymentPayloadSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('should reject invalid deadline (not positive)', () => {
    const invalid = { ...validPayload, deadline: 0 };
    const result = PaymentPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// SignedPaymentSchema Tests
// ============================================================================

describe('SignedPaymentSchema', () => {
  const validPayload = {
    amount: '1000000000000000000',
    token: '0x55d398326f99059fF775485246999027B3197955',
    chainId: 56,
    payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    payer: '0xABC123def456789012345678901234567890abcd',
    deadline: Math.floor(Date.now() / 1000) + 300,
    nonce: 'abc123def456',
  };

  const validSignedPayment = {
    payload: validPayload,
    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    signer: '0xABC123def456789012345678901234567890abcd',
  };

  it('should validate a valid signed payment', () => {
    const result = SignedPaymentSchema.safeParse(validSignedPayment);
    expect(result.success).toBe(true);
  });

  it('should reject invalid signature format (missing 0x)', () => {
    const invalid = { ...validSignedPayment, signature: '1234567890abcdef' };
    const result = SignedPaymentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid signer address', () => {
    const invalid = { ...validSignedPayment, signer: 'invalid-address' };
    const result = SignedPaymentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Error Classes Tests
// ============================================================================

describe('X402Error', () => {
  it('should create an error with message, code, and details', () => {
    const error = new X402Error('Test error', 'TEST_CODE', { key: 'value' });
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('X402Error');
  });

  it('should be an instance of Error', () => {
    const error = new X402Error('Test', 'CODE');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(X402Error);
  });
});

describe('PaymentRequiredError', () => {
  const requirement = {
    amount: '1000',
    token: '0x55d398326f99059fF775485246999027B3197955',
    network_id: 'eip155:56',
    pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
  };

  it('should create error with requirement', () => {
    const error = new PaymentRequiredError(requirement);
    expect(error.message).toBe('Payment required');
    expect(error.code).toBe('PAYMENT_REQUIRED');
    expect(error.requirement).toEqual(requirement);
    expect(error.name).toBe('PaymentRequiredError');
  });

  it('should accept custom message', () => {
    const error = new PaymentRequiredError(requirement, 'Custom message');
    expect(error.message).toBe('Custom message');
  });

  it('should be an instance of X402Error', () => {
    const error = new PaymentRequiredError(requirement);
    expect(error).toBeInstanceOf(X402Error);
    expect(error).toBeInstanceOf(PaymentRequiredError);
  });
});

describe('PaymentVerificationError', () => {
  it('should create error with message', () => {
    const error = new PaymentVerificationError('Signature invalid');
    expect(error.message).toBe('Signature invalid');
    expect(error.code).toBe('PAYMENT_VERIFICATION_FAILED');
    expect(error.name).toBe('PaymentVerificationError');
  });

  it('should accept details', () => {
    const error = new PaymentVerificationError('Invalid', { field: 'signature' });
    expect(error.details).toEqual({ field: 'signature' });
  });
});

describe('UnsupportedNetworkError', () => {
  it('should create error with network info', () => {
    const error = new UnsupportedNetworkError('eip155:1', ['eip155:56']);
    expect(error.message).toContain('eip155:1');
    expect(error.message).toContain('not supported');
    expect(error.message).toContain('eip155:56');
    expect(error.code).toBe('UNSUPPORTED_NETWORK');
    expect(error.name).toBe('UnsupportedNetworkError');
  });

  it('should list multiple supported networks', () => {
    const error = new UnsupportedNetworkError('eip155:1', ['eip155:56', 'eip155:137']);
    expect(error.message).toContain('eip155:56');
    expect(error.message).toContain('eip155:137');
  });
});

describe('PaymentExpiredError', () => {
  it('should create error with deadline', () => {
    const deadline = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    const error = new PaymentExpiredError(deadline);
    expect(error.message).toContain('expired');
    expect(error.code).toBe('PAYMENT_EXPIRED');
    expect(error.name).toBe('PaymentExpiredError');
    expect(error.details?.deadline).toBe(deadline);
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe('extractChainId', () => {
  it('should extract chain ID from valid CAIP-2 identifier', () => {
    expect(extractChainId('eip155:56')).toBe(56);
    expect(extractChainId('eip155:1')).toBe(1);
    expect(extractChainId('eip155:137')).toBe(137);
    expect(extractChainId('eip155:80001')).toBe(80001);
  });

  it('should throw X402Error for invalid CAIP-2 identifier', () => {
    expect(() => extractChainId('eth:56')).toThrow(X402Error);
    expect(() => extractChainId('eip155:')).toThrow(X402Error);
    expect(() => extractChainId('56')).toThrow(X402Error);
    expect(() => extractChainId('')).toThrow(X402Error);
    expect(() => extractChainId('eip155:abc')).toThrow(X402Error);
  });

  it('should include original identifier in error message', () => {
    try {
      extractChainId('invalid');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(X402Error);
      expect((error as X402Error).message).toContain('invalid');
      expect((error as X402Error).code).toBe('INVALID_CAIP_ID');
    }
  });
});

describe('createCaipId', () => {
  it('should create valid CAIP-2 identifier from chain ID', () => {
    expect(createCaipId(56)).toBe('eip155:56');
    expect(createCaipId(1)).toBe('eip155:1');
    expect(createCaipId(137)).toBe('eip155:137');
  });

  it('should handle edge cases', () => {
    expect(createCaipId(0)).toBe('eip155:0');
    expect(createCaipId(999999)).toBe('eip155:999999');
  });
});

describe('generateNonce', () => {
  it('should generate a 32 character hex string', () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(32);
    expect(/^[a-f0-9]{32}$/.test(nonce)).toBe(true);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    expect(nonces.size).toBe(100); // All should be unique
  });
});

describe('calculateDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate deadline with default duration (300 seconds)', () => {
    const now = 1700000000000; // Fixed timestamp
    vi.setSystemTime(now);
    
    const deadline = calculateDeadline();
    expect(deadline).toBe(Math.floor(now / 1000) + 300);
  });

  it('should calculate deadline with custom duration', () => {
    const now = 1700000000000;
    vi.setSystemTime(now);
    
    expect(calculateDeadline(60)).toBe(Math.floor(now / 1000) + 60);
    expect(calculateDeadline(600)).toBe(Math.floor(now / 1000) + 600);
    expect(calculateDeadline(3600)).toBe(Math.floor(now / 1000) + 3600);
  });

  it('should return Unix timestamp in seconds', () => {
    const deadline = calculateDeadline(0);
    // Should be roughly current time (not milliseconds)
    expect(deadline).toBeLessThan(Date.now());
  });
});
