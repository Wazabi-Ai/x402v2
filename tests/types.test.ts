import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  X402_VERSION,
  PERMIT2_ADDRESS,
  DEFAULT_FEE_BPS,
  X402_HEADERS,
  PERMIT2_BATCH_WITNESS_TYPES,
  ERC3009_TYPES,
  PaymentRequirementSchema,
  Permit2PayloadSchema,
  ERC3009PayloadSchema,
  PaymentPayloadSchema,
  X402Error,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  PaymentExpiredError,
  extractChainId,
  createCaipId,
  generateNonce,
  generatePermit2Nonce,
  generateBytes32Nonce,
  calculateDeadline,
  calculateFeeSplit,
  getPermit2Domain,
  getERC3009Domain,
} from '../src/types/index.js';

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
  it('should export correct X402_VERSION', () => {
    expect(X402_VERSION).toBe('2.0.0');
  });

  it('should export canonical Permit2 address', () => {
    expect(PERMIT2_ADDRESS).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3');
  });

  it('should export correct DEFAULT_FEE_BPS', () => {
    expect(DEFAULT_FEE_BPS).toBe(50);
  });

  it('should export correct X402_HEADERS', () => {
    expect(X402_HEADERS).toEqual({
      PAYMENT_REQUIRED: 'x-payment-required',
      PAYMENT: 'x-payment',
      PAYMENT_RESPONSE: 'x-payment-response',
    });
  });

  it('should export PERMIT2_BATCH_WITNESS_TYPES with correct structure', () => {
    expect(PERMIT2_BATCH_WITNESS_TYPES.PermitBatchWitnessTransferFrom).toHaveLength(5);
    expect(PERMIT2_BATCH_WITNESS_TYPES.TokenPermissions).toHaveLength(2);
    expect(PERMIT2_BATCH_WITNESS_TYPES.SettlementWitness).toHaveLength(2);
    // Verify specific fields
    const fields = PERMIT2_BATCH_WITNESS_TYPES.PermitBatchWitnessTransferFrom;
    expect(fields).toContainEqual({ name: 'permitted', type: 'TokenPermissions[]' });
    expect(fields).toContainEqual({ name: 'spender', type: 'address' });
    expect(fields).toContainEqual({ name: 'witness', type: 'SettlementWitness' });
  });

  it('should export ERC3009_TYPES with correct structure', () => {
    expect(ERC3009_TYPES.TransferWithAuthorization).toHaveLength(6);
    const fields = ERC3009_TYPES.TransferWithAuthorization;
    expect(fields).toContainEqual({ name: 'from', type: 'address' });
    expect(fields).toContainEqual({ name: 'to', type: 'address' });
    expect(fields).toContainEqual({ name: 'value', type: 'uint256' });
    expect(fields).toContainEqual({ name: 'nonce', type: 'bytes32' });
  });
});

// ============================================================================
// EIP-712 Domain Tests
// ============================================================================

describe('getPermit2Domain', () => {
  it('should return correct domain for given chainId', () => {
    const domain = getPermit2Domain(8453);
    expect(domain.name).toBe('Permit2');
    expect(domain.chainId).toBe(8453);
    expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
  });

  it('should return different domains for different chains', () => {
    const base = getPermit2Domain(8453);
    const eth = getPermit2Domain(1);
    expect(base.chainId).toBe(8453);
    expect(eth.chainId).toBe(1);
    expect(base.verifyingContract).toBe(eth.verifyingContract);
  });
});

describe('getERC3009Domain', () => {
  it('should return correct domain for USDC', () => {
    const domain = getERC3009Domain(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'USD Coin',
      8453
    );
    expect(domain.name).toBe('USD Coin');
    expect(domain.version).toBe('2');
    expect(domain.chainId).toBe(8453);
    expect(domain.verifyingContract).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });
});

// ============================================================================
// PaymentRequirementSchema Tests
// ============================================================================

