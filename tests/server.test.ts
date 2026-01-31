import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock axios for facilitator calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock viem for signature verification
vi.mock('viem', () => ({
  verifyTypedData: vi.fn(),
}));

import axios from 'axios';
import { verifyTypedData } from 'viem';
import {
  x402Middleware,
  createPaymentRequirement,
  verifyPayment,
  parsePaymentFromRequest,
  type X402Request,
} from '../src/server/index.js';
import { X402_HEADERS, X402_VERSION, generateNonce } from '../src/types/index.js';
import { BSC_USDT, BSC_CAIP_ID, BSC_CHAIN_ID } from '../src/chains/bnb.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createMockRequest(overrides: Partial<Request> = {}): X402Request {
  return {
    path: '/api/resource',
    originalUrl: '/api/resource',
    headers: {},
    ...overrides,
  } as X402Request;
}

function createMockResponse(): Response & { jsonData?: unknown; statusCode?: number; headersSent: Record<string, string> } {
  const res = {
    statusCode: undefined,
    jsonData: undefined,
    headersSent: {} as Record<string, string>,
    status: vi.fn(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: typeof res, data: unknown) {
      this.jsonData = data;
      return this;
    }),
    setHeader: vi.fn(function (this: typeof res, key: string, value: string) {
      this.headersSent[key] = value;
      return this;
    }),
  };
  return res as unknown as Response & { jsonData?: unknown; statusCode?: number; headersSent: Record<string, string> };
}

// ============================================================================
// createPaymentRequirement Tests
// ============================================================================

describe('createPaymentRequirement', () => {
  it('should create a valid payment requirement with minimal config', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
    });

    expect(requirement).toMatchObject({
      amount: '1000000000000000000',
      token: BSC_USDT.address,
      network_id: BSC_CAIP_ID,
      pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      version: X402_VERSION,
    });
    expect(requirement.nonce).toBeDefined();
    expect(requirement.expires_at).toBeDefined();
    expect(requirement.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should use custom token address', () => {
    const customToken = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as `0x${string}`;
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
      tokenAddress: customToken,
    });

    expect(requirement.token).toBe(customToken);
  });

  it('should include description when provided', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
      description: 'Premium API access',
    });

    expect(requirement.description).toBe('Premium API access');
  });

  it('should use custom network ID', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
      networkId: 'eip155:137',
    });

    expect(requirement.network_id).toBe('eip155:137');
  });

  it('should use custom deadline and nonce', () => {
    const customDeadline = Math.floor(Date.now() / 1000) + 600;
    const customNonce = 'custom-nonce-123';
    
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
      deadline: customDeadline,
      nonce: customNonce,
    });

    expect(requirement.expires_at).toBe(customDeadline);
    expect(requirement.nonce).toBe(customNonce);
  });

  it('should include resource when provided', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
      amount: '1000000000000000000',
      resource: '/api/premium/data',
    });

    expect(requirement.resource).toBe('/api/premium/data');
  });
});

// ============================================================================
// verifyPayment Tests
// ============================================================================

