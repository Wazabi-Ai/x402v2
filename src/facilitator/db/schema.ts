/**
 * Database Schema for Wazabi x402 Facilitator
 *
 * Transaction storage for settlement history and auditing.
 */

import type { Transaction } from '../types.js';

// ============================================================================
// SQL Schema (for PostgreSQL migration)
// ============================================================================

export const CREATE_TRANSACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount DECIMAL(36,18) NOT NULL,
  token VARCHAR(10) NOT NULL,
  network VARCHAR(20) NOT NULL,
  fee DECIMAL(36,18) NOT NULL DEFAULT 0,
  gas_cost DECIMAL(36,18) NOT NULL DEFAULT 0,
  tx_hash VARCHAR(66),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;
`;

export const CREATE_ALL_TABLES = CREATE_TRANSACTIONS_TABLE;

// ============================================================================
// DataStore Interface
// ============================================================================

export interface DataStore {
  createTransaction(tx: Transaction): Promise<Transaction>;
  getTransaction(id: string): Promise<Transaction | null>;
  updateTransactionStatus(id: string, status: string, txHash?: string): Promise<void>;
  updateTransactionGas(id: string, gasCost: string): Promise<void>;
  getTransactionsByAddress(address: string, limit?: number, offset?: number): Promise<{ transactions: Transaction[]; total: number }>;
  getTransactionCount(): Promise<number>;
}

// ============================================================================
// In-Memory Store Implementation
// ============================================================================

export class InMemoryStore implements DataStore {
  private transactions: Transaction[] = [];

  async createTransaction(tx: Transaction): Promise<Transaction> {
    this.transactions.push(tx);
    return tx;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    return this.transactions.find(t => t.id === id) ?? null;
  }

  async getTransactionsByAddress(
    address: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const filtered = this.transactions.filter(
      tx => tx.from_address === address || tx.to_address === address
    );
    const sorted = filtered.sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime()
    );
    return {
      transactions: sorted.slice(offset, offset + limit),
      total: sorted.length,
    };
  }

  async updateTransactionStatus(
    id: string,
    status: string,
    txHash?: string,
  ): Promise<void> {
    const tx = this.transactions.find(t => t.id === id);
    if (tx) {
      tx.status = status as Transaction['status'];
      if (txHash) tx.tx_hash = txHash;
    }
  }

  async updateTransactionGas(id: string, gasCost: string): Promise<void> {
    const tx = this.transactions.find(t => t.id === id);
    if (tx) {
      tx.gas_cost = gasCost;
    }
  }

  async getTransactionCount(): Promise<number> {
    return this.transactions.length;
  }
}
