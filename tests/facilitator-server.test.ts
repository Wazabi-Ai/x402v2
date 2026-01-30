import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { InMemoryStore } from '../src/facilitator/db/schema.js';
import { createFacilitator } from '../src/facilitator/server.js';
import {
  HANDLE_SUFFIX,
  SETTLEMENT_FEE_BPS,
} from '../src/facilitator/types.js';

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
        // Middleware without path
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
  // Simple :param matching
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
    createFacilitator(mock.app, { store, cors: false });
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

    it('should register POST /verify', () => {
      expect(findRoute(routes, 'POST', '/verify')).toBeDefined();
    });

    it('should register POST /settle', () => {
      expect(findRoute(routes, 'POST', '/settle')).toBeDefined();
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
      // Register first
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:56', 'eip155:8453'] } },
        regRes
      );

      // Get balance
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
  // Settlement Tests
  // ========================================================================

  describe('POST /settle', () => {
    beforeEach(async () => {
      // Register two agents
      const regRoute = findRoute(routes, 'POST', '/register')!;

      const res1 = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        res1
      );

      const res2 = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'agent-b', networks: ['eip155:8453'] } },
        res2
      );
    });

    it('should settle payment between agents', async () => {
      const route = findRoute(routes, 'POST', '/settle')!;
      const res = createMockResponse();

      await route.handler(
        {
          body: {
            from: 'molty',
            to: 'agent-b',
            amount: '10.00',
            token: 'USDC',
            network: 'eip155:8453',
          },
        },
        res
      );

      expect(res._statusCode).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('tx_hash');
      expect(body).toHaveProperty('settlement');

      const settlement = (body as { settlement: Record<string, string> }).settlement;
      expect(settlement.gross).toBe('10.00');
      expect(settlement.fee).toBe('0.05'); // 0.5% of 10.00
    });

    it('should reject invalid request body', async () => {
      const route = findRoute(routes, 'POST', '/settle')!;
      const res = createMockResponse();

      await route.handler(
        { body: { from: 'molty' } }, // Missing required fields
        res
      );

      expect(res._statusCode).toBe(400);
    });

    it('should reject unknown sender', async () => {
      const route = findRoute(routes, 'POST', '/settle')!;
      const res = createMockResponse();

      await route.handler(
        {
          body: {
            from: 'unknown-sender',
            to: 'agent-b',
            amount: '10.00',
          },
        },
        res
      );

      expect(res._statusCode).toBe(404);
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
    it('should return history after settlement', async () => {
      // Register agents
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const r1 = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        r1
      );
      const r2 = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'agent-b', networks: ['eip155:8453'] } },
        r2
      );

      // Settle
      const settleRoute = findRoute(routes, 'POST', '/settle')!;
      const sr = createMockResponse();
      await settleRoute.handler(
        {
          body: {
            from: 'molty',
            to: 'agent-b',
            amount: '25.00',
            token: 'USDC',
            network: 'eip155:8453',
          },
        },
        sr
      );

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
      expect(txs[0]?.amount).toBe('25.00');
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
      // Register
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

      // Get profile
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
      // Register
      const regRoute = findRoute(routes, 'POST', '/register')!;
      const regRes = createMockResponse();
      await regRoute.handler(
        { body: { handle: 'molty', networks: ['eip155:8453'] } },
        regRes
      );

      // Verify
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
