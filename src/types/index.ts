import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * x402 Protocol Version
 */
export const X402_VERSION = '2.0.0' as const;

/**
 * EIP-712 Domain name for x402 protocol
 */
export const X402_DOMAIN_NAME = 'x402' as const;

/**
 * HTTP Header names used in x402 protocol
 */
export const X402_HEADERS = {
  PAYMENT_REQUIRED: 'x-payment-required',
  PAYMENT_SIGNATURE: 'x-payment-signature',
  PAYMENT_PAYLOAD: 'x-payment-payload',
} as const;

// ============================================================================
// Network Configuration Types
// ============================================================================

/**
 * Supported token symbol types
 */
export type TokenSymbol = 'USDT' | 'USDC' | 'BNB' | 'BUSD';

/**
 * Token configuration for a specific blockchain
 */
export interface TokenConfig {
  /** Token contract address (0x...) */
  address: `0x${string}`;
  /** Token symbol */
  symbol: TokenSymbol;
  /** Token decimals (typically 18 for most tokens) */
  decimals: number;
  /** Human-readable token name */
  name: string;
}

/**
 * Network configuration for a specific blockchain
 */
export interface NetworkConfig {
  /** CAIP-2 chain identifier (e.g., 'eip155:56' for BSC) */
  caipId: string;
  /** Numeric chain ID */
  chainId: number;
  /** Human-readable network name */
  name: string;
  /** Default RPC URL */
  rpcUrl: string;
  /** Native currency symbol */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Block explorer URL */
  blockExplorer: string;
  /** Supported tokens on this network */
  tokens: Record<string, TokenConfig>;
}

// ============================================================================
// Payment Requirement Types
// ============================================================================

/**
 * Zod schema for PaymentRequirement validation
 */
export const PaymentRequirementSchema = z.object({
  /** Payment amount in smallest token unit (wei/satoshi) as string */
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
  /** Token contract address */
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  /** CAIP-2 network identifier */
  network_id: z.string().regex(/^eip155:\d+$/, 'Invalid CAIP-2 network ID'),
  /** Recipient address for payment */
  pay_to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid recipient address'),
  /** Optional: Payment description */
  description: z.string().optional(),
  /** Optional: Resource identifier being accessed */
  resource: z.string().optional(),
  /** Optional: Expiration timestamp (Unix epoch seconds) */
  expires_at: z.number().int().positive().optional(),
  /** Optional: Unique nonce to prevent replay attacks */
  nonce: z.string().optional(),
  /** Protocol version */
  version: z.string().optional(),
});

/**
 * Payment requirement structure returned in 402 response header
 */
export type PaymentRequirement = z.infer<typeof PaymentRequirementSchema>;

// ============================================================================
// EIP-712 Payment Payload Types
// ============================================================================

/**
 * EIP-712 Domain structure for x402 protocol
 */
export interface X402Domain {
  name: typeof X402_DOMAIN_NAME;
  version: string;
  chainId: number;
  verifyingContract?: `0x${string}`;
}

/**
 * Zod schema for PaymentPayload validation
 */
export const PaymentPayloadSchema = z.object({
  /** Payment amount in smallest token unit */
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
  /** Token contract address */
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  /** Chain ID (numeric) */
  chainId: z.number().int().positive(),
  /** Recipient address */
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid recipient address'),
  /** Payer address (signer) */
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid payer address'),
  /** Unix timestamp when payment expires */
  deadline: z.number().int().positive(),
  /** Unique nonce to prevent replay attacks */
  nonce: z.string(),
  /** Optional: Resource being accessed */
  resource: z.string().optional(),
});

/**
 * EIP-712 typed data payload for signing
 */
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

/**
 * EIP-712 type definitions for Payment message
 */
export const PAYMENT_TYPES = {
  Payment: [
    { name: 'amount', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'payTo', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'resource', type: 'string' },
  ],
} as const;

// ============================================================================
// Signed Payment Types
// ============================================================================

/**
 * Complete signed payment ready to be sent as header
 */
export interface SignedPayment {
  /** The payment payload that was signed */
  payload: PaymentPayload;
  /** EIP-712 signature (0x prefixed) */
  signature: `0x${string}`;
  /** Address of the signer */
  signer: `0x${string}`;
}

/**
 * Zod schema for SignedPayment validation
 */
export const SignedPaymentSchema = z.object({
  payload: PaymentPayloadSchema,
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format'),
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid signer address'),
});

// ============================================================================
// Client Configuration Types
// ============================================================================

/**
 * Configuration options for X402Client
 */
export interface X402ClientConfig {
  /** Private key for signing (hex string with or without 0x prefix) */
  privateKey?: string;
  /** Custom RPC URL to use instead of default */
  rpcUrl?: string;
  /** Supported network IDs (defaults to ['eip155:56']) */
  supportedNetworks?: string[];
  /** Default deadline duration in seconds (default: 300 = 5 minutes) */
  defaultDeadline?: number;
  /** Auto-retry on 402 response (default: true) */
  autoRetry?: boolean;
  /** Maximum retries for payment (default: 1) */
  maxRetries?: number;
  /** Custom axios instance configuration */
  axiosConfig?: Record<string, unknown>;
  /** Callback when payment is required */
  onPaymentRequired?: (requirement: PaymentRequirement) => void | Promise<void>;
  /** Callback when payment is signed */
  onPaymentSigned?: (payment: SignedPayment) => void | Promise<void>;
}