describe('PaymentRequirementSchema', () => {
  const validAccept = {
    scheme: 'permit2' as const,
    network: 'eip155:8453',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount: '1000000',
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    settlement: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    treasury: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
    feeBps: 50,
    maxDeadline: Math.floor(Date.now() / 1000) + 300,
  };

  const validRequirement = {
    x402Version: '2.0.0',
    accepts: [validAccept],
  };

  it('should validate a minimal valid payment requirement', () => {
    const result = PaymentRequirementSchema.safeParse(validRequirement);
    expect(result.success).toBe(true);
  });

  it('should validate requirement with description and resource', () => {
    const complete = {
      ...validRequirement,
      description: 'Premium API access',
      resource: '/api/premium/data',
    };
    const result = PaymentRequirementSchema.safeParse(complete);
    expect(result.success).toBe(true);
  });

  it('should validate requirement with multiple accept entries', () => {
    const multi = {
      ...validRequirement,
      accepts: [
        validAccept,
        {
          ...validAccept,
          scheme: 'erc3009' as const,
        },
      ],
    };
    const result = PaymentRequirementSchema.safeParse(multi);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accepts).toHaveLength(2);
    }
  });

  it('should reject invalid network format in accepts', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, network: 'eth:8453' }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid token address (too short)', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, token: '0x123' }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid token address (no 0x prefix)', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, token: '833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric amount', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, amount: 'not-a-number' }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject negative amount', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, amount: '-100' }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject feeBps over 1000', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, feeBps: 1001 }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject negative feeBps', () => {
    const invalid = {
      ...validRequirement,
      accepts: [{ ...validAccept, feeBps: -1 }],
    };
    const result = PaymentRequirementSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept valid addresses with both uppercase and lowercase hex', () => {
    const mixedCase = {
      ...validRequirement,
      accepts: [{
        ...validAccept,
        token: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
        recipient: '0xabcdef0123456789ABCDEF0123456789abcdef01',
      }],
    };
    const result = PaymentRequirementSchema.safeParse(mixedCase);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Permit2PayloadSchema Tests
// ============================================================================

