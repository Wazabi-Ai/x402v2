import { describe, it, expect, beforeEach } from 'vitest';
import type { Express, Request, Response } from 'express';
import type { PublicClient, WalletClient } from 'viem';
import { InMemoryStore } from '../src/facilitator/db/schema.js';
import { createFacilitator } from '../src/facilitator/server.js';
import { WalletService } from '../src/facilitator/services/wallet.js';
import {
  HANDLE_SUFFIX,
  SETTLEMENT_FEE_BPS,
} from '../src/facilitator/types.js';
import type { Permit2Payload, ERC3009Payload } from '../src/types/index.js';

// ============================================================================
// Mock Constants
// ============================================================================

const MOCK_TREASURY = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const MOCK_SETTLEMENT_ADDR = '0x4444444444444444444444444444444444444444' as `0x${string}`;
const MOCK_PAYER = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const MOCK_RECIPIENT = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const MOCK_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`;
const MOCK_TX_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const MOCK_SIGNATURE = ('0x' + 'cd'.repeat(65)) as `0x${string}`;

// ============================================================================
// Mock Viem Clients
// ============================================================================

const mockPublicClient = {
  readContract: async () => BigInt('1000000000000000000000'),
  getGasPrice: async () => BigInt(76_923_077),
  waitForTransactionReceipt: async () => ({
    status: 'success' as const,
    gasUsed: BigInt(65_000),
    effectiveGasPrice: BigInt(76_923_077),
  }),
} as unknown as PublicClient;

const mockWalletClient = {
  writeContract: async () => MOCK_TX_HASH,
  account: { address: MOCK_TREASURY },
  chain: { id: 8453 },
} as unknown as WalletClient;

const TEST_FACTORY_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;

const mockClients = {
  treasuryAddress: MOCK_TREASURY,
  settlementAddresses: {
    'eip155:8453': MOCK_SETTLEMENT_ADDR,
    'eip155:56': MOCK_SETTLEMENT_ADDR,
  } as Record<string, `0x${string}`>,
  publicClients: { 'eip155:8453': mockPublicClient, 'eip155:56': mockPublicClient } as Record<string, PublicClient>,
  walletClients: { 'eip155:8453': mockWalletClient, 'eip155:56': mockWalletClient } as Record<string, WalletClient>,
  walletService: new WalletService({
    accountFactoryAddresses: {
      'eip155:1': TEST_FACTORY_ADDRESS,
      'eip155:56': TEST_FACTORY_ADDRESS,
      'eip155:8453': TEST_FACTORY_ADDRESS,
    },
  }),
};

// ============================================================================
// Payload Builders
// ============================================================================

function buildPermit2Payload(overrides: Partial<Permit2Payload> = {}): Permit2Payload {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  return {
    scheme: 'permit2' as const,
    network: 'eip155:8453',
    permit: {
      permitted: [
        { token: MOCK_TOKEN, amount: '9950000' },
        { token: MOCK_TOKEN, amount: '50000' },
      ],
      nonce: '123456789',
      deadline,
    },
    witness: {
      recipient: MOCK_RECIPIENT,
      feeBps: 50,
    },
    spender: MOCK_SETTLEMENT_ADDR,
    payer: MOCK_PAYER,
    signature: MOCK_SIGNATURE,
    ...overrides,
  };
}

function buildERC3009Payload(overrides: Partial<ERC3009Payload> = {}): ERC3009Payload {
  return {
    scheme: 'erc3009' as const,
    network: 'eip155:8453',
    authorization: {
      from: MOCK_PAYER,
      to: MOCK_SETTLEMENT_ADDR,
      value: '10000000',
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
    },
    recipient: MOCK_RECIPIENT,
    payer: MOCK_PAYER,
    signature: MOCK_SIGNATURE,
    ...overrides,
  };
}

// ============================================================================
// Mock Express
// ============================================================================

interface MockRoute {
  method: string;
  path: string;
  handler: (req: Partial<Request>, res: MockResponse) => Promise<void> | void;
}

interface MockResponse {
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
  send: (data: string) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  sendStatus: (code: number) => MockResponse;
  sendFile: (path: string, cb?: (err: Error | null) => void) => MockResponse;
  _statusCode: number;
  _body: unknown;
  _headers: Record<string, string>;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    _statusCode: 200,
    _body: null,
    _headers: {},
    status(code: number) {
      res._statusCode = code;
      return res;
    },
    json(data: unknown) {
      res._body = data;
      return res;
    },
    send(data: string) {
      res._body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
    sendStatus(code: number) {
      res._statusCode = code;
      return res;
    },
    sendFile(_path: string, _cb?: (err: Error | null) => void) {
      return res;
    },
  };
  return res;
}

function createMockApp(): { app: Express; routes: MockRoute[] } {
  const routes: MockRoute[] = [];

  const app = {
    get(path: string, handler: MockRoute['handler']) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path: string, handler: MockRoute['handler']) {
      routes.push({ method: 'POST', path, handler });
    },
    use(pathOrHandler: string | MockRoute['handler'], maybeHandler?: MockRoute['handler']) {
      if (typeof pathOrHandler === 'function') {
        routes.push({ method: 'USE', path: '*', handler: pathOrHandler });
      } else if (maybeHandler) {
        routes.push({ method: 'USE', path: pathOrHandler, handler: maybeHandler });
      }
    },
  } as unknown as Express;

  return { app, routes };
}

function findRoute(routes: MockRoute[], method: string, path: string): MockRoute | undefined {
  return routes.find(r =>
    r.method === method &&
    (r.path === path || matchRoute(r.path, path))
  );
}

function matchRoute(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) =>
    part?.startsWith(':') || part === pathParts[i]
  );
}

// ============================================================================
// Facilitator Server Tests
// ============================================================================

describe('Facilitator Server', () => {
  let routes: MockRoute[];
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    const mock = createMockApp();
    routes = mock.routes;
    createFacilitator(mock.app, { store, cors: false, ...mockClients });
  });

  // ========================================================================
  // Route Registration Tests
  // ========================================================================

  describe('Route Registration', () => {
    it('should register GET /health', () => {
      expect(findRoute(routes, 'GET', '/health')).toBeDefined();
    });

    it('should register POST /register', () => {
      expect(findRoute(routes, 'POST', '/register')).toBeDefined();
    });

    it('should register GET /resolve/:handle', () => {
      expect(findRoute(routes, 'GET', '/resolve/:handle')).toBeDefined();
    });

    it('should register GET /balance/:handle', () => {
      expect(findRoute(routes, 'GET', '/balance/:handle')).toBeDefined();
    });

    it('should register GET /history/:handle', () => {
      expect(findRoute(routes, 'GET', '/history/:handle')).toBeDefined();
    });

    it('should register GET /profile/:handle', () => {
      expect(findRoute(routes, 'GET', '/profile/:handle')).toBeDefined();
    });

    it('should register GET /deployment/:handle', () => {
      expect(findRoute(routes, 'GET', '/deployment/:handle')).toBeDefined();
    });

    it('should register POST /verify', () => {
      expect(findRoute(routes, 'POST', '/verify')).toBeDefined();
    });

    it('should register POST /x402/settle', () => {
      expect(findRoute(routes, 'POST', '/x402/settle')).toBeDefined();
    });

    it('should register GET /supported', () => {
      expect(findRoute(routes, 'GET', '/supported')).toBeDefined();
    });

    it('should register GET /skill.md', () => {
      expect(findRoute(routes, 'GET', '/skill.md')).toBeDefined();
    });
  });

  // ========================================================================
  // Health Check Tests
  // ========================================================================

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const route = findRoute(routes, 'GET', '/health')!;
      const res = createMockResponse();
      await route.handler({}, res);

      expect(res._statusCode).toBe(200);
      expect(res._body).toHaveProperty('status', 'healthy');
      expect(res._body).toHaveProperty('service', 'wazabi-x402-facilitator');
    });
  });

  // ========================================================================
  // Registration Tests
  // ========================================================================

  describe('POST /register', () => {
    it('should register a new handle', async () => {
      const route = findRoute(routes, 'POST', '/register')!;
      const res = createMockResponse();

      await route.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        res
      );

      expect(res._statusCode).toBe(201);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('handle', 'molty.wazabi-x402');
      expect(body).toHaveProperty('wallet');
      expect(body).toHaveProperty('session_key');
    });

    it('should reject invalid handle', async () => {
      const route = findRoute(routes, 'POST', '/register')!;
      const res = createMockResponse();

      await route.handler(
        { body: { handle: 'A' } },
        res
      );

      expect(res._statusCode).toBe(400);
    });

    it('should reject duplicate handle', async () => {
      const route = findRoute(routes, 'POST', '/register')!;
      const res1 = createMockResponse();
      await route.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        res1
      );

      const res2 = createMockResponse();
      await route.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        res2
      );

      expect(res2._statusCode).toBe(409);
    });

    it('should reject missing body', async () => {
      const route = findRoute(routes, 'POST', '/register')!;
      const res = createMockResponse();

      await route.handler({ body: {} }, res);

      expect(res._statusCode).toBe(400);
    });
  });

  // ========================================================================
  // Resolve Tests
  // ========================================================================

  describe('GET /resolve/:handle', () => {
    it('should resolve registered handle', async () => {
      // First register
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        regRes
      );

      // Then resolve
      const resolveRoute = findRoute(routes, 'GET', '/resolve/:handle')!;
      const res = createMockResponse();
      await resolveRoute.handler(
        { params: { handle: 'molty' } } as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('handle', 'molty.wazabi-x402');
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('active', true);
    });

    it('should return 404 for unknown handle', async () => {
      const route = findRoute(routes, 'GET', '/resolve/:handle')!;
      const res = createMockResponse();
      await route.handler(
        { params: { handle: 'unknown' } } as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(404);
    });
  });

  // ========================================================================
  // Balance Tests
  // ========================================================================

  describe('GET /balance/:handle', () => {
    it('should return balances for registered handle', async () => {
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:56', 'eip155:8453'] } },
        regRes
      );

      const balanceRoute = findRoute(routes, 'GET', '/balance/:handle')!;
      const res = createMockResponse();
      await balanceRoute.handler(
        { params: { handle: 'molty' } } as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('handle', 'molty.wazabi-x402');
      expect(body).toHaveProperty('balances');
      expect(body).toHaveProperty('total_usd');
    });

    it('should return 404 for unknown handle', async () => {
      const route = findRoute(routes, 'GET', '/balance/:handle')!;
      const res = createMockResponse();
      await route.handler(
        { params: { handle: 'unknown' } } as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(404);
    });
  });

  // ========================================================================
  // x402 Settlement Tests
  // ========================================================================

  describe('POST /x402/settle', () => {
    it('should settle Permit2 payment', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: buildPermit2Payload() },
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('txHash', MOCK_TX_HASH);
      expect(body).toHaveProperty('network', 'eip155:8453');
      expect(body).toHaveProperty('settlementId');
    });

    it('should settle ERC-3009 payment', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: buildERC3009Payload() },
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('txHash', MOCK_TX_HASH);
    });

    it('should reject invalid request body', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: { scheme: 'permit2' } }, // Missing required fields
        res
      );

      expect(res._statusCode).toBe(400);
    });

    it('should reject completely invalid body', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: {} },
        res
      );

      expect(res._statusCode).toBe(400);
    });

    it('should reject unknown scheme', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: { scheme: 'unknown', network: 'eip155:8453' } },
        res
      );

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 for unsupported network', async () => {
      const route = findRoute(routes, 'POST', '/x402/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: buildPermit2Payload({ network: 'eip155:999' }) },
        res
      );

      expect(res._statusCode).toBe(400);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('error', 'NETWORK_NOT_CONFIGURED');
    });
  });

  // ========================================================================
  // Supported Tests
  // ========================================================================

  describe('GET /supported', () => {
    it('should return supported networks and tokens', async () => {
      const route = findRoute(routes, 'GET', '/supported')!;
      const res = createMockResponse();
      await route.handler({}, res);

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('networks');
      expect(body).toHaveProperty('handle_suffix', HANDLE_SUFFIX);
      expect(body).toHaveProperty('wallet_type', 'ERC-4337');

      const networks = (body as { networks: Array<{ id: string }> }).networks;
      const ids = networks.map(n => n.id);
      expect(ids).toContain('eip155:56');
      expect(ids).toContain('eip155:8453');
    });
  });

  // ========================================================================
  // Skill File Tests
  // ========================================================================

  describe('GET /skill.md', () => {
    it('should return SKILL.md content', async () => {
      const route = findRoute(routes, 'GET', '/skill.md')!;
      const res = createMockResponse();
      await route.handler({}, res);

      expect(res._headers['Content-Type']).toBe('text/markdown; charset=utf-8');
      expect(typeof res._body).toBe('string');
      expect(res._body as string).toContain('Wazabi x402');
      expect(res._body as string).toContain('/register');
      expect(res._body as string).toContain('/settle');
      expect(res._body as string).toContain('0.5%');
    });
  });

  // ========================================================================
  // History Tests
  // ========================================================================

  describe('GET /history/:handle', () => {
    it('should return history for registered handle with transactions', async () => {
      // Register agent
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const r1 = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        r1
      );

      // Create a transaction directly in the store
      await store.createTransaction({
        id: 'tx-hist-1',
        from_handle: 'molty.wazabi-x402',
        to_address: MOCK_RECIPIENT,
        amount: '25000000',
        token: MOCK_TOKEN,
        network: 'eip155:8453',
        fee: '0',
        gas_cost: '0',
        tx_hash: MOCK_TX_HASH,
        status: 'confirmed',
        created_at: new Date(),
      });

      // Get history
      const histRoute = findRoute(routes, 'GET', '/history/:handle')!;
      const res = createMockResponse();
      await histRoute.handler(
        {
          params: { handle: 'molty' },
          query: { limit: '20', offset: '0' },
        } as unknown as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('handle', 'molty.wazabi-x402');

      const txs = (body as { transactions: Array<{ type: string; amount: string }> }).transactions;
      expect(txs).toHaveLength(1);
      expect(txs[0]?.type).toBe('payment_sent');
      expect(txs[0]?.amount).toBe('25000000');
    });

    it('should return 404 for unknown handle', async () => {
      const route = findRoute(routes, 'GET', '/history/:handle')!;
      const res = createMockResponse();
      await route.handler(
        {
          params: { handle: 'unknown' },
          query: {},
        } as unknown as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(404);
    });
  });

  // ========================================================================
  // Profile Tests
  // ========================================================================

  describe('GET /profile/:handle', () => {
    it('should return full profile', async () => {
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        {
          body: {
            handle: 'molty',
            networks: ['eip155:8453'],
            metadata: { agent_type: 'openclaw' },
          },
        },
        regRes
      );

      const profRoute = findRoute(routes, 'GET', '/profile/:handle')!;
      const res = createMockResponse();
      await profRoute.handler(
        { params: { handle: 'molty' } } as Partial<Request>,
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('handle', 'molty.wazabi-x402');
      expect(body).toHaveProperty('wallet_address');
      expect(body).toHaveProperty('networks');
      expect(body).toHaveProperty('metadata');
      expect(body).toHaveProperty('total_transactions', 0);
    });
  });

  // ========================================================================
  // Verify Tests
  // ========================================================================

  describe('POST /verify', () => {
    it('should verify a registered sender', async () => {
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        regRes
      );

      const verifyRoute = findRoute(routes, 'POST', '/verify')!;
      const res = createMockResponse();
      await verifyRoute.handler(
        {
          body: {
            from: 'molty',
            amount: '10.00',
            token: 'USDC',
            network: 'eip155:8453',
          },
        },
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('valid', true);
    });

    it('should reject missing required fields', async () => {
      const route = findRoute(routes, 'POST', '/verify')!;
      const res = createMockResponse();

      await route.handler({ body: {} }, res);

      expect(res._statusCode).toBe(400);
    });
  });
});
