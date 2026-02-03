/**
 * Wazabi x402 Facilitator Server
 *
 * A thin settlement relay for the x402 payment protocol.
 * Receives signed Permit2/ERC-3009 payloads from payers and submits them on-chain.
 * The facilitator pays gas but cannot redirect funds (non-custodial).
 *
 * Authentication follows the Coinbase x402 pattern:
 * - Protected endpoints (/x402/settle, /verify) require Bearer token when apiKeys is set
 * - Public endpoints (/health, /supported, /skill.md) are always open
 * - Payments are self-authenticating via cryptographic signatures; API key auth
 *   provides service-level access control
 */

import type { Express, Request, Response, NextFunction } from 'express';
import type { PublicClient, WalletClient } from 'viem';
import { InMemoryStore } from './db/schema.js';
import { SettlementService, SettlementError } from './services/settlement.js';
import { VerifyRequestSchema, SUPPORTED_NETWORK_IDS, isAddress } from './types.js';
import { PaymentPayloadSchema, DEFAULT_FEE_BPS } from '../types/index.js';

// ============================================================================
// Rate Limiter (sliding window, per-IP)
// ============================================================================

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;
  private readonly max: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(windowMs: number = 60_000, max: number = 60) {
    this.windowMs = windowMs;
    this.max = max;
  }

  isAllowed(key: string): boolean {
    this.lazyStartCleanup();
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    return entry.count <= this.max;
  }

  private lazyStartCleanup() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.hits) {
        if (entry.resetAt <= now) this.hits.delete(key);
      }
    }, this.windowMs);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }
}

// ============================================================================
// Facilitator Config
// ============================================================================

export interface FacilitatorConfig {
  store?: InMemoryStore;
  treasuryAddress: `0x${string}`;
  settlementAddresses?: Record<string, `0x${string}`>;
  publicClients: Record<string, PublicClient>;
  walletClients: Record<string, WalletClient>;
  cors?: boolean;
  rateLimitMax?: number;
  portalDir?: string;
  /**
   * Optional API keys for authenticating requests to protected endpoints.
   * When set, /x402/settle and /verify require a valid
   * `Authorization: Bearer <key>` header. Public endpoints (/health,
   * /supported, /skill.md) remain unauthenticated.
   *
   * Follows the Coinbase x402 facilitator auth pattern.
   */
  apiKeys?: string[];
}

// ============================================================================
// API Key Auth Middleware
// ============================================================================

function createApiKeyAuth(apiKeys: string[]) {
  const keySet = new Set(apiKeys);

  return (req: Partial<Request>, res: Response, next: NextFunction): void => {
    const authHeader = (req.headers as Record<string, string | undefined>)?.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing Authorization header. Use: Authorization: Bearer <api-key>',
      });
      return;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1] || !keySet.has(match[1])) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Invalid API key.',
      });
      return;
    }

    next();
  };
}

// ============================================================================
// Skill file generator
// ============================================================================

function generateSkillMarkdown(baseUrl: string, authRequired: boolean): string {
  const authNote = authRequired
    ? `\n## Authentication\nProtected endpoints require \`Authorization: Bearer <api-key>\` header.\nPublic endpoints (/health, /supported) do not require authentication.\n`
    : '';

  return `# Wazabi x402 Facilitator

## Overview
Non-custodial settlement relay for the x402 payment protocol. Submit signed Permit2 or ERC-3009 payment payloads and the facilitator settles them on-chain. The facilitator pays gas but cannot redirect funds.

## Base URL
${baseUrl}
${authNote}
## Endpoints

### POST /x402/settle
Submit a signed x402 payment for on-chain settlement.

**Body (Permit2):**
\`\`\`json
{
  "scheme": "permit2",
  "network": "eip155:8453",
  "payer": "0x...",
  "signature": "0x...",
  "permit": {
    "permitted": [
      { "token": "0x...", "amount": "9950000" },
      { "token": "0x...", "amount": "50000" }
    ],
    "nonce": "123456789",
    "deadline": 1700000000
  },
  "witness": { "recipient": "0x...", "feeBps": 50 },
  "spender": "0x..."
}
\`\`\`

**Body (ERC-3009):**
\`\`\`json
{
  "scheme": "erc3009",
  "network": "eip155:8453",
  "payer": "0x...",
  "recipient": "0x...",
  "signature": "0x...",
  "authorization": {
    "from": "0x...",
    "to": "0x...",
    "value": "10000000",
    "validAfter": 0,
    "validBefore": 1700000000,
    "nonce": "0x..."
  }
}
\`\`\`

### POST /verify
Verify a payment sender address.

### GET /history/:address
Transaction history for an Ethereum address.

### GET /supported
List supported networks, tokens, and settlement schemes.

### GET /health
Health check.

## Fee
0.5% protocol fee, split atomically on-chain.

## Networks
- Ethereum (eip155:1): USDC, USDT, WETH
- BNB Chain (eip155:56): USDT, USDC, WBNB
- Base (eip155:8453): USDC, WETH
`;
}

// ============================================================================
// Create Facilitator (mount routes on an Express app)
// ============================================================================

