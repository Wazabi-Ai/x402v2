import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Handle suffix for Wazabi x402 identities
 */
export const HANDLE_SUFFIX = '.wazabi-x402' as const;

/**
 * Settlement fee rate (0.5% = 0.005)
 */
export const SETTLEMENT_FEE_RATE = 0.005 as const;

/**
 * Settlement fee basis points (50 = 0.5%)
 */
export const SETTLEMENT_FEE_BPS = 50 as const;

/**
 * Supported networks for agent wallets
 */
export const AGENT_SUPPORTED_NETWORKS = ['eip155:1', 'eip155:56', 'eip155:8453'] as const;

/**
 * Session key default validity duration (1 year in seconds)
 */
export const SESSION_KEY_DEFAULT_VALIDITY = 365 * 24 * 60 * 60;

// ============================================================================
// Handle Validation
// ============================================================================

/**
 * Handle format: 3-50 alphanumeric characters, hyphens, underscores
 */
export const HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/;

export const HandleSchema = z.string()
  .min(3, 'Handle must be at least 3 characters')
  .max(50, 'Handle must be at most 50 characters')
  .regex(HANDLE_REGEX, 'Handle must be alphanumeric with optional hyphens/underscores, start and end with alphanumeric');

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Agent registration request
 */
export const RegisterRequestSchema = z.object({
  handle: HandleSchema,
  networks: z.array(z.enum(['eip155:1', 'eip155:56', 'eip155:8453'])).default(['eip155:1', 'eip155:56', 'eip155:8453']),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address').optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Agent registration response
 */
export interface RegisterResponse {
  handle: string;
  wallet: {
    address: string;
    type: 'ERC-4337';
    deployed: Record<string, boolean>;
  };
  session_key: {
    public: string;
    private: string;
    expires: string;
  };
}

/**
 * Agent record stored in database
 */
export interface Agent {
  id: string;
  handle: string;
  full_handle: string;
  wallet_address: string;
  owner_address: string | null;
  session_key_public: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

/**
 * Agent balance record
 */
export interface AgentBalance {
  agent_id: string;
  network: string;
  token: string;
  balance: string;
  updated_at: Date;
}

/**
 * Transaction status
 */
export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

/**
 * Transaction record
 */
export interface Transaction {
  id: string;
  from_handle: string;
  to_address: string;
  amount: string;
  token: string;
  network: string;
  fee: string;
  gas_cost: string;
  tx_hash: string | null;
  status: TransactionStatus;
  created_at: Date;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Resolve response
 */
export interface ResolveResponse {
  handle: string;
  address: string;
  networks: string[];
  active: boolean;
}

/**
 * Balance response
 */
export interface BalanceResponse {
  handle: string;
  balances: Record<string, Record<string, string>>;
  total_usd: string;
}

/**
 * History response
 */
export interface HistoryResponse {
  handle: string;
  transactions: Array<{
    type: 'payment_sent' | 'payment_received';
    amount: string;
    token: string;
    fee: string;
    gas: string;
    to: string;
    from: string;
    tx_hash: string;
    network: string;
    timestamp: string;
  }>;
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

/**
 * Profile response
 */
export interface ProfileResponse {
  handle: string;
  wallet_address: string;
  networks: string[];
  created_at: string;
  metadata: Record<string, unknown>;
  balances: Record<string, Record<string, string>>;
  total_transactions: number;
}

/**
 * Settlement request
 */
export const SettleRequestSchema = z.object({
  from: z.string().min(1, 'From handle or address required'),
  to: z.string().min(1, 'To handle or address required'),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a numeric string'),
  token: z.string().default('USDC'),
  network: z.string().default('eip155:8453'),
});

export type SettleRequest = z.infer<typeof SettleRequestSchema>;

/**
 * Payment verification request
 */
export const VerifyRequestSchema = z.object({
  from: z.string().min(1, 'From handle or address required'),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a numeric string'),
  token: z.string().default('USDC'),
  network: z.string().default('eip155:8453'),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

/**
 * Settlement response
 */
export interface SettleResponse {
  success: boolean;
  tx_hash: string;
  settlement: {
    gross: string;
    fee: string;
    gas: string;
    net: string;
  };
  from: string;
  to: string;
  network: string;
}

/**
 * Supported response
 */
export interface SupportedResponse {
  networks: Array<{
    id: string;
    name: string;
    tokens: string[];
  }>;
  handle_suffix: string;
  fee_rate: string;
  wallet_type: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert a handle to its full form (e.g., "molty" -> "molty.wazabi-x402")
 */
export function toFullHandle(handle: string): string {
  if (handle.endsWith(HANDLE_SUFFIX)) {
    return handle;
  }
  return `${handle}${HANDLE_SUFFIX}`;
}

/**
 * Extract the short handle from full handle
 */
export function toShortHandle(fullHandle: string): string {
  if (fullHandle.endsWith(HANDLE_SUFFIX)) {
    return fullHandle.slice(0, -HANDLE_SUFFIX.length);
  }
  return fullHandle;
}

/**
 * Check if a string is a full handle (has .wazabi-x402 suffix)
 */
export function isFullHandle(handle: string): boolean {
  return handle.endsWith(HANDLE_SUFFIX);
}

/**
 * Check if a string is an Ethereum address
 */
export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * Calculate settlement fee (0.5%)
 */
export function calculateFee(amount: string): string {
  const amountNum = parseFloat(amount);
  const fee = amountNum * SETTLEMENT_FEE_RATE;
  return fee.toFixed(fee < 0.01 ? 6 : 2);
}

/**
 * Calculate net amount after fee
 */
export function calculateNet(amount: string, fee: string, gas: string): string {
  const net = parseFloat(amount) - parseFloat(fee) - parseFloat(gas);
  return net.toFixed(net < 0.01 ? 6 : 2);
}
