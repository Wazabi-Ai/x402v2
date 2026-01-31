/**
 * Wazabi x402 Facilitator Server
 *
 * The complete Agent Financial Platform server that extends the x402 protocol
 * with identity (handles), smart wallets (ERC-4337), and settlement (0.5% fee).
 *
 * Endpoints:
 *   POST   /register        — Create handle + deploy smart wallet
 *   GET    /resolve/:handle — Handle → address lookup
 *   GET    /balance/:handle — Token balances across chains
 *   GET    /history/:handle — Transaction history
 *   GET    /profile/:handle — Full agent profile
 *   POST   /verify          — Verify payment (x402 standard)
 *   POST   /settle          — Execute payment + 0.5% fee
 *   GET    /supported       — Networks, tokens, schemes
 *   GET    /health          — Health check
 *   GET    /skill.md        — OpenClaw skill file
 *   GET    /                — Portal dashboard (if portalDir configured)
 */

import { resolve, join } from 'node:path';
import type { Request, Response, NextFunction, Express } from 'express';
import { InMemoryStore } from './db/schema.js';
import { HandleService, HandleError } from './services/handle.js';
import { SettlementService, SettlementError } from './services/settlement.js';
import { WalletService } from './services/wallet.js';
import {
  RegisterRequestSchema,
  SettleRequestSchema,
  VerifyRequestSchema,
  HANDLE_SUFFIX,
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  AGENT_SUPPORTED_NETWORKS,
} from './types.js';
import type {
  SupportedResponse,
  BalanceResponse,
  ResolveResponse,
  ProfileResponse,
} from './types.js';
import { SUPPORTED_NETWORKS, getSupportedNetworkIds } from '../chains/index.js';
import type { PublicClient, WalletClient } from 'viem';

// ============================================================================
// Facilitator Application
// ============================================================================

export interface FacilitatorConfig {
  /** Custom store (defaults to InMemoryStore) */
  store?: InMemoryStore;
  /** Custom wallet service */
  walletService?: WalletService;
  /** Enable CORS (default: true) */
  cors?: boolean;
  /** Absolute or relative path to the facilitator-portal directory to serve the dashboard UI at root */
  portalDir?: string;
  /** Treasury wallet address for fee collection (required) */
  treasuryAddress: `0x${string}`;
  /** Public clients for on-chain reads, keyed by CAIP-2 network ID (required) */
  publicClients: Record<string, PublicClient>;
  /** Wallet clients for on-chain writes, keyed by CAIP-2 network ID (required) */
  walletClients: Record<string, WalletClient>;
}

/**
 * Create and configure the Wazabi x402 Facilitator routes
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createFacilitator } from '@wazabiai/x402/facilitator';
 *
 * const app = express();
 * app.use(express.json());
 * createFacilitator(app);
 * app.listen(3000);
 * ```
 */
