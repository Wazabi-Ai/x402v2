import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Settlement fee rate (0.5% = 0.005)
 */
export const SETTLEMENT_FEE_RATE = 0.005 as const;

/**
 * Settlement fee basis points (50 = 0.5%)
 */
export const SETTLEMENT_FEE_BPS = 50 as const;

/**
 * Supported networks
 */
export const SUPPORTED_NETWORK_IDS = ['eip155:1', 'eip155:56', 'eip155:8453'] as const;

// ============================================================================
// Transaction Types
// ============================================================================

export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface Transaction {
  id: string;
  from_address: string;
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
// API Request/Response Types
// ============================================================================

export const VerifyRequestSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  amount: z.string().regex(/^(?!0\d)\d+(\.\d{1,18})?$/, 'Amount must be a positive numeric string without leading zeros'),
  token: z.enum(['USDC', 'USDT', 'WETH', 'WBNB'], { message: 'Unsupported token' }).default('USDC'),
  network: z.enum(['eip155:1', 'eip155:56', 'eip155:8453'], { message: 'Unsupported network' }).default('eip155:8453'),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export interface HistoryResponse {
  address: string;
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

export interface SupportedResponse {
  networks: Array<{
    id: string;
    name: string;
    tokens: string[];
  }>;
  fee_rate: string;
  schemes: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function calculateFee(amount: string): string {
  const amountNum = parseFloat(amount);
  const fee = amountNum * SETTLEMENT_FEE_RATE;
  return fee.toFixed(fee < 0.01 ? 6 : 2);
}

export function calculateNet(amount: string, fee: string, gas: string): string {
  const net = parseFloat(amount) - parseFloat(fee) - parseFloat(gas);
  return net.toFixed(net < 0.01 ? 6 : 2);
}