describe('Permit2PayloadSchema', () => {
  const validPayload = {
    scheme: 'permit2' as const,
    network: 'eip155:8453',
    permit: {
      permitted: [
        { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '995000' },
        { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '5000' },
      ],
      nonce: '123456789',
      deadline: Math.floor(Date.now() / 1000) + 300,
    },
    witness: {
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      feeBps: 50,
    },
    spender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    payer: '0xABC123def456789012345678901234567890abcd',
    signature: '0x' + 'ab'.repeat(65),
  };

  it('should validate a valid Permit2 payload', () => {
    const result = Permit2PayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should require exactly 2 permitted entries', () => {
    const invalid = {
      ...validPayload,
      permit: {
        ...validPayload.permit,
        permitted: [validPayload.permit.permitted[0]],
      },
    };
    const result = Permit2PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid network format', () => {
    const invalid = { ...validPayload, network: 'eth:8453' };
    const result = Permit2PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid signature format (missing 0x)', () => {
    const invalid = { ...validPayload, signature: 'abcdef1234' };
    const result = Permit2PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid payer address', () => {
    const invalid = { ...validPayload, payer: 'not-an-address' };
    const result = Permit2PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const incomplete = { scheme: 'permit2', network: 'eip155:8453' };
    const result = Permit2PayloadSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('should reject invalid deadline (not positive)', () => {
    const invalid = {
      ...validPayload,
      permit: { ...validPayload.permit, deadline: 0 },
    };
    const result = Permit2PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ERC3009PayloadSchema Tests
// ============================================================================

describe('ERC3009PayloadSchema', () => {
  const validPayload = {
    scheme: 'erc3009' as const,
    network: 'eip155:8453',
    authorization: {
      from: '0xABC123def456789012345678901234567890abcd',
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      value: '1000000',
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: '0x' + 'ab'.repeat(32),
    },
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    payer: '0xABC123def456789012345678901234567890abcd',
    signature: '0x' + 'ab'.repeat(65),
  };

  it('should validate a valid ERC-3009 payload', () => {
    const result = ERC3009PayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should reject invalid nonce (not bytes32)', () => {
    const invalid = {
      ...validPayload,
      authorization: {
        ...validPayload.authorization,
        nonce: '0x123',
      },
    };
    const result = ERC3009PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid signature format', () => {
    const invalid = { ...validPayload, signature: 'not-hex' };
    const result = ERC3009PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing recipient', () => {
    const { recipient, ...noRecipient } = validPayload;
    const result = ERC3009PayloadSchema.safeParse(noRecipient);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric value', () => {
    const invalid = {
      ...validPayload,
      authorization: {
        ...validPayload.authorization,
        value: 'not-a-number',
      },
    };
    const result = ERC3009PayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PaymentPayloadSchema (discriminated union) Tests
// ============================================================================

describe('PaymentPayloadSchema', () => {
  it('should discriminate on scheme: permit2', () => {
    const payload = {
      scheme: 'permit2',
      network: 'eip155:8453',
      permit: {
        permitted: [
          { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '995000' },
          { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '5000' },
        ],
        nonce: '123456789',
        deadline: Math.floor(Date.now() / 1000) + 300,
      },
      witness: {
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        feeBps: 50,
      },
      spender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payer: '0xABC123def456789012345678901234567890abcd',
      signature: '0x' + 'ab'.repeat(65),
    };
    const result = PaymentPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheme).toBe('permit2');
    }
  });

  it('should discriminate on scheme: erc3009', () => {
    const payload = {
      scheme: 'erc3009',
      network: 'eip155:8453',
      authorization: {
        from: '0xABC123def456789012345678901234567890abcd',
        to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        value: '1000000',
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: '0x' + 'ab'.repeat(32),
      },
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      payer: '0xABC123def456789012345678901234567890abcd',
      signature: '0x' + 'ab'.repeat(65),
    };
    const result = PaymentPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheme).toBe('erc3009');
    }
  });

  it('should reject unknown scheme', () => {
    const payload = {
      scheme: 'unknown',
      network: 'eip155:8453',
    };
    const result = PaymentPayloadSchema.safeParse(payload);
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
    x402Version: '2.0.0',
    accepts: [{
      scheme: 'permit2' as const,
      network: 'eip155:8453',
      token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '1000000',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      settlement: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      treasury: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
      feeBps: 50,
      maxDeadline: Math.floor(Date.now() / 1000) + 300,
    }],
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
    const deadline = Math.floor(Date.now() / 1000) - 60;
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
    expect(extractChainId('eip155:8453')).toBe(8453);
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
    expect(createCaipId(8453)).toBe('eip155:8453');
  });

  it('should handle edge cases', () => {
    expect(createCaipId(0)).toBe('eip155:0');
    expect(createCaipId(999999)).toBe('eip155:999999');
  });
});

describe('generateNonce', () => {
  it('should generate a 64 character hex string (32 bytes)', () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(nonce)).toBe(true);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    expect(nonces.size).toBe(100);
  });
});

describe('generatePermit2Nonce', () => {
  it('should generate a decimal string', () => {
    const nonce = generatePermit2Nonce();
    expect(/^\d+$/.test(nonce)).toBe(true);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set();
    for (let i = 0; i < 50; i++) {
      nonces.add(generatePermit2Nonce());
    }
    expect(nonces.size).toBe(50);
  });
});

describe('generateBytes32Nonce', () => {
  it('should generate a 0x-prefixed 64 character hex string', () => {
    const nonce = generateBytes32Nonce();
    expect(nonce).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set();
    for (let i = 0; i < 50; i++) {
      nonces.add(generateBytes32Nonce());
    }
    expect(nonces.size).toBe(50);
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
    const now = 1700000000000;
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
    expect(deadline).toBeLessThan(Date.now());
  });
});

describe('calculateFeeSplit', () => {
  it('should split gross amount into fee and net', () => {
    const result = calculateFeeSplit(BigInt(1000000), 50);
    expect(result.gross).toBe(BigInt(1000000));
    expect(result.fee).toBe(BigInt(5000));
    expect(result.net).toBe(BigInt(995000));
  });

  it('should handle zero fee', () => {
    const result = calculateFeeSplit(BigInt(1000000), 0);
    expect(result.fee).toBe(BigInt(0));
    expect(result.net).toBe(BigInt(1000000));
  });

  it('should handle 10% fee (1000 bps)', () => {
    const result = calculateFeeSplit(BigInt(1000000), 1000);
    expect(result.fee).toBe(BigInt(100000));
    expect(result.net).toBe(BigInt(900000));
  });

  it('should maintain invariant: gross = net + fee', () => {
    const gross = BigInt('999999999999');
    const result = calculateFeeSplit(gross, 50);
    expect(result.net + result.fee).toBe(gross);
  });
});
