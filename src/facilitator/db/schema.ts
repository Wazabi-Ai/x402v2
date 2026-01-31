/**
 * Database Schema for Wazabi x402 Facilitator
 *
 * PostgreSQL schema definitions for agent handles, balances, and transactions.
 * Uses UUID primary keys and supports multi-chain operations.
 */

// ============================================================================
// SQL Schema (for PostgreSQL migration)
// ============================================================================

export const CREATE_AGENTS_TABLE = `
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle VARCHAR(50) UNIQUE NOT NULL,
  full_handle VARCHAR(100) UNIQUE NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  owner_address VARCHAR(42),
  session_key_public VARCHAR(66) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT handle_format CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$'),
  CONSTRAINT wallet_address_format CHECK (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT full_handle_suffix CHECK (full_handle LIKE '%.wazabi-x402')
);

CREATE INDEX IF NOT EXISTS idx_agents_handle ON agents(handle);
CREATE INDEX IF NOT EXISTS idx_agents_wallet ON agents(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agents_created ON agents(created_at DESC);
`;

export const CREATE_AGENT_BALANCES_TABLE = `
CREATE TABLE IF NOT EXISTS agent_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  network VARCHAR(20) NOT NULL,
  token VARCHAR(10) NOT NULL,
  balance DECIMAL(36,18) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT unique_agent_network_token UNIQUE (agent_id, network, token)
);

CREATE INDEX IF NOT EXISTS idx_balances_agent ON agent_balances(agent_id);
CREATE INDEX IF NOT EXISTS idx_balances_updated ON agent_balances(updated_at DESC);
`;

export const CREATE_TRANSACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_handle VARCHAR(100) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_handle);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;
`;

export const CREATE_ALL_TABLES = `
${CREATE_AGENTS_TABLE}
${CREATE_AGENT_BALANCES_TABLE}
${CREATE_TRANSACTIONS_TABLE}
`;

// ============================================================================
// In-Memory Store (for development / testing without PostgreSQL)
// ============================================================================

import type { Agent, AgentBalance, Transaction } from '../types.js';

export class InMemoryStore {
  private agents: Map<string, Agent> = new Map();
  private agentsByHandle: Map<string, Agent> = new Map();
  private agentsByWallet: Map<string, Agent> = new Map();
  private balances: Map<string, AgentBalance[]> = new Map();
  private transactions: Transaction[] = [];

  // --- Agents ---

  async createAgent(agent: Agent): Promise<Agent> {
    if (this.agentsByHandle.has(agent.handle)) {
      throw new Error(`Handle "${agent.handle}" is already taken`);
    }
    this.agents.set(agent.id, agent);
    this.agentsByHandle.set(agent.handle, agent);
    this.agentsByWallet.set(agent.wallet_address.toLowerCase(), agent);
    return agent;
  }

  async getAgentById(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async getAgentByHandle(handle: string): Promise<Agent | null> {
    // Support both short and full handles
    const shortHandle = handle.replace('.wazabi-x402', '');
    return this.agentsByHandle.get(shortHandle) ?? null;
  }

  async getAgentByWallet(address: string): Promise<Agent | null> {
    return this.agentsByWallet.get(address.toLowerCase()) ?? null;
  }

  async handleExists(handle: string): Promise<boolean> {
    const shortHandle = handle.replace('.wazabi-x402', '');
    return this.agentsByHandle.has(shortHandle);
  }

  async getAgentCount(): Promise<number> {
    return this.agents.size;
  }

  // --- Balances ---

  async getBalances(agentId: string): Promise<AgentBalance[]> {
    return this.balances.get(agentId) ?? [];
  }

  async setBalance(balance: AgentBalance): Promise<void> {
    const existing = this.balances.get(balance.agent_id) ?? [];
    const idx = existing.findIndex(
      b => b.network === balance.network && b.token === balance.token
    );
    if (idx >= 0) {
      existing[idx] = balance;
    } else {
      existing.push(balance);
    }
    this.balances.set(balance.agent_id, existing);
  }

  // --- Transactions ---

  async createTransaction(tx: Transaction): Promise<Transaction> {
    this.transactions.push(tx);
    return tx;
  }

  async getTransactionsByHandle(
    handleOrAddress: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    // Support both handle lookups and raw address lookups
    const isRawAddress = /^0x[a-fA-F0-9]{40}$/.test(handleOrAddress);
    const identifier = isRawAddress
      ? handleOrAddress
      : handleOrAddress.endsWith('.wazabi-x402')
        ? handleOrAddress
        : `${handleOrAddress}.wazabi-x402`;
    const filtered = this.transactions.filter(
      tx => tx.from_handle === identifier || tx.to_address === identifier
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
    status: Transaction['status'],
    txHash?: string
  ): Promise<void> {
    const tx = this.transactions.find(t => t.id === id);
    if (tx) {
      tx.status = status;
      if (txHash) tx.tx_hash = txHash;
    }
  }

  async getTransactionCount(handle: string): Promise<number> {
    const fullHandle = handle.endsWith('.wazabi-x402') ? handle : `${handle}.wazabi-x402`;
    return this.transactions.filter(
      tx => tx.from_handle === fullHandle || tx.to_address === fullHandle
    ).length;
  }
}
