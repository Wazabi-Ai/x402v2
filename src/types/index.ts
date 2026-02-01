import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const X402_VERSION = '2.0.0' as const;

/** Canonical Permit2 contract address (same on all EVM chains) */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

/** HTTP header names used in x402 protocol */
export const X402_HEADERS = {
  /** Server → Client: payment requirement (in 402 response) */
  PAYMENT_REQUIRED: 'x-payment-required',
  /** Client → Server: signed payment (in retry request) */
  PAYMENT: 'x-payment',
  /** Server → Client: settlement result (in 200 response) */
  PAYMENT_RESPONSE: 'x-payment-response',
} as const;

/** Payment scheme identifiers */
export type PaymentScheme = 'permit2' | 'erc3009';

/** Default protocol fee in basis points (50 = 0.5%) */
export const DEFAULT_FEE_BPS = 50;

// ============================================================================
// Network Configuration Types
// ============================================================================

export type TokenSymbol = 'USDT' | 'USDC' | 'BNB' | 'WETH' | 'ETH';

export interface TokenConfig {
  address: `0x${string}`;
  symbol: TokenSymbol;
  decimals: number;
  name: string;
  /** Whether the token supports ERC-3009 transferWithAuthorization */
  supportsERC3009?: boolean;
}

export interface NetworkConfig {
  caipId: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  tokens: Record<string, TokenConfig>;
}

// ============================================================================
// Payment Requirement (Server → Client in 402 response)
// ============================================================================

export const PaymentRequirementSchema = z.object({
  /** x402 protocol version */
  x402Version: z.string().default(X402_VERSION),
  /** Accepted payment schemes */
  accepts: z.array(z.object({
    /** Payment scheme: 'permit2' for any ERC-20, 'erc3009' for USDC */
    scheme: z.enum(['permit2', 'erc3009']),
    /** CAIP-2 network identifier (e.g., 'eip155:8453') */
    network: z.string().regex(/^eip155:\d+$/),
    /** Token contract address */
    token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    /** Gross payment amount in smallest token unit */
    amount: z.string().regex(/^\d+$/),
    /** Payment recipient address */
    recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    /** WazabiSettlement contract address */
    settlement: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    /** Treasury address for fee collection */
    treasury: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    /** Fee rate in basis points (e.g., 50 = 0.5%) */
    feeBps: z.number().int().min(0).max(1000),
    /** Maximum deadline timestamp (Unix seconds) */
    maxDeadline: z.number().int().positive(),
  })),
  /** Optional: description of the resource being purchased */
  description: z.string().optional(),
  /** Optional: resource path being accessed */
  resource: z.string().optional(),
});

export type PaymentRequirement = z.infer<typeof PaymentRequirementSchema>;

// ============================================================================
// Permit2 EIP-712 Types (for client signing)
// ============================================================================

/** EIP-712 domain for Permit2 contract */
export function getPermit2Domain(chainId: number) {
  return {
    name: 'Permit2',
    chainId,
    verifyingContract: PERMIT2_ADDRESS as `0x${string}`,
  } as const;
}

/** EIP-712 types for PermitBatchWitnessTransferFrom with SettlementWitness */
export const PERMIT2_BATCH_WITNESS_TYPES = {
  PermitBatchWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'SettlementWitness' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  SettlementWitness: [
    { name: 'recipient', type: 'address' },
    { name: 'feeBps', type: 'uint256' },
  ],
} as const;

/** Settlement witness struct (committed in payer's signature) */
export interface SettlementWitness {
  recipient: `0x${string}`;
  feeBps: number;
}

// ============================================================================
// ERC-3009 Types (for USDC transferWithAuthorization)
// ============================================================================

/** EIP-712 domain for ERC-3009 (token-specific) */
export function getERC3009Domain(tokenAddress: `0x${string}`, tokenName: string, chainId: number) {
  return {
    name: tokenName,
    version: '2',
    chainId,
    verifyingContract: tokenAddress,
  };
}