describe('verifyPayment', () => {
  const validSignedPayment = {
    payload: {
      amount: '1000000000000000000',
      token: BSC_USDT.address,
      chainId: BSC_CHAIN_ID,
      payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      payer: '0xABC123def456789012345678901234567890abcd',
      deadline: Math.floor(Date.now() / 1000) + 300,
      nonce: generateNonce(),
      resource: '/api/resource',
    },
    signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab' as `0x${string}`,
    signer: '0xABC123def456789012345678901234567890abcd' as `0x${string}`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('local verification', () => {
    it('should return valid for correct signature', async () => {
      (verifyTypedData as Mock).mockResolvedValue(true);

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(true);
      expect(result.signer).toBe(validSignedPayment.signer);
    });

    it('should return invalid for expired payment', async () => {
      const expiredPayment = {
        ...validSignedPayment,
        payload: {
          ...validSignedPayment.payload,
          deadline: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
        },
      };

      const result = await verifyPayment(
        expiredPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should return invalid for chain ID mismatch', async () => {
      const wrongChainPayment = {
        ...validSignedPayment,
        payload: {
          ...validSignedPayment.payload,
          chainId: 1, // Ethereum mainnet instead of BSC
        },
      };

      const result = await verifyPayment(
        wrongChainPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Chain ID mismatch');
    });

    it('should return invalid for recipient mismatch', async () => {
      const result = await verifyPayment(
        validSignedPayment,
        '0x0000000000000000000000000000000000000000' as `0x${string}`, // Different recipient
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Recipient mismatch');
    });

    it('should return invalid for failed signature verification', async () => {
      (verifyTypedData as Mock).mockResolvedValue(false);

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Signature verification failed');
    });

    it('should handle verification errors gracefully', async () => {
      (verifyTypedData as Mock).mockRejectedValue(new Error('Crypto error'));

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Crypto error');
    });

    it('should be case-insensitive for recipient comparison', async () => {
      (verifyTypedData as Mock).mockResolvedValue(true);
      
      const result = await verifyPayment(
        validSignedPayment,
        '0x742D35CC6634C0532925A3B844BC9E7595F4B123' as `0x${string}`, // uppercase
        BSC_CAIP_ID
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('facilitator verification', () => {
    const facilitatorUrl = 'https://facilitator.example.com';

    it('should call facilitator service', async () => {
      (axios.post as Mock).mockResolvedValue({
        data: {
          valid: true,
          signer: validSignedPayment.signer,
        },
      });

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID,
        facilitatorUrl
      );

      expect(axios.post).toHaveBeenCalledWith(
        `${facilitatorUrl}/verify`,
        expect.objectContaining({
          signature: validSignedPayment.signature,
          payload: validSignedPayment.payload,
          networkId: BSC_CAIP_ID,
        }),
        expect.any(Object)
      );
      expect(result.valid).toBe(true);
    });

    it('should return invalid when facilitator rejects', async () => {
      (axios.post as Mock).mockResolvedValue({
        data: {
          valid: false,
          error: 'Insufficient balance',
        },
      });

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID,
        facilitatorUrl
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Insufficient balance');
    });

    it('should handle facilitator network errors', async () => {
      (axios.post as Mock).mockRejectedValue(new Error('Network timeout'));

      const result = await verifyPayment(
        validSignedPayment,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
        BSC_CAIP_ID,
        facilitatorUrl
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Facilitator error');
    });
  });
});

// ============================================================================
// parsePaymentFromRequest Tests
// ============================================================================

describe('parsePaymentFromRequest', () => {
  const validPayload = {
    amount: '1000000000000000000',
    token: BSC_USDT.address,
    chainId: BSC_CHAIN_ID,
    payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    payer: '0xABC123def456789012345678901234567890abcd',
    deadline: Math.floor(Date.now() / 1000) + 300,
    nonce: generateNonce(),
  };

  const validSignature = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

  it('should parse valid payment from headers', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
        [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
      },
    });

    const payment = parsePaymentFromRequest(req);

    expect(payment).not.toBeNull();
    expect(payment?.signature).toBe(validSignature);
    expect(payment?.payload).toMatchObject(validPayload);
  });

  it('should handle lowercase header names', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE.toLowerCase()]: validSignature,
        [X402_HEADERS.PAYMENT_PAYLOAD.toLowerCase()]: JSON.stringify(validPayload),
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).not.toBeNull();
  });

  it('should return null when signature header is missing', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });

  it('should return null when payload header is missing', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });

  it('should return null for invalid JSON payload', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
        [X402_HEADERS.PAYMENT_PAYLOAD]: 'not-valid-json',
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });

  it('should return null for invalid payload schema', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
        [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify({ invalid: 'payload' }),
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });
});

// ============================================================================
// x402Middleware Tests
// ============================================================================