// ============================================================================
// Server/Middleware Configuration Types
// ============================================================================

/**
 * Payment verification result
 */
export interface PaymentVerificationResult {
  /** Whether the payment signature is valid */
  valid: boolean;
  /** Recovered signer address if valid */
  signer?: `0x${string}`;
  /** Error message if invalid */
  error?: string;
  /** The verified payment payload */
  payload?: PaymentPayload;
}

/**
 * Facilitator verification request
 */
export interface FacilitatorVerifyRequest {
  signature: string;
  payload: PaymentPayload;
  networkId: string;
}

/**
 * Facilitator verification response
 */
export interface FacilitatorVerifyResponse {
  valid: boolean;
  signer?: string;
  error?: string;
  balanceSufficient?: boolean;
  allowanceSufficient?: boolean;
}

/**
 * Configuration options for x402 server middleware
 */
export interface X402MiddlewareConfig {
  /** Recipient address for payments */
  recipientAddress: `0x${string}`;
  /** Payment amount in smallest token unit */
  amount: string;
  /** Token contract address (defaults to BSC-USDT) */
  tokenAddress?: `0x${string}`;
  /** Optional facilitator URL for offloading verification */
  facilitatorUrl?: string;
  /** Custom payment description */
  description?: string;
  /** Network ID (defaults to 'eip155:56') */
  networkId?: string;
  /** Deadline duration in seconds (default: 300) */
  deadlineDuration?: number;
  /** Custom nonce generator */
  nonceGenerator?: () => string;
  /** Callback to verify payment against custom logic (e.g., database) */
  verifyPayment?: (payment: SignedPayment, req: unknown) => Promise<boolean>;
  /** Routes to exclude from payment requirement */
  excludeRoutes?: string[];
  /** Custom error handler */
  onError?: (error: Error, req: unknown, res: unknown) => void;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for x402 protocol errors
 */
export class X402Error extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'X402Error';
    Object.setPrototypeOf(this, X402Error.prototype);
  }
}

/**
 * Error thrown when payment is required but not provided
 */
export class PaymentRequiredError extends X402Error {
  constructor(
    public requirement: PaymentRequirement,
    message = 'Payment required'
  ) {
    super(message, 'PAYMENT_REQUIRED', { requirement });
    this.name = 'PaymentRequiredError';
    Object.setPrototypeOf(this, PaymentRequiredError.prototype);
  }
}

/**
 * Error thrown when payment signature verification fails
 */
export class PaymentVerificationError extends X402Error {
  constructor(
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message, 'PAYMENT_VERIFICATION_FAILED', details);
    this.name = 'PaymentVerificationError';
    Object.setPrototypeOf(this, PaymentVerificationError.prototype);
  }
}

/**
 * Error thrown when network is not supported
 */
export class UnsupportedNetworkError extends X402Error {
  constructor(
    networkId: string,
    supportedNetworks: string[]
  ) {
    super(
      `Network ${networkId} is not supported. Supported networks: ${supportedNetworks.join(', ')}`,
      'UNSUPPORTED_NETWORK',
      { networkId, supportedNetworks }
    );
    this.name = 'UnsupportedNetworkError';
    Object.setPrototypeOf(this, UnsupportedNetworkError.prototype);
  }
}

/**
 * Error thrown when payment has expired
 */
export class PaymentExpiredError extends X402Error {
  constructor(deadline: number) {
    super(
      `Payment has expired. Deadline: ${new Date(deadline * 1000).toISOString()}`,
      'PAYMENT_EXPIRED',
      { deadline }
    );
    this.name = 'PaymentExpiredError';
    Object.setPrototypeOf(this, PaymentExpiredError.prototype);
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Hex string type (0x prefixed)
 */
export type HexString = `0x${string}`;

/**
 * Address type (0x prefixed, 40 hex chars)
 */
export type Address = `0x${string}`;

/**
 * Extract chain ID from CAIP-2 identifier
 */
export function extractChainId(caipId: string): number {
  const match = caipId.match(/^eip155:(\d+)$/);
  if (!match?.[1]) {
    throw new X402Error(`Invalid CAIP-2 identifier: ${caipId}`, 'INVALID_CAIP_ID');
  }
  return parseInt(match[1], 10);
}

/**
 * Create CAIP-2 identifier from chain ID
 */
export function createCaipId(chainId: number): string {
  return `eip155:${chainId}`;
}

/**
 * Generate a random nonce
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for Node.js without Web Crypto
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Calculate deadline from duration
 */
export function calculateDeadline(durationSeconds: number = 300): number {
  return Math.floor(Date.now() / 1000) + durationSeconds;
}
