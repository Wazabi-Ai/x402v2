import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock axios for facilitator calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';
import {
  x402Middleware,
  createPaymentRequirement,
  parsePaymentFromRequest,
  type X402Request,
} from '../src/server/index.js';
import { X402_HEADERS, X402_VERSION } from '../src/types/index.js';
import { BASE_USDC, BASE_CAIP_ID } from '../src/chains/base.js';

// ============================================================================
// Test Utilities
// ============================================================================

const TEST_RECIPIENT = '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`;
const TEST_TOKEN = BASE_USDC.address as `0x${string}`;
const TEST_SETTLEMENT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const TEST_TREASURY = '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB' as `0x${string}`;

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

/** Counter to ensure unique nonces across tests (NonceRegistry is a module singleton) */
let nonceCounter = 0;

/** Build a valid Permit2 payment payload for tests */
function buildPermit2Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nonceCounter++;
  return {
    scheme: 'permit2',
    network: BASE_CAIP_ID,
    permit: {
      permitted: [
        { token: TEST_TOKEN, amount: '995000' },
        { token: TEST_TOKEN, amount: '5000' },
      ],
      nonce: String(Date.now() * 1000 + nonceCounter),
      deadline: Math.floor(Date.now() / 1000) + 300,
    },
    witness: {
      recipient: TEST_RECIPIENT,
      feeBps: 50,
    },
    spender: TEST_SETTLEMENT,
    payer: '0xABC123def456789012345678901234567890abcd',
    signature: '0x' + 'ab'.repeat(65),
    ...overrides,
  };
}

// ============================================================================
// createPaymentRequirement Tests
// ============================================================================

describe('createPaymentRequirement', () => {
  it('should create a valid payment requirement with accepts array', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
    });

    expect(requirement.x402Version).toBe(X402_VERSION);
    expect(requirement.accepts).toBeInstanceOf(Array);
    expect(requirement.accepts.length).toBeGreaterThan(0);

    const accept = requirement.accepts[0]!;
    expect(accept.amount).toBe('1000000');
    expect(accept.recipient).toBe(TEST_RECIPIENT);
    expect(accept.settlement).toBe(TEST_SETTLEMENT);
    expect(accept.treasury).toBe(TEST_TREASURY);
    expect(accept.token).toBe(TEST_TOKEN);
    expect(accept.network).toBe(BASE_CAIP_ID);
    expect(accept.feeBps).toBe(50);
    expect(accept.maxDeadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should use custom network ID', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
      networkId: 'eip155:1',
    });

    expect(requirement.accepts[0]!.network).toBe('eip155:1');
  });

  it('should include description when provided', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
      description: 'Premium API access',
    });

    expect(requirement.description).toBe('Premium API access');
  });

  it('should include resource when provided', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
      resource: '/api/premium/data',
    });

    expect(requirement.resource).toBe('/api/premium/data');
  });

  it('should use custom fee rate', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
      feeBps: 100,
    });

    expect(requirement.accepts[0]!.feeBps).toBe(100);
  });

  it('should support multiple accepted schemes', () => {
    const requirement = createPaymentRequirement({
      recipientAddress: TEST_RECIPIENT,
      amount: '1000000',
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
      acceptedSchemes: ['permit2', 'erc3009'],
    });

    expect(requirement.accepts).toHaveLength(2);
    expect(requirement.accepts[0]!.scheme).toBe('permit2');
    expect(requirement.accepts[1]!.scheme).toBe('erc3009');
  });
});

// ============================================================================
// parsePaymentFromRequest Tests
// ============================================================================

