import type { Request, Response, NextFunction, RequestHandler } from 'express';
import axios from 'axios';
import {
  type Address,
} from 'viem';

import {
  type PaymentRequirement,
  type PaymentPayload,
  type PaymentResponse,
  type X402MiddlewareConfig,
  type PaymentScheme,
  type FacilitatorEndpointConfig,
  PaymentPayloadSchema,
  X402_HEADERS,
  X402_VERSION,
  DEFAULT_FEE_BPS,
  calculateDeadline,
  extractChainId,
} from '../types/index.js';
import {
  BASE_CAIP_ID,
  BASE_USDC,
} from '../chains/base.js';

// ============================================================================
// Nonce Registry (replay protection)
// ============================================================================

class NonceRegistry {
  private readonly used = new Map<string, number>();
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  claim(nonce: string): boolean {
    this.lazyStartSweep();
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, Date.now() + this.ttlMs);
    return true;
  }

  private lazyStartSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [nonce, expiry] of this.used) {
        if (expiry < now) this.used.delete(nonce);
      }
    }, 60_000);
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }
}

const nonceRegistry = new NonceRegistry();

// ============================================================================
// Types
// ============================================================================

export interface X402Request extends Request {
  x402?: {
    payment: PaymentPayload;
    verified: boolean;
    signer: Address;
    settlementResult?: PaymentResponse;
  };
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create x402 payment middleware for Express.
 *
 * Returns 402 with proper `accepts` array when no payment is present.
 * Validates and optionally forwards payment to a facilitator for on-chain settlement.
 *
 * @example
 * ```typescript
 * app.use('/api/paid', x402Middleware({
 *   recipientAddress: '0x...',
 *   amount: '1000000',
 *   tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
 *   settlementAddress: '0x...',
 *   treasuryAddress: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
 *   facilitatorUrl: 'https://facilitator.wazabi.ai',
 * }));
 * ```
 */
export function x402Middleware(config: X402MiddlewareConfig): RequestHandler {
  const {
    recipientAddress,
    amount,
    tokenAddress = BASE_USDC.address as `0x${string}`,
    settlementAddress,
    treasuryAddress,
    feeBps = DEFAULT_FEE_BPS,
    facilitatorUrl,
    description,
    networkId = BASE_CAIP_ID,
    deadlineDuration = 300,
    acceptedSchemes = ['permit2'],
    excludeRoutes = [],
    onError,
  } = config;

  // Validate chainId at initialization
  extractChainId(networkId);

  return async (req: X402Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if route is excluded
      const path = req.path;
      if (excludeRoutes.some(route => path.startsWith(route))) {
        next();
        return;
      }

      // Check for x-payment header
      const paymentHeader = req.headers[X402_HEADERS.PAYMENT];

      // If no payment, return 402 with payment requirement
      if (!paymentHeader) {
        const requirement = buildPaymentRequirement({
          recipientAddress,
          amount,
          tokenAddress,
          settlementAddress,
          treasuryAddress,
          feeBps,
          networkId,
          deadlineDuration,
          acceptedSchemes,
          description,
          resource: req.originalUrl,
        });

        res.status(402);
        res.setHeader(X402_HEADERS.PAYMENT_REQUIRED, JSON.stringify(requirement));
        res.json({
          error: 'Payment Required',
          requirement,
        });
        return;
      }

      // Parse the payment payload from x-payment header
      let payload: PaymentPayload;
      try {
        const parsed = JSON.parse(
          typeof paymentHeader === 'string' ? paymentHeader : String(paymentHeader)
        );
        const result = PaymentPayloadSchema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Invalid payload: ${result.error.message}`);
        }
        payload = result.data;
      } catch (error) {
        res.status(400).json({
          error: 'Invalid Payment',
          message: error instanceof Error ? error.message : 'Failed to parse payment payload',
        });
        return;
      }

      // Basic validation: network must match
      if (payload.network !== networkId) {
        res.status(400).json({
          error: 'Network Mismatch',
          message: `Expected ${networkId}, got ${payload.network}`,
        });
        return;
      }

      // Validate deadline hasn't passed
      const now = Math.floor(Date.now() / 1000);
      if (payload.scheme === 'permit2') {
        if (payload.permit.deadline < now) {
          res.status(400).json({
            error: 'Payment Expired',
            message: `Payment deadline has passed`,
          });
          return;
        }
      } else if (payload.scheme === 'erc3009') {
        if (payload.authorization.validBefore < now) {
          res.status(400).json({
            error: 'Payment Expired',
            message: `Authorization validity has passed`,
          });
          return;
        }
      }

      // Validate amount covers the required amount
      if (payload.scheme === 'permit2') {
        const totalPermitted = BigInt(payload.permit.permitted[0]!.amount) +
          BigInt(payload.permit.permitted[1]!.amount);
        if (totalPermitted < BigInt(amount)) {
          res.status(402).json({
            error: 'Insufficient Payment',
            message: `Expected at least ${amount}, got ${totalPermitted.toString()}`,
          });
          return;
        }
      } else if (payload.scheme === 'erc3009') {
        if (BigInt(payload.authorization.value) < BigInt(amount)) {
          res.status(402).json({
            error: 'Insufficient Payment',
            message: `Expected at least ${amount}, got ${payload.authorization.value}`,
          });
          return;
        }
      }

      // Replay protection: use a unique nonce from the payload
      const payloadNonce = payload.scheme === 'permit2'
        ? payload.permit.nonce
        : payload.authorization.nonce;
      if (!nonceRegistry.claim(payloadNonce)) {
        res.status(402).json({
          error: 'Replay Detected',
          message: 'This payment nonce has already been used',
        });
        return;
      }

      // Resolve facilitator config: `facilitator` takes precedence over `facilitatorUrl`
      const resolvedFacilitator: FacilitatorEndpointConfig | null =
        config.facilitator ?? (facilitatorUrl ? { url: facilitatorUrl } : null);

      // Forward to facilitator for on-chain settlement
      if (resolvedFacilitator) {
        const settlementResult = await settleWithFacilitator(payload, resolvedFacilitator);

        if (!settlementResult.success) {
          res.status(402).json({
            error: 'Settlement Failed',
            message: 'On-chain settlement failed',
          });
          return;
        }

        // Attach to request and return settlement info in response header
        req.x402 = {
          payment: payload,
          verified: true,
          signer: payload.payer as Address,
          settlementResult,
        };

        res.setHeader(
          X402_HEADERS.PAYMENT_RESPONSE,
          JSON.stringify(settlementResult)
        );
      } else {
        // No facilitator — attach payment info but don't settle on-chain
        req.x402 = {
          payment: payload,
          verified: true,
          signer: payload.payer as Address,
        };
      }

      next();
    } catch (error) {
      if (onError && error instanceof Error) {
        onError(error, req, res);
        return;
      }

      console.error('[x402] Middleware error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Payment processing failed',
      });
    }
  };
}

// ============================================================================
// Facilitator Settlement
// ============================================================================

async function settleWithFacilitator(
  payload: PaymentPayload,
  facilitator: FacilitatorEndpointConfig
): Promise<PaymentResponse> {
  try {
    const authHeaders = facilitator.createAuthHeaders
      ? await facilitator.createAuthHeaders()
      : {};

    const response = await axios.post<PaymentResponse>(
      `${facilitator.url}/x402/settle`,
      payload,
      {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      }
    );

    return response.data;
  } catch (error) {
    return {
      success: false,
      network: payload.network,
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Build a payment requirement with accepts array
 */
function buildPaymentRequirement(params: {
  recipientAddress: `0x${string}`;
  amount: string;
  tokenAddress: `0x${string}`;
  settlementAddress: `0x${string}`;
  treasuryAddress: `0x${string}`;
  feeBps: number;
  networkId: string;
  deadlineDuration: number;
  acceptedSchemes: PaymentScheme[];
  description?: string;
  resource?: string;
}): PaymentRequirement {
  const maxDeadline = calculateDeadline(params.deadlineDuration);

  const accepts = params.acceptedSchemes.map(scheme => ({
    scheme,
    network: params.networkId,
    token: params.tokenAddress as string,
    amount: params.amount,
    recipient: params.recipientAddress as string,
    settlement: params.settlementAddress as string,
    treasury: params.treasuryAddress as string,
    feeBps: params.feeBps,
    maxDeadline,
  }));

  return {
    x402Version: X402_VERSION,
    accepts,
    description: params.description,
    resource: params.resource,
  };
}

/**
 * Create a payment requirement object for manual 402 responses
 */
export function createPaymentRequirement(
  config: Pick<X402MiddlewareConfig,
    'recipientAddress' | 'amount' | 'tokenAddress' | 'settlementAddress' |
    'treasuryAddress' | 'feeBps' | 'description' | 'networkId' | 'acceptedSchemes'
  > & {
    resource?: string;
    deadlineDuration?: number;
  }
): PaymentRequirement {
  return buildPaymentRequirement({
    recipientAddress: config.recipientAddress,
    amount: config.amount,
    tokenAddress: config.tokenAddress ?? BASE_USDC.address as `0x${string}`,
    settlementAddress: config.settlementAddress,
    treasuryAddress: config.treasuryAddress,
    feeBps: config.feeBps ?? DEFAULT_FEE_BPS,
    networkId: config.networkId ?? BASE_CAIP_ID,
    deadlineDuration: config.deadlineDuration ?? 300,
    acceptedSchemes: config.acceptedSchemes ?? ['permit2'],
    description: config.description,
    resource: config.resource,
  });
}

/**
 * Parse payment from request headers
 */
export function parsePaymentFromRequest(req: Request): PaymentPayload | null {
  try {
    const paymentHeader = req.headers[X402_HEADERS.PAYMENT];
    if (!paymentHeader) return null;

    const parsed = JSON.parse(
      typeof paymentHeader === 'string' ? paymentHeader : String(paymentHeader)
    );

    const result = PaymentPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
  type X402MiddlewareConfig,
  type PaymentRequirement,
  type PaymentPayload,
  type PaymentResponse,
  type PaymentVerificationResult,
  type FacilitatorEndpointConfig,
  type CreateAuthHeaders,
  createFacilitatorEndpointConfig,
  X402_HEADERS,
  PaymentVerificationError,
  PaymentExpiredError,
} from '../types/index.js';

export {
  BASE_CAIP_ID,
  BASE_CHAIN_ID,
  BASE_USDC,
  BASE_TOKENS,
} from '../chains/base.js';
