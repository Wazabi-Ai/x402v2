import type { Request, Response, NextFunction, RequestHandler } from 'express';
import axios from 'axios';
import {
  verifyTypedData,
  type Address,
} from 'viem';

import {
  type PaymentRequirement,
  type PaymentPayload,
  type SignedPayment,
  type X402MiddlewareConfig,
  type PaymentVerificationResult,
  type FacilitatorVerifyRequest,
  type FacilitatorVerifyResponse,
  SignedPaymentSchema,
  PaymentPayloadSchema,
  X402_HEADERS,
  X402_DOMAIN_NAME,
  X402_VERSION,
  PAYMENT_TYPES,
  generateNonce,
  calculateDeadline,
  extractChainId,
} from '../types/index.js';
import {
  BSC_CAIP_ID,
  BSC_USDT,
} from '../chains/bnb.js';

// ============================================================================
// Nonce Registry (replay protection)
// ============================================================================

/**
 * In-memory nonce registry that prevents replay attacks by tracking used
 * nonces. Entries are automatically evicted after `ttlMs` (default: 10 min).
 *
 * For production at scale, replace with a Redis SET + TTL.
 */
class NonceRegistry {
  private readonly used = new Map<string, number>(); // nonce -> expiry timestamp (ms)
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** Returns false if the nonce was already seen (replay). */
  claim(nonce: string): boolean {
    this.lazyStartSweep();
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, Date.now() + this.ttlMs);
    return true;
  }

  /** Lazily start the cleanup interval (avoids timer in tests that don't need it). */
  private lazyStartSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [nonce, expiry] of this.used) {
        if (expiry < now) this.used.delete(nonce);
      }
    }, 60_000);
    // Allow Node.js to exit even if the timer is running
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }
}

const nonceRegistry = new NonceRegistry();

// ============================================================================
// Types
// ============================================================================

/**
 * Extended Express Request with payment information
 */
export interface X402Request extends Request {
  x402?: {
    payment: SignedPayment;
    verified: boolean;
    signer: Address;
  };
}

// ============================================================================
// Payment Verification
// ============================================================================

/**
 * Verify an EIP-712 payment signature locally using viem
 */