describe('parsePaymentFromRequest', () => {
  it('should parse valid payment from x-payment header', () => {
    const payload = buildPermit2Payload();
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
      },
    });

    const payment = parsePaymentFromRequest(req);

    expect(payment).not.toBeNull();
    expect(payment?.scheme).toBe('permit2');
    expect(payment?.network).toBe(BASE_CAIP_ID);
  });

  it('should return null when x-payment header is missing', () => {
    const req = createMockRequest({ headers: {} });
    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });

  it('should return null for invalid JSON in header', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT]: 'not-valid-json',
      },
    });

    const payment = parsePaymentFromRequest(req);
    expect(payment).toBeNull();
  });

  it('should return null for invalid payload schema', () => {
    const req = createMockRequest({
      headers: {
        [X402_HEADERS.PAYMENT]: JSON.stringify({ scheme: 'unknown', network: 'invalid' }),
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
  const amount = '1000000';

  let middleware: ReturnType<typeof x402Middleware>;
  let req: X402Request;
  let res: ReturnType<typeof createMockResponse>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = x402Middleware({
      recipientAddress: TEST_RECIPIENT,
      amount,
      tokenAddress: TEST_TOKEN,
      settlementAddress: TEST_SETTLEMENT,
      treasuryAddress: TEST_TREASURY,
    });
    req = createMockRequest();
    res = createMockResponse();
    next = vi.fn();
  });

  describe('without payment', () => {
    it('should return 402 with payment requirement when no x-payment header', async () => {
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Required',
          requirement: expect.objectContaining({
            x402Version: X402_VERSION,
            accepts: expect.arrayContaining([
              expect.objectContaining({
                amount,
                recipient: TEST_RECIPIENT,
                network: BASE_CAIP_ID,
              }),
            ]),
          }),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should set payment requirement in x-payment-required header', async () => {
      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        X402_HEADERS.PAYMENT_REQUIRED,
        expect.any(String)
      );

      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.accepts[0].amount).toBe(amount);
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
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        description: 'Premium API access required',
      });

      await middleware(req, res, next);

      const headerValue = res.headersSent[X402_HEADERS.PAYMENT_REQUIRED];
      const parsed = JSON.parse(headerValue);
      expect(parsed.description).toBe('Premium API access required');
    });
  });

  describe('with valid payment', () => {
    it('should call next() for valid Permit2 payment', async () => {
      const payload = buildPermit2Payload();
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach payment info to request', async () => {
      const payload = buildPermit2Payload();
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(req.x402).toBeDefined();
      expect(req.x402?.verified).toBe(true);
      expect(req.x402?.signer).toBe(payload.payer);
      expect(req.x402?.payment).toBeDefined();
    });

    it('should forward to facilitator and set response header when URL provided', async () => {
      const facilitatorUrl = 'https://facilitator.example.com';
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        facilitatorUrl,
      });

      (axios.post as Mock).mockResolvedValue({
        data: {
          success: true,
          txHash: '0x' + 'ab'.repeat(32),
          network: BASE_CAIP_ID,
        },
      });

      const payload = buildPermit2Payload();
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(axios.post).toHaveBeenCalledWith(
        `${facilitatorUrl}/x402/settle`,
        expect.objectContaining({ scheme: 'permit2' }),
        expect.any(Object)
      );
      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        X402_HEADERS.PAYMENT_RESPONSE,
        expect.any(String)
      );
    });

    it('should return 402 when facilitator settlement fails', async () => {
      const facilitatorUrl = 'https://facilitator.example.com';
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        facilitatorUrl,
      });

      (axios.post as Mock).mockResolvedValue({
        data: { success: false, network: BASE_CAIP_ID },
      });

      const payload = buildPermit2Payload();
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Settlement Failed' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('with invalid payment', () => {
    it('should return 400 for invalid JSON in x-payment header', async () => {
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: 'not-json',
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid Payment' })
      );
    });

    it('should return 400 for invalid payload schema', async () => {
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify({ scheme: 'unknown' }),
        },
      });

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for network mismatch', async () => {
      const payload = buildPermit2Payload({ network: 'eip155:1' });
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Network Mismatch' })
      );
    });

    it('should return 400 for expired payment', async () => {
      const payload = buildPermit2Payload({
        permit: {
          permitted: [
            { token: TEST_TOKEN, amount: '995000' },
            { token: TEST_TOKEN, amount: '5000' },
          ],
          nonce: String(Date.now()),
          deadline: Math.floor(Date.now() / 1000) - 60,
        },
      });
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Payment Expired' })
      );
    });

    it('should return 402 for insufficient payment amount', async () => {
      const payload = buildPermit2Payload({
        permit: {
          permitted: [
            { token: TEST_TOKEN, amount: '50' },
            { token: TEST_TOKEN, amount: '5' },
          ],
          nonce: String(Date.now()),
          deadline: Math.floor(Date.now() / 1000) + 300,
        },
      });
      req = createMockRequest({
        headers: {
          [X402_HEADERS.PAYMENT]: JSON.stringify(payload),
        },
      });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Insufficient Payment' })
      );
    });

    it('should return 402 for replayed nonce', async () => {
      const nonce = String(Date.now());
      const payload = buildPermit2Payload({
        permit: {
          permitted: [
            { token: TEST_TOKEN, amount: '995000' },
            { token: TEST_TOKEN, amount: '5000' },
          ],
          nonce,
          deadline: Math.floor(Date.now() / 1000) + 300,
        },
      });

      // First request succeeds
      req = createMockRequest({
        headers: { [X402_HEADERS.PAYMENT]: JSON.stringify(payload) },
      });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();

      // Second request with same nonce fails
      const res2 = createMockResponse();
      const next2 = vi.fn();
      req = createMockRequest({
        headers: { [X402_HEADERS.PAYMENT]: JSON.stringify(payload) },
      });
      await middleware(req, res2, next2);

      expect(res2.status).toHaveBeenCalledWith(402);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Replay Detected' })
      );
    });
  });

  describe('excluded routes', () => {
    it('should skip payment check for excluded routes', async () => {
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        excludeRoutes: ['/health', '/public'],
      });

      req = createMockRequest({ path: '/health' });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip payment check for routes starting with excluded prefix', async () => {
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        excludeRoutes: ['/public'],
      });

      req = createMockRequest({ path: '/public/assets/image.png' });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should require payment for non-excluded routes', async () => {
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        excludeRoutes: ['/health'],
      });

      req = createMockRequest({ path: '/api/paid' });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
    });
  });

  describe('error handling', () => {
    it('should return 500 on unexpected errors', async () => {
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
      });

      const badReq = {
        path: '/api/resource',
        originalUrl: '/api/resource',
        get headers() {
          throw new Error('Unexpected error');
        },
      } as unknown as X402Request;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await middleware(badReq, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
        })
      );

      consoleSpy.mockRestore();
    });

    it('should call custom error handler when provided', async () => {
      const onError = vi.fn();
      middleware = x402Middleware({
        recipientAddress: TEST_RECIPIENT,
        amount,
        tokenAddress: TEST_TOKEN,
        settlementAddress: TEST_SETTLEMENT,
        treasuryAddress: TEST_TREASURY,
        onError,
      });

      const badReq = {
        path: '/api/resource',
        originalUrl: '/api/resource',
        get headers() {
          throw new Error('Custom error');
        },
      } as unknown as X402Request;

      await middleware(badReq, res, next);

      // Avoid deep comparison of badReq (its headers getter throws)
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0]![0].message).toBe('Custom error');
    });
  });
});