export function createFacilitator(app: Express, config: FacilitatorConfig): void {
  const store = config.store ?? new InMemoryStore();
  const settlement = new SettlementService(store, {
    treasuryAddress: config.treasuryAddress,
    settlementAddresses: config.settlementAddresses ?? {},
    publicClients: config.publicClients,
    walletClients: config.walletClients,
  });

  const rateLimiter = new RateLimiter(60_000, config.rateLimitMax ?? 60);
  const authRequired = Array.isArray(config.apiKeys) && config.apiKeys.length > 0;
  const authMiddleware = authRequired
    ? createApiKeyAuth(config.apiKeys!)
    : (_req: Partial<Request>, _res: Response, next: NextFunction) => next();

  // --------------------------------------------------------------------------
  // GET /health (public)
  // --------------------------------------------------------------------------
  app.get('/health', (_req: Partial<Request>, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'wazabi-x402-facilitator',
      authRequired,
      timestamp: new Date().toISOString(),
    });
  });

  // --------------------------------------------------------------------------
  // POST /x402/settle — Non-custodial x402 settlement (protected)
  // --------------------------------------------------------------------------
  app.post('/x402/settle', authMiddleware, async (req: Partial<Request>, res: Response) => {
    // Rate limiting: keyed by client IP
    const clientKey = (req as Record<string, any>).ip ??
                       (req as Record<string, any>).socket?.remoteAddress ??
                       'unknown';
    if (!rateLimiter.isAllowed(clientKey)) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
      });
      return;
    }

    try {
      const parsed = PaymentPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_PAYLOAD',
          details: parsed.error.issues.map(i => i.message),
        });
        return;
      }

      const result = await settlement.settleX402(parsed.data);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof SettlementError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Settlement failed' });
      }
    }
  });

  // --------------------------------------------------------------------------
  // POST /verify — Verify payment sender (protected)
  // --------------------------------------------------------------------------
  app.post('/verify', authMiddleware, async (req: Partial<Request>, res: Response) => {
    try {
      const parsed = VerifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          details: parsed.error.issues.map(i => i.message),
        });
        return;
      }

      const result = await settlement.verifyPayment(parsed.data);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Verification failed' });
    }
  });

  // --------------------------------------------------------------------------
  // GET /history/:address — Transaction history by address
  // --------------------------------------------------------------------------
  app.get('/history/:address', async (req: Partial<Request>, res: Response) => {
    try {
      const address = (req.params as Record<string, string>)?.address;
      if (!address || !isAddress(address)) {
        res.status(400).json({ error: 'INVALID_ADDRESS', message: 'Provide a valid Ethereum address.' });
        return;
      }

      const query = (req.query ?? {}) as Record<string, string>;
      const limit = parseInt(query.limit || '20');
      const offset = parseInt(query.offset || '0');

      const history = await settlement.getHistory(address, limit, offset);
      res.status(200).json(history);
    } catch (err) {
      if (err instanceof SettlementError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    }
  });

  // --------------------------------------------------------------------------
  // GET /supported — Available networks, tokens, and schemes (public)
  // --------------------------------------------------------------------------
  app.get('/supported', (_req: Partial<Request>, res: Response) => {
    res.status(200).json({
      networks: [
        { id: 'eip155:1', name: 'Ethereum', tokens: ['USDC', 'USDT', 'WETH'] },
        { id: 'eip155:56', name: 'BNB Chain', tokens: ['USDT', 'USDC', 'WBNB'] },
        { id: 'eip155:8453', name: 'Base', tokens: ['USDC', 'WETH'] },
      ],
      schemes: ['permit2', 'erc3009'],
      fee_bps: DEFAULT_FEE_BPS,
      fee_description: '0.5% protocol fee, split atomically on-chain',
    });
  });

  // --------------------------------------------------------------------------
  // GET /skill.md — OpenClaw skill file (public)
  // --------------------------------------------------------------------------
  app.get('/skill.md', (req: Partial<Request>, res: Response) => {
    const host = (req.headers as Record<string, string>)?.host ?? 'facilitator.wazabi.ai';
    const proto = (req.headers as Record<string, string>)?.['x-forwarded-proto'] ?? 'https';
    const baseUrl = `${proto}://${host}`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(generateSkillMarkdown(baseUrl, authRequired));
  });

  // --------------------------------------------------------------------------
  // Serve portal dashboard if configured
  // --------------------------------------------------------------------------
  if (config.portalDir) {
    const express = require('express') as typeof import('express');
    app.use('/', express.static(config.portalDir));
  }
}

// ============================================================================
// Standalone Server
// ============================================================================

export function startFacilitator(port: number, config: FacilitatorConfig): void {
  const express = require('express') as typeof import('express');
  const app = express();
  app.use(express.json());

  createFacilitator(app, config);

  const authMode = config.apiKeys?.length ? 'API key auth enabled' : 'no auth (public)';
  app.listen(port, () => {
    console.log(`[facilitator] Wazabi x402 Facilitator running on port ${port}`);
    console.log(`[facilitator] Networks: ${SUPPORTED_NETWORK_IDS.join(', ')}`);
    console.log(`[facilitator] Treasury: ${config.treasuryAddress}`);
    console.log(`[facilitator] Auth: ${authMode}`);
  });
}
