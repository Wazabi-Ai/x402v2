import { describe, it, expect, beforeEach } from 'vitest';
import type { PublicClient, WalletClient } from 'viem';
import { InMemoryStore } from '../src/facilitator/db/schema.js';
import { SettlementService, SettlementError } from '../src/facilitator/services/settlement.js';
import type { SettlementConfig } from '../src/facilitator/services/settlement.js';
import type { Permit2Payload, ERC3009Payload } from '../src/types/index.js';

// ============================================================================
// Mock Constants
// ============================================================================

const MOCK_TREASURY = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const MOCK_SETTLEMENT_ADDR = '0x4444444444444444444444444444444444444444' as `0x${string}`;
const MOCK_PAYER = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const MOCK_RECIPIENT = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const MOCK_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`;
const MOCK_TX_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const MOCK_SIGNATURE = ('0x' + 'cd'.repeat(65)) as `0x${string}`;

// ============================================================================
// Mock Viem Clients
// ============================================================================

const mockPublicClient = {
  readContract: async () => BigInt('1000000000000000000000'),
  getGasPrice: async () => BigInt(76_923_077),
  waitForTransactionReceipt: async () => ({
    status: 'success' as const,
    gasUsed: BigInt(65_000),
    effectiveGasPrice: BigInt(76_923_077),
  }),
} as unknown as PublicClient;

const mockWalletClient = {
  writeContract: async () => MOCK_TX_HASH,
  account: { address: MOCK_TREASURY },
  chain: { id: 8453 },
} as unknown as WalletClient;

const mockSettlementConfig: SettlementConfig = {
  treasuryAddress: MOCK_TREASURY,
  settlementAddresses: {
    'eip155:8453': MOCK_SETTLEMENT_ADDR,
    'eip155:56': MOCK_SETTLEMENT_ADDR,
  },
  publicClients: { 'eip155:8453': mockPublicClient, 'eip155:56': mockPublicClient },
  walletClients: { 'eip155:8453': mockWalletClient, 'eip155:56': mockWalletClient },
};

// ============================================================================
// Payload Builders
// ============================================================================

function buildPermit2Payload(overrides: Partial<Permit2Payload> = {}): Permit2Payload {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  return {
    scheme: 'permit2' as const,
    network: 'eip155:8453',
    permit: {
      permitted: [
        { token: MOCK_TOKEN, amount: '9950000' },
        { token: MOCK_TOKEN, amount: '50000' },
      ],
      nonce: '123456789',
      deadline,
    },
    witness: {
      recipient: MOCK_RECIPIENT,
      feeBps: 50,
    },
    spender: MOCK_SETTLEMENT_ADDR,
    payer: MOCK_PAYER,
    signature: MOCK_SIGNATURE,
    ...overrides,
  };
}

function buildERC3009Payload(overrides: Partial<ERC3009Payload> = {}): ERC3009Payload {
  return {
    scheme: 'erc3009' as const,
    network: 'eip155:8453',
    authorization: {
      from: MOCK_PAYER,
      to: MOCK_SETTLEMENT_ADDR,
      value: '10000000',
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
    },
    recipient: MOCK_RECIPIENT,
    payer: MOCK_PAYER,
    signature: MOCK_SIGNATURE,
    ...overrides,
  };
}

// ============================================================================
// InMemoryStore Tests
// ============================================================================

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  describe('transactions', () => {
    it('should create and retrieve transactions', async () => {
      await store.createTransaction({
        id: 'tx-1',
        from_address: MOCK_PAYER,
        to_address: MOCK_RECIPIENT,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
        fee: '0.05',
        gas_cost: '0.02',
        tx_hash: null,
        status: 'pending',
        created_at: new Date(),
      });

      const { transactions, total } = await store.getTransactionsByAddress(MOCK_PAYER);
      expect(transactions).toHaveLength(1);
      expect(total).toBe(1);
      expect(transactions[0]?.amount).toBe('10.00');
    });

    it('should update transaction status', async () => {
      await store.createTransaction({
        id: 'tx-1',
        from_address: MOCK_PAYER,
        to_address: MOCK_RECIPIENT,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
        fee: '0.05',
        gas_cost: '0.02',
        tx_hash: null,
        status: 'pending',
        created_at: new Date(),
      });

      await store.updateTransactionStatus('tx-1', 'confirmed', '0xabc123');

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      expect(transactions[0]?.status).toBe('confirmed');
      expect(transactions[0]?.tx_hash).toBe('0xabc123');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createTransaction({
          id: `tx-${i}`,
          from_address: MOCK_PAYER,
          to_address: MOCK_RECIPIENT,
          amount: `${i + 1}.00`,
          token: 'USDC',
          network: 'eip155:8453',
          fee: '0.05',
          gas_cost: '0.02',
          tx_hash: null,
          status: 'confirmed',
          created_at: new Date(Date.now() + i * 1000),
        });
      }

      const { transactions, total } = await store.getTransactionsByAddress(MOCK_PAYER, 2, 0);
      expect(transactions).toHaveLength(2);
      expect(total).toBe(5);
    });

    it('should count transactions', async () => {
      expect(await store.getTransactionCount()).toBe(0);

      await store.createTransaction({
        id: 'tx-1',
        from_address: MOCK_PAYER,
        to_address: MOCK_RECIPIENT,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
        fee: '0.05',
        gas_cost: '0.02',
        tx_hash: null,
        status: 'confirmed',
        created_at: new Date(),
      });

      expect(await store.getTransactionCount()).toBe(1);
    });

    it('should return empty for unknown address', async () => {
      const { transactions, total } = await store.getTransactionsByAddress('0x0000000000000000000000000000000000000000');
      expect(transactions).toHaveLength(0);
      expect(total).toBe(0);
    });
  });
});

// ============================================================================
// SettlementService Tests
// ============================================================================

describe('SettlementService', () => {
  let store: InMemoryStore;
  let settlementService: SettlementService;

  beforeEach(() => {
    store = new InMemoryStore();
    settlementService = new SettlementService(store, mockSettlementConfig);
  });

  // ==========================================================================
  // settleX402 — Permit2 path
  // ==========================================================================

  describe('settleX402 (Permit2)', () => {
    it('should execute Permit2 settlement successfully', async () => {
      const payload = buildPermit2Payload();
      const result = await settlementService.settleX402(payload);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);
      expect(result.network).toBe('eip155:8453');
      expect(result.settlementId).toBeDefined();
    });

    it('should record transaction in store on success', async () => {
      const payload = buildPermit2Payload();
      await settlementService.settleX402(payload);

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.status).toBe('confirmed');
      expect(transactions[0]?.tx_hash).toBe(MOCK_TX_HASH);
      expect(transactions[0]?.to_address).toBe(MOCK_RECIPIENT);
    });

    it('should compute gross amount from permitted[0] + permitted[1]', async () => {
      const payload = buildPermit2Payload();
      await settlementService.settleX402(payload);

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      // 9950000 + 50000 = 10000000
      expect(transactions[0]?.amount).toBe('10000000');
    });

    it('should reject unsupported network', async () => {
      const payload = buildPermit2Payload({ network: 'eip155:999' });
      await expect(settlementService.settleX402(payload)).rejects.toThrow('No clients configured');
    });

    it('should handle reverted transaction', async () => {
      const failingPublicClient = {
        ...mockPublicClient,
        waitForTransactionReceipt: async () => ({
          status: 'reverted' as const,
          gasUsed: BigInt(65_000),
          effectiveGasPrice: BigInt(76_923_077),
        }),
      } as unknown as PublicClient;

      const failConfig: SettlementConfig = {
        ...mockSettlementConfig,
        publicClients: { ...mockSettlementConfig.publicClients, 'eip155:8453': failingPublicClient },
      };

      const failService = new SettlementService(store, failConfig);
      const payload = buildPermit2Payload();

      await expect(failService.settleX402(payload)).rejects.toThrow('reverted');
    });

    it('should handle writeContract failure', async () => {
      const failingWalletClient = {
        writeContract: async () => { throw new Error('execution reverted'); },
        account: { address: MOCK_TREASURY },
        chain: { id: 8453 },
      } as unknown as WalletClient;

      const failConfig: SettlementConfig = {
        ...mockSettlementConfig,
        walletClients: { ...mockSettlementConfig.walletClients, 'eip155:8453': failingWalletClient },
      };

      const failService = new SettlementService(store, failConfig);
      const payload = buildPermit2Payload();

      await expect(failService.settleX402(payload)).rejects.toThrow('settlement failed');
    });

    it('should mark transaction as failed on error', async () => {
      const failingWalletClient = {
        writeContract: async () => { throw new Error('RPC error'); },
        account: { address: MOCK_TREASURY },
        chain: { id: 8453 },
      } as unknown as WalletClient;

      const failConfig: SettlementConfig = {
        ...mockSettlementConfig,
        walletClients: { ...mockSettlementConfig.walletClients, 'eip155:8453': failingWalletClient },
      };

      const failService = new SettlementService(store, failConfig);
      const payload = buildPermit2Payload();

      try { await failService.settleX402(payload); } catch { /* expected */ }

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      expect(transactions[0]?.status).toBe('failed');
    });
  });

  // ==========================================================================
  // settleX402 — ERC-3009 path
  // ==========================================================================

  describe('settleX402 (ERC-3009)', () => {
    it('should execute ERC-3009 settlement successfully', async () => {
      const payload = buildERC3009Payload();
      const result = await settlementService.settleX402(payload);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);
      expect(result.network).toBe('eip155:8453');
      expect(result.settlementId).toBeDefined();
    });

    it('should record transaction with authorization value as amount', async () => {
      const payload = buildERC3009Payload();
      await settlementService.settleX402(payload);

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.amount).toBe('10000000');
      expect(transactions[0]?.to_address).toBe(MOCK_RECIPIENT);
    });

    it('should reject ERC-3009 on unsupported network (BSC)', async () => {
      const payload = buildERC3009Payload({ network: 'eip155:56' });
      await expect(settlementService.settleX402(payload)).rejects.toThrow('not supported');
    });
  });

  // ==========================================================================
  // settleX402 — Pre-flight validations
  // ==========================================================================

  describe('settleX402 (pre-flight validation)', () => {
    it('should reject Permit2 with expired deadline', async () => {
      const payload = buildPermit2Payload({
        permit: {
          permitted: [
            { token: MOCK_TOKEN, amount: '9950000' },
            { token: MOCK_TOKEN, amount: '50000' },
          ],
          nonce: '123456789',
          deadline: Math.floor(Date.now() / 1000) - 60,
        },
      });
      await expect(settlementService.settleX402(payload)).rejects.toThrow('expired');
    });

    it('should reject ERC-3009 with expired authorization', async () => {
      const payload = buildERC3009Payload({
        authorization: {
          from: MOCK_PAYER,
          to: MOCK_SETTLEMENT_ADDR,
          value: '10000000',
          validAfter: 0,
          validBefore: Math.floor(Date.now() / 1000) - 60,
          nonce: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
        },
      });
      await expect(settlementService.settleX402(payload)).rejects.toThrow('expired');
    });

    it('should reject Permit2 with feeBps exceeding max (1000)', async () => {
      const payload = buildPermit2Payload({
        witness: { recipient: MOCK_RECIPIENT, feeBps: 1500 },
      });
      await expect(settlementService.settleX402(payload)).rejects.toThrow('outside valid range');
    });

    it('should record calculated fee in transaction', async () => {
      const payload = buildPermit2Payload();
      await settlementService.settleX402(payload);

      const { transactions } = await store.getTransactionsByAddress(MOCK_PAYER);
      // gross = 10000000, feeBps = 50 → fee = 10000000 * 50 / 10000 = 50000
      expect(transactions[0]?.fee).toBe('50000');
    });
  });

  // ==========================================================================
  // settleX402 — Configuration errors
  // ==========================================================================

  describe('settleX402 (configuration)', () => {
    it('should reject when no settlement address configured', async () => {
      const noSettlementConfig: SettlementConfig = {
        ...mockSettlementConfig,
        settlementAddresses: {},
      };
      const service = new SettlementService(store, noSettlementConfig);
      const payload = buildPermit2Payload();

      await expect(service.settleX402(payload)).rejects.toThrow('No WazabiSettlement contract configured');
    });

    it('should reject when wallet client has no account', async () => {
      const noAccountClient = {
        writeContract: async () => MOCK_TX_HASH,
        account: undefined,
        chain: { id: 8453 },
      } as unknown as WalletClient;

      const noAccountConfig: SettlementConfig = {
        ...mockSettlementConfig,
        walletClients: { ...mockSettlementConfig.walletClients, 'eip155:8453': noAccountClient },
      };

      const service = new SettlementService(store, noAccountConfig);
      const payload = buildPermit2Payload();

      await expect(service.settleX402(payload)).rejects.toThrow('no account');
    });
  });

  // ==========================================================================
  // getHistory — Address-based lookups
  // ==========================================================================

  describe('getHistory', () => {
    it('should return history after x402 settlement', async () => {
      const payload = buildPermit2Payload();
      await settlementService.settleX402(payload);

      const history = await settlementService.getHistory(MOCK_PAYER);
      expect(history.address).toBe(MOCK_PAYER);
      expect(history.transactions).toHaveLength(1);
      expect(history.transactions[0]?.type).toBe('payment_sent');
    });

    it('should throw for invalid address', async () => {
      await expect(
        settlementService.getHistory('not-an-address')
      ).rejects.toThrow('not a valid Ethereum address');
    });

    it('should return empty history for address with no transactions', async () => {
      const addr = '0xcccccccccccccccccccccccccccccccccccccccc';
      const history = await settlementService.getHistory(addr);
      expect(history.address).toBe(addr);
      expect(history.transactions).toHaveLength(0);
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 3; i++) {
        await store.createTransaction({
          id: `tx-${i}`,
          from_address: MOCK_PAYER,
          to_address: MOCK_RECIPIENT,
          amount: `${(i + 1) * 1000000}`,
          token: MOCK_TOKEN,
          network: 'eip155:8453',
          fee: '0',
          gas_cost: '0',
          tx_hash: null,
          status: 'confirmed',
          created_at: new Date(Date.now() + i * 1000),
        });
      }

      const history = await settlementService.getHistory(MOCK_PAYER, 2, 0);
      expect(history.transactions).toHaveLength(2);
      expect(history.pagination.total).toBe(3);
      expect(history.pagination.limit).toBe(2);
    });
  });

  // ==========================================================================
  // verifyPayment
  // ==========================================================================

  describe('verifyPayment', () => {
    it('should verify a valid address', async () => {
      const result = await settlementService.verifyPayment({
        from: MOCK_PAYER,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(true);
      expect(result.signer).toBe(MOCK_PAYER);
    });

    it('should reject invalid address', async () => {
      const result = await settlementService.verifyPayment({
        from: 'not-an-address',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a valid');
    });

    it('should reject unconfigured network', async () => {
      const result = await settlementService.verifyPayment({
        from: MOCK_PAYER,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:999',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return txCount from store', async () => {
      // Settle a payment first so there's history
      await settlementService.settleX402(buildPermit2Payload());

      const result = await settlementService.verifyPayment({
        from: MOCK_PAYER,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(true);
      expect(result.txCount).toBe(1);
    });
  });

  // ==========================================================================
  // getFeeSchedule
  // ==========================================================================

  describe('getFeeSchedule', () => {
    it('should return fee schedule', () => {
      const schedule = settlementService.getFeeSchedule();
      expect(schedule.rate).toBe(0.005);
      expect(schedule.bps).toBe(50);
      expect(schedule.description).toContain('0.5%');
    });
  });
});
