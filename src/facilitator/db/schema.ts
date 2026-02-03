/**
 * Database Schema for Wazabi x402 Facilitator
 *
 * Transaction storage for settlement history and auditing.
 * Supports in-memory (development) and PostgreSQL (production) backends.
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

// ============================================================================
// PostgreSQL Store Implementation
// ============================================================================

/**
 * PostgreSQL-backed DataStore for production use.
 *
 * Uses the `pg` package (must be installed separately as an optional dependency).
 * Pass a `pg.Pool` instance to the constructor.
 *
 * @example
 * ```typescript
 * import pg from 'pg';
 * import { PostgresStore, CREATE_ALL_TABLES } from '@wazabiai/x402/facilitator';
 *
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 * await pool.query(CREATE_ALL_TABLES);
 * const store = new PostgresStore(pool);
 * ```
 */
export class PostgresStore implements DataStore {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async createTransaction(tx: Transaction): Promise<Transaction> {
    await this.pool.query(
      `INSERT INTO transactions (id, from_address, to_address, amount, token, network, fee, gas_cost, tx_hash, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tx.id, tx.from_address, tx.to_address, tx.amount, tx.token, tx.network, tx.fee, tx.gas_cost, tx.tx_hash, tx.status, tx.created_at]
    );
    return tx;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    const result = await this.pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getTransactionsByAddress(
    address: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM transactions
         WHERE from_address = $1 OR to_address = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [address, limit, offset]
      ),
      this.pool.query(
        'SELECT COUNT(*) as count FROM transactions WHERE from_address = $1 OR to_address = $1',
        [address]
      ),
    ]);

    return {
      transactions: dataResult.rows.map(this.mapRow),
      total: parseInt(String(countResult.rows[0]?.count ?? '0')),
    };
  }

  async updateTransactionStatus(id: string, status: string, txHash?: string): Promise<void> {
    if (txHash) {
      await this.pool.query(
        'UPDATE transactions SET status = $1, tx_hash = $2 WHERE id = $3',
        [status, txHash, id]
      );
    } else {
      await this.pool.query(
        'UPDATE transactions SET status = $1 WHERE id = $2',
        [status, id]
      );
    }
  }

  async updateTransactionGas(id: string, gasCost: string): Promise<void> {
    await this.pool.query(
      'UPDATE transactions SET gas_cost = $1 WHERE id = $2',
      [gasCost, id]
    );
  }

  async getTransactionCount(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) as count FROM transactions');
    return parseInt(String(result.rows[0]?.count ?? '0'));
  }

  private mapRow(row: Record<string, unknown>): Transaction {
    return {
      id: row.id as string,
      from_address: row.from_address as string,
      to_address: row.to_address as string,
      amount: String(row.amount),
      token: row.token as string,
      network: row.network as string,
      fee: String(row.fee),
      gas_cost: String(row.gas_cost),
      tx_hash: (row.tx_hash as string) ?? null,
      status: row.status as Transaction['status'],
      created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at as string),
    };
  }
}

// ============================================================================
// Minimal pg.Pool type (avoids hard dependency on @types/pg)
// ============================================================================

interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface PgPool {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}