/** EIP-712 types for ERC-3009 TransferWithAuthorization */
export const ERC3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// ============================================================================
// Signed Payment (Client → Server in X-PAYMENT header)
// ============================================================================

/** Permit2 signed payment payload */
export const Permit2PayloadSchema = z.object({
  scheme: z.literal('permit2'),
  network: z.string().regex(/^eip155:\d+$/),
  /** Permit2 batch authorization parameters */
  permit: z.object({
    permitted: z.array(z.object({
      token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amount: z.string().regex(/^\d+$/),
    })).length(2),
    nonce: z.string().regex(/^\d+$/),
    deadline: z.number().int().positive(),
  }),
  /** Settlement witness (recipient + feeBps) */
  witness: z.object({
    recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    feeBps: z.number().int().min(0).max(1000),
  }),
  /** WazabiSettlement contract (the Permit2 spender) */
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Payer address (signer) */
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** EIP-712 signature */
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type Permit2Payload = z.infer<typeof Permit2PayloadSchema>;

/** ERC-3009 signed payment payload */
export const ERC3009PayloadSchema = z.object({
  scheme: z.literal('erc3009'),
  network: z.string().regex(/^eip155:\d+$/),
  /** ERC-3009 authorization parameters */
  authorization: z.object({
    from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string().regex(/^\d+$/),
    validAfter: z.number().int().min(0),
    validBefore: z.number().int().positive(),
    nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
  /** Actual intended recipient (contract splits to recipient + treasury) */
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Payer address (signer) */
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** EIP-712 signature (r + s + v packed) */
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type ERC3009Payload = z.infer<typeof ERC3009PayloadSchema>;

/** Union of all payment payloads */
export const PaymentPayloadSchema = z.discriminatedUnion('scheme', [
  Permit2PayloadSchema,
  ERC3009PayloadSchema,
]);

export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

// ============================================================================
// Payment Response (Server → Client in X-PAYMENT-RESPONSE header)
// ============================================================================

export interface PaymentResponse {
  success: boolean;
  txHash?: string;
  network?: string;
  settlementId?: string;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface X402ClientConfig {
  /** Private key for signing (hex with or without 0x prefix) */
  privateKey?: string;
  /** Custom RPC URL */
  rpcUrl?: string;
  /** Supported network IDs (defaults to ['eip155:8453']) */
  supportedNetworks?: string[];
  /** Default deadline duration in seconds (default: 300) */
  defaultDeadline?: number;
  /** Auto-retry on 402 response (default: true) */
  autoRetry?: boolean;
  /** Maximum retries (default: 1) */
  maxRetries?: number;
  /** Auto-approve Permit2 when allowance is insufficient (default: true) */
  autoApprovePermit2?: boolean;
  /** Custom axios instance configuration */
  axiosConfig?: Record<string, unknown>;
  /** Callback when payment is required */
  onPaymentRequired?: (requirement: PaymentRequirement) => void | Promise<void>;
  /** Callback when payment is signed */
  onPaymentSigned?: (payment: PaymentPayload) => void | Promise<void>;
  /** Callback when Permit2 approval is needed (before sending tx) */
  onPermit2ApprovalNeeded?: (token: string, permit2Address: string) => void | Promise<void>;
}

// ============================================================================
// Server/Middleware Configuration
// ============================================================================

export interface PaymentVerificationResult {
  valid: boolean;
  signer?: `0x${string}`;
  error?: string;
  payload?: PaymentPayload;
}

export interface X402MiddlewareConfig {
  /** Payment recipient address */
  recipientAddress: `0x${string}`;
  /** Gross payment amount in smallest token unit */
  amount: string;
  /** Token contract address */
  tokenAddress: `0x${string}`;
  /** WazabiSettlement contract address */
  settlementAddress: `0x${string}`;
  /** Treasury address for fee collection */
  treasuryAddress: `0x${string}`;
  /** Fee rate in basis points (default: 50 = 0.5%) */
  feeBps?: number;
  /** Facilitator URL for settlement */
  facilitatorUrl?: string;
  /** Description of the paid resource */
  description?: string;
  /** CAIP-2 network ID (default: 'eip155:8453') */
  networkId?: string;
  /** Deadline duration in seconds (default: 300) */
  deadlineDuration?: number;
  /** Accepted schemes (default: ['permit2']) */
  acceptedSchemes?: PaymentScheme[];
  /** Routes excluded from payment */
  excludeRoutes?: string[];
  /** Custom error handler */
  onError?: (error: Error, req: unknown, res: unknown) => void;
}

// ============================================================================
// Error Types
// ============================================================================

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

export class PaymentVerificationError extends X402Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message, 'PAYMENT_VERIFICATION_FAILED', details);
    this.name = 'PaymentVerificationError';
    Object.setPrototypeOf(this, PaymentVerificationError.prototype);
  }
}

export class UnsupportedNetworkError extends X402Error {
  constructor(networkId: string, supportedNetworks: string[]) {
    super(
      `Network ${networkId} is not supported. Supported: ${supportedNetworks.join(', ')}`,
      'UNSUPPORTED_NETWORK',
      { networkId, supportedNetworks }
    );
    this.name = 'UnsupportedNetworkError';
    Object.setPrototypeOf(this, UnsupportedNetworkError.prototype);
  }
}

export class Permit2ApprovalRequiredError extends X402Error {
  constructor(token: string, permit2Address: string) {
    super(
      `Permit2 approval required. Call ${token}.approve(${permit2Address}, MAX_UINT256) first.`,
      'PERMIT2_APPROVAL_REQUIRED',
      { token, permit2Address }
    );
    this.name = 'Permit2ApprovalRequiredError';
    Object.setPrototypeOf(this, Permit2ApprovalRequiredError.prototype);
  }
}

export class PaymentExpiredError extends X402Error {
  constructor(deadline: number) {
    super(
      `Payment expired. Deadline: ${new Date(deadline * 1000).toISOString()}`,
      'PAYMENT_EXPIRED',
      { deadline }
    );
    this.name = 'PaymentExpiredError';
    Object.setPrototypeOf(this, PaymentExpiredError.prototype);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function extractChainId(caipId: string): number {
  const match = caipId.match(/^eip155:(\d+)$/);
  if (!match?.[1]) {
    throw new X402Error(`Invalid CAIP-2 identifier: ${caipId}`, 'INVALID_CAIP_ID');
  }
  return parseInt(match[1], 10);
}

export function createCaipId(chainId: number): string {
  return `eip155:${chainId}`;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    const buf = nodeCrypto.randomBytes(32);
    bytes.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a random bytes32 nonce for ERC-3009 */
export function generateBytes32Nonce(): `0x${string}` {
  return `0x${generateNonce()}` as `0x${string}`;
}

/** Generate a random uint256 nonce for Permit2 */
export function generatePermit2Nonce(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    const buf = nodeCrypto.randomBytes(32);
    bytes.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
  // Convert to decimal string (Permit2 nonces are uint256)
  let result = BigInt(0);
  for (const b of bytes) {
    result = (result << BigInt(8)) | BigInt(b);
  }
  return result.toString();
}

export function calculateDeadline(durationSeconds: number = 300): number {
  return Math.floor(Date.now() / 1000) + durationSeconds;
}

/** Calculate fee and net from gross amount and basis points */
export function calculateFeeSplit(grossAmount: bigint, feeBps: number): {
  gross: bigint;
  fee: bigint;
  net: bigint;
} {
  const fee = (grossAmount * BigInt(feeBps)) / BigInt(10000);
  return { gross: grossAmount, fee, net: grossAmount - fee };
}