describe('x402Middleware', () => {
  const recipientAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`;
  const amount = '1000000000000000000';

  let middleware: ReturnType<typeof x402Middleware>;
  let req: X402Request;
  let res: ReturnType<typeof createMockResponse>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = x402Middleware({
      recipientAddress,
      amount,
    });
    req = createMockRequest();
    res = createMockResponse();
    next = vi.fn();
  });

  describe('without payment', () => {
    it('should return 402 with payment requirement when no signature provided', async () => {
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Required',
          requirement: expect.objectContaining({
            amount,
            pay_to: recipientAddress,
            network_id: BSC_CAIP_ID,
          }),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should set payment requirement in header', async () => {
      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        X402_HEADERS.PAYMENT_REQUIRED,
        expect.any(String)
      );
      
      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.amount).toBe(amount);
    });

    it('should include resource URL in requirement', async () => {
      req.originalUrl = '/api/premium/endpoint';
      await middleware(req, res, next);

      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.resource).toBe('/api/premium/endpoint');
    });

    it('should use custom description', async () => {
      middleware = x402Middleware({
        recipientAddress,
        amount,
        description: 'Premium API access required',
      });

      await middleware(req, res, next);

      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.description).toBe('Premium API access required');
    });

    it('should use custom nonce generator', async () => {
      const customNonce = 'custom-nonce-value';
      middleware = x402Middleware({
        recipientAddress,
        amount,
        nonceGenerator: () => customNonce,
      });

      await middleware(req, res, next);

      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.nonce).toBe(customNonce);
    });
  });

  describe('with valid payment', () => {
    const validSignature = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    let validPayload: Record<string, unknown>;

    beforeEach(() => {
      validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
        resource: '/api/resource',
      };
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });
      (verifyTypedData as Mock).mockResolvedValue(true);
    });

    it('should call next() for valid payment', async () => {
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach payment info to request', async () => {
      await middleware(req, res, next);

      expect(req.x402).toBeDefined();
      expect(req.x402?.verified).toBe(true);
      expect(req.x402?.signer).toBe(validPayload.payer);
      expect(req.x402?.payment).toBeDefined();
    });

    it('should reject payment with insufficient amount', async () => {
      const insufficientPayload = {
        ...validPayload,
        amount: '100', // Much less than required
      };
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(insufficientPayload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient Payment',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept payment with exact amount', async () => {
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should accept payment with more than required amount', async () => {
      const generousPayload = {
        ...validPayload,
        amount: '2000000000000000000', // 2x the required amount
      };
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: validSignature,
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(generousPayload),
        },
      });

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('with invalid payment', () => {
    it('should return 400 for missing payload header', async () => {
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xsignature',
          // Missing payload
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid Payment',
        })
      );
    });

    it('should return 400 for invalid JSON payload', async () => {
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xsignature',
          [X402_HEADERS.PAYMENT_PAYLOAD]: 'not-json',
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for valid JSON but invalid payload schema', async () => {
      // Valid JSON but doesn't match PaymentPayloadSchema
      const invalidPayload = {
        amount: 'not-a-number', // Invalid: should be numeric string
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };
      
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xsignature',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(invalidPayload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid Payment',
        })
      );
    });

    it('should return 402 when signature verification fails', async () => {
      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };
      
      (verifyTypedData as Mock).mockResolvedValue(false);
      
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xinvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Verification Failed',
        })
      );
    });
  });

  describe('excluded routes', () => {
    it('should skip payment check for excluded routes', async () => {
      middleware = x402Middleware({
        recipientAddress,
        amount,
        excludeRoutes: ['/health', '/public'],
      });

      req = createMockRequest({ path: '/health' });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip payment check for routes starting with excluded prefix', async () => {
      middleware = x402Middleware({
        recipientAddress,
        amount,
        excludeRoutes: ['/public'],
      });

      req = createMockRequest({ path: '/public/assets/image.png' });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should require payment for non-excluded routes', async () => {
      middleware = x402Middleware({
        recipientAddress,
        amount,
        excludeRoutes: ['/health'],
      });

      req = createMockRequest({ path: '/api/paid' });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
    });
  });

  describe('custom verification', () => {
    it('should call custom verification function', async () => {
      const customVerify = vi.fn().mockResolvedValue(true);
      middleware = x402Middleware({
        recipientAddress,
        amount,
        verifyPayment: customVerify,
      });

      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };
      
      (verifyTypedData as Mock).mockResolvedValue(true);
      
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      expect(customVerify).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should reject payment when custom verification fails', async () => {
      const customVerify = vi.fn().mockResolvedValue(false);
      middleware = x402Middleware({
        recipientAddress,
        amount,
        verifyPayment: customVerify,
      });

      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };
      
      (verifyTypedData as Mock).mockResolvedValue(true);
      
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Rejected',
          message: 'Custom verification failed',
        })
      );
    });
  });

  describe('facilitator integration', () => {
    it('should use facilitator for verification when URL provided', async () => {
      const facilitatorUrl = 'https://facilitator.example.com';
      middleware = x402Middleware({
        recipientAddress,
        amount,
        facilitatorUrl,
      });

      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };

      (axios.post as Mock).mockResolvedValue({
        data: {
          valid: true,
          signer: validPayload.payer,
        },
      });

      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      expect(axios.post).toHaveBeenCalledWith(
        `${facilitatorUrl}/verify`,
        expect.any(Object),
        expect.any(Object)
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should gracefully handle verifyTypedData errors as verification failures', async () => {
      // Note: The verification functions catch errors internally and return them
      // as verification failures (402), not as unexpected errors (500)
      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };

      (verifyTypedData as Mock).mockImplementation(() => {
        throw new Error('Unexpected crypto error');
      });

      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      // Errors from verifyTypedData are caught and returned as verification failures
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Verification Failed',
          message: expect.stringContaining('Unexpected crypto error'),
        })
      );
    });

    it('should call custom error handler when custom verify throws', async () => {
      const onError = vi.fn();
      const customVerify = vi.fn().mockImplementation(() => {
        throw new Error('Custom verification exploded');
      });
      
      middleware = x402Middleware({
        recipientAddress,
        amount,
        verifyPayment: customVerify,
        onError,
      });

      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };

      (verifyTypedData as Mock).mockResolvedValue(true);

      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      await middleware(req, res, next);

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        req,
        res
      );
    });

    it('should return 500 when custom verify throws without custom handler', async () => {
      const customVerify = vi.fn().mockImplementation(() => {
        throw new Error('Custom verification exploded');
      });
      
      middleware = x402Middleware({
        recipientAddress,
        amount,
        verifyPayment: customVerify,
      });

      const validPayload = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        chainId: BSC_CHAIN_ID,
        payTo: recipientAddress,
        payer: '0xABC123def456789012345678901234567890abcd',
        deadline: Math.floor(Date.now() / 1000) + 300,
        nonce: generateNonce(),
      };

      (verifyTypedData as Mock).mockResolvedValue(true);

      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT_SIGNATURE]: '0xvalidsig',
          [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(validPayload),
        },
      });

      // Spy on console.error to suppress output during test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
        })
      );

      consoleSpy.mockRestore();
    });
  });
});