export function createFacilitator(
  app: Express,
  config: FacilitatorConfig
): void {
  const store = config.store ?? new InMemoryStore();
  const walletService = config.walletService ?? new WalletService();
  const handleService = new HandleService(store, walletService);

  const settlementService = new SettlementService(handleService, store, {
    treasuryAddress: config.treasuryAddress,
    publicClients: config.publicClients,
    walletClients: config.walletClients,
  });

  // CORS middleware
  if (config.cors !== false) {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment-Signature, X-Payment-Payload');
      if (_req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // ========================================================================
  // Health Check
  // ========================================================================

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'wazabi-x402-facilitator',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // ========================================================================
  // POST /register — Create handle + deploy smart wallet
  // ========================================================================

  app.post('/register', async (req: Request, res: Response) => {
    try {
      const parsed = RegisterRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid Request',
          message: parsed.error.issues.map(i => i.message).join('; '),
          details: parsed.error.issues,
        });
        return;
      }

      const result = await handleService.register(parsed.data);

      res.status(201).json(result);
    } catch (error) {
      if (error instanceof HandleError) {
        const statusCode = error.code === 'HANDLE_TAKEN' ? 409 : 400;
        res.status(statusCode).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      console.error('[facilitator] Registration error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Registration failed',
      });
    }
  });

  // ========================================================================
  // GET /resolve/:handle — Handle → address lookup
  // ========================================================================

  app.get('/resolve/:handle', async (req: Request, res: Response) => {
    try {
      const handle = req.params['handle'];
      if (!handle) {
        res.status(400).json({ error: 'MISSING_HANDLE', message: 'Handle parameter required' });
        return;
      }

      const result = await handleService.resolve(handle);
      if (!result) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Handle "${handle}" not found`,
        });
        return;
      }

      const response: ResolveResponse = result;
      res.json(response);
    } catch (error) {
      console.error('[facilitator] Resolve error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Resolution failed',
      });
    }
  });

  // ========================================================================
  // GET /balance/:handle — Token balances across chains
  // ========================================================================

  app.get('/balance/:handle', async (req: Request, res: Response) => {
    try {
      const handle = req.params['handle'];
      if (!handle) {
        res.status(400).json({ error: 'MISSING_HANDLE', message: 'Handle parameter required' });
        return;
      }

      const profile = await handleService.getProfile(handle);
      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Handle "${handle}" not found`,
        });
        return;
      }

      // Group balances by network
      const balances: Record<string, Record<string, string>> = {};
      let totalUsd = 0;

      for (const b of profile.balances) {
        if (!balances[b.network]) {
          balances[b.network] = {};
        }
        balances[b.network]![b.token] = b.balance;
        totalUsd += parseFloat(b.balance); // Simplified: assume 1:1 USD for stablecoins
      }

      const response: BalanceResponse = {
        handle: profile.agent.full_handle,
        balances,
        total_usd: totalUsd.toFixed(2),
      };

      res.json(response);
    } catch (error) {
      console.error('[facilitator] Balance error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Balance lookup failed',
      });
    }
  });

  // ========================================================================
  // GET /history/:handle — Transaction history
  // ========================================================================

  app.get('/history/:handle', async (req: Request, res: Response) => {
    try {
      const handle = req.params['handle'];
      if (!handle) {
        res.status(400).json({ error: 'MISSING_HANDLE', message: 'Handle parameter required' });
        return;
      }

      const limit = parseInt(req.query['limit'] as string) || 20;
      const offset = parseInt(req.query['offset'] as string) || 0;

      const result = await settlementService.getHistory(handle, limit, offset);
      res.json(result);
    } catch (error) {
      if (error instanceof SettlementError) {
        res.status(404).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      console.error('[facilitator] History error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'History lookup failed',
      });
    }
  });

  // ========================================================================
  // GET /profile/:handle — Full agent profile
  // ========================================================================

  app.get('/profile/:handle', async (req: Request, res: Response) => {
    try {
      const handle = req.params['handle'];
      if (!handle) {
        res.status(400).json({ error: 'MISSING_HANDLE', message: 'Handle parameter required' });
        return;
      }

      const profile = await handleService.getProfile(handle);
      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Handle "${handle}" not found`,
        });
        return;
      }

      // Build balance map
      const balances: Record<string, Record<string, string>> = {};
      for (const b of profile.balances) {
        if (!balances[b.network]) {
          balances[b.network] = {};
        }
        balances[b.network]![b.token] = b.balance;
      }

      const response: ProfileResponse = {
        handle: profile.agent.full_handle,
        wallet_address: profile.agent.wallet_address,
        networks: [...AGENT_SUPPORTED_NETWORKS],
        created_at: profile.agent.created_at.toISOString(),
        metadata: profile.agent.metadata,
        balances,
        total_transactions: profile.totalTransactions,
      };

      res.json(response);
    } catch (error) {
      console.error('[facilitator] Profile error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Profile lookup failed',
      });
    }
  });

  // ========================================================================
  // GET /deployment/:handle — Wallet deployment status across networks
  // ========================================================================

  app.get('/deployment/:handle', async (req: Request, res: Response) => {
    try {
      const handle = req.params['handle'];
      if (!handle) {
        res.status(400).json({ error: 'MISSING_HANDLE', message: 'Handle parameter required' });
        return;
      }

      const status = await handleService.getDeploymentStatus(handle);
      res.json(status);
    } catch (error) {
      if (error instanceof HandleError) {
        res.status(404).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      console.error('[facilitator] Deployment status error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to check deployment status',
      });
    }
  });

  // ========================================================================
  // POST /verify — Verify payment (x402 standard)
  // ========================================================================

  app.post('/verify', async (req: Request, res: Response) => {
    try {
      const parsed = VerifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: parsed.error.issues.map(i => i.message).join('; '),
          details: parsed.error.issues,
        });
        return;
      }

      const result = await settlementService.verifyPayment(parsed.data);

      res.json(result);
    } catch (error) {
      console.error('[facilitator] Verify error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Verification failed',
      });
    }
  });

  // ========================================================================
  // POST /settle — Execute payment + 0.5% fee
  // ========================================================================

  app.post('/settle', async (req: Request, res: Response) => {
    try {
      const parsed = SettleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: parsed.error.issues.map(i => i.message).join('; '),
          details: parsed.error.issues,
        });
        return;
      }

      const result = await settlementService.settle(parsed.data);
      res.json(result);
    } catch (error) {
      if (error instanceof SettlementError) {
        const statusCode = error.code === 'HANDLE_NOT_FOUND' ? 404 : 400;
        res.status(statusCode).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      console.error('[facilitator] Settle error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Settlement failed',
      });
    }
  });

  // ========================================================================
  // GET /supported — Networks, tokens, schemes
  // ========================================================================

  app.get('/supported', (_req: Request, res: Response) => {
    const networks = getSupportedNetworkIds().map(id => {
      const networkConfig = SUPPORTED_NETWORKS[id];
      return {
        id,
        name: networkConfig?.name ?? id,
        tokens: Object.keys(networkConfig?.tokens ?? {}),
      };
    });

    const response: SupportedResponse & { treasury_address: string } = {
      networks,
      handle_suffix: HANDLE_SUFFIX,
      fee_rate: `${SETTLEMENT_FEE_BPS}bps (${SETTLEMENT_FEE_RATE * 100}%)`,
      wallet_type: 'ERC-4337',
      treasury_address: config.treasuryAddress,
    };

    res.json(response);
  });

  // ========================================================================
  // GET /skill.md — OpenClaw skill file
  // ========================================================================

  app.get('/skill.md', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(SKILL_MD_CONTENT);
  });

  // ========================================================================
  // Portal Dashboard (static files)
  // ========================================================================

  if (config.portalDir) {
    const portalDir = resolve(config.portalDir);

    const servePortalFile = (file: string) => (_req: Request, res: Response) => {
      res.sendFile(join(portalDir, file), (err: Error | null) => {
        if (err) {
          res.status(404).json({ error: 'NOT_FOUND', message: 'File not found' });
        }
      });
    };

    app.get('/', servePortalFile('index.html'));
    app.get('/favicon.svg', servePortalFile('favicon.svg'));
    app.get('/styles/main.css', servePortalFile('styles/main.css'));
    app.get('/scripts/main.js', servePortalFile('scripts/main.js'));
  }
}

// ============================================================================
// OpenClaw SKILL.md Content (embedded)
// ============================================================================

const SKILL_MD_CONTENT = `# Wazabi x402 Payment Skill

## Description
Enable your agent to send and receive payments using the Wazabi x402 protocol.
Provides ERC-4337 smart wallet with gasless transactions on Ethereum, BNB Chain, and Base.

## Setup
To activate this skill, tell your agent:
\`\`\`
Register me for x402 payments with handle <your-handle>
\`\`\`

## API Base URL
\`\`\`
https://facilitator.wazabi.ai
\`\`\`

## Commands

### Register
\`\`\`
POST /register
{
  "handle": "<desired-handle>",
  "networks": ["eip155:1", "eip155:56", "eip155:8453"]
}
\`\`\`
Returns: wallet address, session key (store securely)

### Check Balance
\`\`\`
GET /balance/<handle>.wazabi-x402
\`\`\`

### Send Payment
\`\`\`
POST /settle
{
  "from": "<your-handle>",
  "to": "<recipient-handle-or-address>",
  "amount": "10.00",
  "token": "USDC",
  "network": "eip155:8453"
}
\`\`\`
Fee: 0.5% settlement fee applied automatically

### View History
\`\`\`
GET /history/<handle>.wazabi-x402
\`\`\`

### Resolve Handle
\`\`\`
GET /resolve/<handle>.wazabi-x402
\`\`\`

## Auto-Payment (HTTP 402)
When encountering an HTTP 402 response:
1. Parse the X-Payment-Required header
2. Check balance via GET /balance
3. If sufficient, sign payment with session key
4. POST /settle with payment details
5. Retry original request

## Supported Networks
- Ethereum (eip155:1): USDC, USDT, WETH
- BNB Chain (eip155:56): USDT, USDC, BUSD, WBNB
- Base (eip155:8453): USDC

## Handle Format
\`<name>.wazabi-x402\` — e.g., \`molty.wazabi-x402\`
`;

// ============================================================================
// Standalone Server Factory
// ============================================================================

/**
 * Create a standalone facilitator server
 *
 * @example
 * ```typescript
 * import { startFacilitator } from '@wazabiai/x402/facilitator';
 * startFacilitator(3000);
 * ```
 */
export async function startFacilitator(
  port: number = 3000,
  config: FacilitatorConfig
): Promise<void> {
  // Dynamic import to keep express as optional peer dependency
  const { default: express } = await import('express');
  const app = express();

  app.use(express.json());
  createFacilitator(app, config);

  app.listen(port, () => {
    console.log(`[wazabi-x402] Facilitator running on port ${port}`);
    console.log(`[wazabi-x402] Health: http://localhost:${port}/health`);
    console.log(`[wazabi-x402] Skill:  http://localhost:${port}/skill.md`);
    if (config?.portalDir) {
      console.log(`[wazabi-x402] Portal: http://localhost:${port}/`);
    }
  });
}