async function verifyPaymentSignatureLocal(
  payment: SignedPayment,
  expectedRecipient: Address,
  chainId: number
): Promise<PaymentVerificationResult> {
  try {
    const { payload, signature, signer } = payment;

    // Check deadline
    const now = Math.floor(Date.now() / 1000);
    if (payload.deadline < now) {
      return {
        valid: false,
        error: `Payment expired at ${new Date(payload.deadline * 1000).toISOString()}`,
      };
    }

    // Check chain ID matches
    if (payload.chainId !== chainId) {
      return {
        valid: false,
        error: `Chain ID mismatch: expected ${chainId}, got ${payload.chainId}`,
      };
    }

    // Check recipient matches
    if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
      return {
        valid: false,
        error: `Recipient mismatch: expected ${expectedRecipient}, got ${payload.payTo}`,
      };
    }

    // Create domain for verification
    const domain = {
      name: X402_DOMAIN_NAME,
      version: X402_VERSION,
      chainId,
    };

    // Verify the typed data signature
    const isValid = await verifyTypedData({
      address: signer as Address,
      domain,
      types: PAYMENT_TYPES,
      primaryType: 'Payment',
      message: {
        amount: BigInt(payload.amount),
        token: payload.token as Address,
        chainId: BigInt(payload.chainId),
        payTo: payload.payTo as Address,
        payer: payload.payer as Address,
        deadline: BigInt(payload.deadline),
        nonce: payload.nonce,
        resource: payload.resource ?? '',
      },
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return {
        valid: false,
        error: 'Signature verification failed',
      };
    }

    return {
      valid: true,
      signer: signer as Address,
      payload,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Verify payment through external facilitator service
 */
async function verifyPaymentWithFacilitator(
  payment: SignedPayment,
  facilitatorUrl: string,
  networkId: string
): Promise<PaymentVerificationResult> {
  try {
    const request: FacilitatorVerifyRequest = {
      signature: payment.signature,
      payload: payment.payload,
      networkId,
    };

    const response = await axios.post<FacilitatorVerifyResponse>(
      `${facilitatorUrl}/verify`,
      request,
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.data.valid) {
      return {
        valid: true,
        signer: response.data.signer as Address,
        payload: payment.payload,
      };
    }

    return {
      valid: false,
      error: response.data.error ?? 'Facilitator rejected payment',
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error 
        ? `Facilitator error: ${error.message}` 
        : 'Facilitator verification failed',
    };
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create x402 payment middleware for Express
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { x402Middleware } from '@wazabiai/x402/server';
 * 
 * const app = express();
 * 
 * // Protect routes with payment requirement
 * app.use('/api/paid', x402Middleware({
 *   recipientAddress: '0x...',
 *   amount: '1000000000000000000', // 1 token
 * }));
 * 
 * app.get('/api/paid/resource', (req, res) => {
 *   // Payment verified, serve resource
 *   res.json({ data: 'premium content' });
 * });
 * ```
 */
export function x402Middleware(config: X402MiddlewareConfig): RequestHandler {
  const {
    recipientAddress,
    amount,
    tokenAddress = BSC_USDT.address,
    facilitatorUrl,
    description,
    networkId = BSC_CAIP_ID,
    deadlineDuration = 300,
    nonceGenerator = generateNonce,
    verifyPayment: customVerify,
    excludeRoutes = [],
    onError,
  } = config;

  const chainId = extractChainId(networkId);

  return async (req: X402Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if route is excluded
      const path = req.path;
      if (excludeRoutes.some(route => path.startsWith(route))) {
        next();
        return;
      }

      // Get payment signature header
      const signatureHeader = req.headers[X402_HEADERS.PAYMENT_SIGNATURE];
      const payloadHeader = req.headers[X402_HEADERS.PAYMENT_PAYLOAD];

      // If no payment signature, return 402
      if (!signatureHeader) {
        const requirement: PaymentRequirement = {
          amount,
          token: tokenAddress,
          network_id: networkId,
          pay_to: recipientAddress,
          description,
          resource: req.originalUrl,
          expires_at: calculateDeadline(deadlineDuration),
          nonce: nonceGenerator(),
          version: X402_VERSION,
        };

        res.status(402);
        res.setHeader(X402_HEADERS.PAYMENT_REQUIRED, JSON.stringify(requirement));
        res.json({
          error: 'Payment Required',
          requirement,
        });
        return;
      }

      // Parse the payment payload
      let payload: PaymentPayload;
      try {
        if (!payloadHeader) {
          throw new Error('Missing payment payload header');
        }
        const parsedPayload = JSON.parse(
          typeof payloadHeader === 'string' ? payloadHeader : String(payloadHeader)
        );
        const result = PaymentPayloadSchema.safeParse(parsedPayload);
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

      // Construct signed payment
      const signedPayment: SignedPayment = {
        payload,
        signature: (typeof signatureHeader === 'string' 
          ? signatureHeader 
          : String(signatureHeader)) as `0x${string}`,
        signer: payload.payer as `0x${string}`,
      };

      // Verify the payment
      let verificationResult: PaymentVerificationResult;

      if (facilitatorUrl) {
        // Use external facilitator
        verificationResult = await verifyPaymentWithFacilitator(
          signedPayment,
          facilitatorUrl,
          networkId
        );
      } else {
        // Local verification
        verificationResult = await verifyPaymentSignatureLocal(
          signedPayment,
          recipientAddress,
          chainId
        );
      }

      if (!verificationResult.valid) {
        res.status(402).json({
          error: 'Payment Verification Failed',
          message: verificationResult.error,
        });
        return;
      }

      // Run custom verification if provided
      if (customVerify) {
        const customValid = await customVerify(signedPayment, req);
        if (!customValid) {
          res.status(402).json({
            error: 'Payment Rejected',
            message: 'Custom verification failed',
          });
          return;
        }
      }

      // Replay protection: ensure this nonce hasn't been used before
      if (!nonceRegistry.claim(payload.nonce)) {
        res.status(402).json({
          error: 'Replay Detected',
          message: 'This payment nonce has already been used',
        });
        return;
      }

      // Check amount matches
      if (BigInt(payload.amount) < BigInt(amount)) {
        res.status(402).json({
          error: 'Insufficient Payment',
          message: `Expected ${amount}, received ${payload.amount}`,
        });
        return;
      }

      // Attach payment info to request
      req.x402 = {
        payment: signedPayment,
        verified: true,
        signer: verificationResult.signer!,
      };

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
// Utility Functions
// ============================================================================

/**
 * Create a payment requirement object for manual 402 responses
 */
export function createPaymentRequirement(
  config: Pick<X402MiddlewareConfig, 
    'recipientAddress' | 'amount' | 'tokenAddress' | 'description' | 'networkId'
  > & {
    resource?: string;
    deadline?: number;
    nonce?: string;
  }
): PaymentRequirement {
  const {
    recipientAddress,
    amount,
    tokenAddress = BSC_USDT.address,
    description,
    networkId = BSC_CAIP_ID,
    resource,
    deadline,
    nonce,
  } = config;

  return {
    amount,
    token: tokenAddress,
    network_id: networkId,
    pay_to: recipientAddress,
    description,
    resource,
    expires_at: deadline ?? calculateDeadline(300),
    nonce: nonce ?? generateNonce(),
    version: X402_VERSION,
  };
}

/**
 * Verify a signed payment independently (not as middleware)
 */
export async function verifyPayment(
  payment: SignedPayment,
  recipientAddress: Address,
  networkId: string = BSC_CAIP_ID,
  facilitatorUrl?: string
): Promise<PaymentVerificationResult> {
  const chainId = extractChainId(networkId);

  if (facilitatorUrl) {
    return verifyPaymentWithFacilitator(payment, facilitatorUrl, networkId);
  }

  return verifyPaymentSignatureLocal(payment, recipientAddress, chainId);
}

/**
 * Parse payment from request headers
 */
export function parsePaymentFromRequest(req: Request): SignedPayment | null {
  try {
    const signatureHeader = req.headers[X402_HEADERS.PAYMENT_SIGNATURE];
    const payloadHeader = req.headers[X402_HEADERS.PAYMENT_PAYLOAD];

    if (!signatureHeader || !payloadHeader) {
      return null;
    }

    const payload = JSON.parse(
      typeof payloadHeader === 'string' ? payloadHeader : String(payloadHeader)
    );

    const result = SignedPaymentSchema.safeParse({
      payload,
      signature: typeof signatureHeader === 'string' 
        ? signatureHeader 
        : String(signatureHeader),
      signer: payload.payer,
    });

    return result.success ? result.data as SignedPayment : null;
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
  type SignedPayment,
  type PaymentVerificationResult,
  X402_HEADERS,
  PaymentVerificationError,
  PaymentExpiredError,
} from '../types/index.js';

export {
  BSC_CAIP_ID,
  BSC_CHAIN_ID,
  BSC_USDT,
  BSC_USDC,
  BSC_TOKENS,
  formatTokenAmount,
  parseTokenAmount,
} from '../chains/bnb.js';
