import { describe, it, expect, beforeEach } from 'vitest';
import type { PublicClient, WalletClient } from 'viem';
import { InMemoryStore } from '../src/facilitator/db/schema.js';
import { HandleService, HandleError } from '../src/facilitator/services/handle.js';
import { SettlementService, SettlementError } from '../src/facilitator/services/settlement.js';
import type { SettlementConfig } from '../src/facilitator/services/settlement.js';
import { WalletService } from '../src/facilitator/services/wallet.js';

// Mock viem clients for settlement tests
const MOCK_TREASURY = '0x1111111111111111111111111111111111111111' as `0x${string}`;

const mockPublicClient = {
  readContract: async () => BigInt('1000000000000000000000'),
  getGasPrice: async () => BigInt(76_923_077), // ~0.077 gwei → ~$0.02 gas on Base ($4000 ETH)
  waitForTransactionReceipt: async () => ({
    status: 'success' as const,
    gasUsed: BigInt(65_000),
    effectiveGasPrice: BigInt(76_923_077),
  }),
} as unknown as PublicClient;

const mockWalletClient = {
  writeContract: async () => ('0x' + 'ab'.repeat(32)) as `0x${string}`,
  account: { address: MOCK_TREASURY },
  chain: { id: 8453 },
} as unknown as WalletClient;

const mockSettlementConfig: SettlementConfig = {
  treasuryAddress: MOCK_TREASURY,
  publicClients: { 'eip155:8453': mockPublicClient, 'eip155:56': mockPublicClient },
  walletClients: { 'eip155:8453': mockWalletClient, 'eip155:56': mockWalletClient },
};

// ============================================================================
// InMemoryStore Tests
// ============================================================================

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  describe('agents', () => {
    const testAgent = {
      id: 'test-id-1',
      handle: 'molty',
      full_handle: 'molty.wazabi-x402',
      wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
      owner_address: null,
      session_key_public: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      created_at: new Date(),
      metadata: {},
    };

    it('should create and retrieve agent by ID', async () => {
      await store.createAgent(testAgent);
      const agent = await store.getAgent('test-id-1');
      expect(agent).toBeDefined();
      expect(agent?.handle).toBe('molty');
    });

    it('should retrieve agent by handle', async () => {
      await store.createAgent(testAgent);
      const agent = await store.getAgentByHandle('molty');
      expect(agent).toBeDefined();
      expect(agent?.full_handle).toBe('molty.wazabi-x402');
    });

    it('should retrieve agent by full handle', async () => {
      await store.createAgent(testAgent);
      const agent = await store.getAgentByHandle('molty.wazabi-x402');
      expect(agent).toBeDefined();
      expect(agent?.handle).toBe('molty');
    });

    it('should retrieve agent by wallet address', async () => {
      await store.createAgent(testAgent);
      const agent = await store.getAgentByWallet(testAgent.wallet_address);
      expect(agent).toBeDefined();
      expect(agent?.handle).toBe('molty');
    });

    it('should be case-insensitive for wallet lookup', async () => {
      await store.createAgent(testAgent);
      const agent = await store.getAgentByWallet(testAgent.wallet_address.toUpperCase());
      expect(agent).toBeDefined();
    });

    it('should check handle existence', async () => {
      await store.createAgent(testAgent);
      expect(await store.handleExists('molty')).toBe(true);
      expect(await store.handleExists('unknown')).toBe(false);
    });

    it('should prevent duplicate handles', async () => {
      await store.createAgent(testAgent);
      await expect(store.createAgent({
        ...testAgent,
        id: 'test-id-2',
      })).rejects.toThrow('already taken');
    });

    it('should count agents', async () => {
      expect(await store.getAgentCount()).toBe(0);
      await store.createAgent(testAgent);
      expect(await store.getAgentCount()).toBe(1);
    });

    it('should return null for non-existent agent', async () => {
      expect(await store.getAgent('non-existent')).toBeNull();
      expect(await store.getAgentByHandle('non-existent')).toBeNull();
      expect(await store.getAgentByWallet('0x0000000000000000000000000000000000000000')).toBeNull();
    });
  });

  describe('balances', () => {
    it('should set and get balances', async () => {
      await store.setBalance({
        agent_id: 'agent-1',
        network: 'eip155:8453',
        token: 'USDC',
        balance: '100.50',
        updated_at: new Date(),
      });

      const balances = await store.getBalances('agent-1');
      expect(balances).toHaveLength(1);
      expect(balances[0]?.balance).toBe('100.50');
    });

    it('should update existing balance', async () => {
      await store.setBalance({
        agent_id: 'agent-1',
        network: 'eip155:8453',
        token: 'USDC',
        balance: '100.00',
        updated_at: new Date(),
      });
      await store.setBalance({
        agent_id: 'agent-1',
        network: 'eip155:8453',
        token: 'USDC',
        balance: '200.00',
        updated_at: new Date(),
      });

      const balances = await store.getBalances('agent-1');
      expect(balances).toHaveLength(1);
      expect(balances[0]?.balance).toBe('200.00');
    });

    it('should support multiple tokens per agent', async () => {
      await store.setBalance({
        agent_id: 'agent-1',
        network: 'eip155:56',
        token: 'USDT',
        balance: '50.00',
        updated_at: new Date(),
      });
      await store.setBalance({
        agent_id: 'agent-1',
        network: 'eip155:56',
        token: 'USDC',
        balance: '75.00',
        updated_at: new Date(),
      });

      const balances = await store.getBalances('agent-1');
      expect(balances).toHaveLength(2);
    });

    it('should return empty for unknown agent', async () => {
      const balances = await store.getBalances('non-existent');
      expect(balances).toHaveLength(0);
    });
  });

  describe('transactions', () => {
    it('should create and retrieve transactions', async () => {
      await store.createTransaction({
        id: 'tx-1',
        from_handle: 'molty.wazabi-x402',
        to_address: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
        fee: '0.05',
        gas_cost: '0.02',
        tx_hash: null,
        status: 'pending',
        created_at: new Date(),
      });

      const { transactions, total } = await store.getTransactionsByHandle('molty');
      expect(transactions).toHaveLength(1);
      expect(total).toBe(1);
      expect(transactions[0]?.amount).toBe('10.00');
    });

    it('should update transaction status', async () => {
      await store.createTransaction({
        id: 'tx-1',
        from_handle: 'molty.wazabi-x402',
        to_address: '0x1234567890abcdef1234567890abcdef12345678',
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

      const { transactions } = await store.getTransactionsByHandle('molty');
      expect(transactions[0]?.status).toBe('confirmed');
      expect(transactions[0]?.tx_hash).toBe('0xabc123');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createTransaction({
          id: `tx-${i}`,
          from_handle: 'molty.wazabi-x402',
          to_address: '0x1234567890abcdef1234567890abcdef12345678',
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

      const { transactions, total } = await store.getTransactionsByHandle('molty', 2, 0);
      expect(transactions).toHaveLength(2);
      expect(total).toBe(5);
    });

    it('should count transactions for a handle', async () => {
      await store.createTransaction({
        id: 'tx-1',
        from_handle: 'molty.wazabi-x402',
        to_address: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
        fee: '0.05',
        gas_cost: '0.02',
        tx_hash: null,
        status: 'confirmed',
        created_at: new Date(),
      });

      expect(await store.getTransactionCount('molty')).toBe(1);
      expect(await store.getTransactionCount('unknown')).toBe(0);
    });
  });
});

// ============================================================================
// WalletService Tests
// ============================================================================

const TEST_FACTORY_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const testWalletConfig = {
  accountFactoryAddresses: {
    'eip155:1': TEST_FACTORY_ADDRESS,
    'eip155:56': TEST_FACTORY_ADDRESS,
    'eip155:8453': TEST_FACTORY_ADDRESS,
  },
};

describe('WalletService', () => {
  let walletService: WalletService;

  beforeEach(() => {
    walletService = new WalletService(testWalletConfig);
  });

  describe('computeWalletAddress', () => {
    it('should return a valid Ethereum address', () => {
      const address = walletService.computeWalletAddress(
        'molty',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should be deterministic (same inputs = same address)', () => {
      const addr1 = walletService.computeWalletAddress(
        'molty',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      const addr2 = walletService.computeWalletAddress(
        'molty',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      expect(addr1).toBe(addr2);
    });

    it('should produce different addresses for different handles', () => {
      const addr1 = walletService.computeWalletAddress(
        'molty',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      const addr2 = walletService.computeWalletAddress(
        'agent-b',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      expect(addr1).not.toBe(addr2);
    });
  });

  describe('generateSessionKey', () => {
    it('should generate a key pair', () => {
      const key = walletService.generateSessionKey();
      expect(key.publicKey).toBeDefined();
      expect(key.privateKey).toBeDefined();
      expect(key.expires).toBeInstanceOf(Date);
    });

    it('should generate unique keys', () => {
      const key1 = walletService.generateSessionKey();
      const key2 = walletService.generateSessionKey();
      expect(key1.privateKey).not.toBe(key2.privateKey);
    });

    it('should set expiration in the future', () => {
      const key = walletService.generateSessionKey();
      expect(key.expires.getTime()).toBeGreaterThan(Date.now());
    });

    it('should respect custom validity duration', () => {
      const oneHour = 3600;
      const key = walletService.generateSessionKey(oneHour);
      const expectedExpiry = Date.now() + oneHour * 1000;
      expect(Math.abs(key.expires.getTime() - expectedExpiry)).toBeLessThan(1000);
    });
  });
});

// ============================================================================
// HandleService Tests
// ============================================================================

describe('HandleService', () => {
  let store: InMemoryStore;
  let handleService: HandleService;

  beforeEach(() => {
    store = new InMemoryStore();
    handleService = new HandleService(store, new WalletService(testWalletConfig));
  });

  describe('register', () => {
    it('should register a new handle', async () => {
      const result = await handleService.register({
        handle: 'molty',
        networks: ['eip155:56', 'eip155:8453'],
      });

      expect(result.handle).toBe('molty.wazabi-x402');
      expect(result.wallet.type).toBe('ERC-4337');
      expect(result.wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result.session_key.public).toBeDefined();
      expect(result.session_key.private).toBeDefined();
      expect(result.session_key.expires).toBeDefined();
    });

    it('should set deployment status for requested networks', async () => {
      const result = await handleService.register({
        handle: 'molty',
        networks: ['eip155:56', 'eip155:8453'],
      });

      expect(result.wallet.deployed).toHaveProperty('eip155:56');
      expect(result.wallet.deployed).toHaveProperty('eip155:8453');
    });

    it('should accept optional owner address', async () => {
      const result = await handleService.register({
        handle: 'molty',
        networks: ['eip155:8453'],
        owner: '0x1234567890abcdef1234567890abcdef12345678',
      });

      expect(result.handle).toBe('molty.wazabi-x402');
    });

    it('should reject duplicate handles', async () => {
      await handleService.register({ handle: 'molty', networks: ['eip155:8453'] });

      await expect(
        handleService.register({ handle: 'molty', networks: ['eip155:8453'] })
      ).rejects.toThrow('already taken');
    });

    it('should reject invalid handle format', async () => {
      await expect(
        handleService.register({ handle: 'A', networks: ['eip155:8453'] })
      ).rejects.toThrow();
    });

    it('should reject reserved handles', async () => {
      await expect(
        handleService.register({ handle: 'admin', networks: ['eip155:8453'] })
      ).rejects.toThrow('reserved');
    });

    it('should reject system handles', async () => {
      await expect(
        handleService.register({ handle: 'wazabi', networks: ['eip155:8453'] })
      ).rejects.toThrow('reserved');
    });
  });

  describe('resolve', () => {
    it('should resolve a registered handle', async () => {
      const reg = await handleService.register({
        handle: 'molty',
        networks: ['eip155:8453'],
      });

      const result = await handleService.resolve('molty');
      expect(result).toBeDefined();
      expect(result?.handle).toBe('molty.wazabi-x402');
      expect(result?.address).toBe(reg.wallet.address);
      expect(result?.active).toBe(true);
    });

    it('should resolve a full handle', async () => {
      await handleService.register({
        handle: 'molty',
        networks: ['eip155:8453'],
      });

      const result = await handleService.resolve('molty.wazabi-x402');
      expect(result).toBeDefined();
      expect(result?.handle).toBe('molty.wazabi-x402');
    });

    it('should return null for unknown handle', async () => {
      const result = await handleService.resolve('unknown');
      expect(result).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('should return full profile', async () => {
      await handleService.register({
        handle: 'molty',
        networks: ['eip155:56', 'eip155:8453'],
        metadata: { agent_type: 'openclaw' },
      });

      const profile = await handleService.getProfile('molty');
      expect(profile).toBeDefined();
      expect(profile?.agent.handle).toBe('molty');
      expect(profile?.agent.metadata).toEqual({ agent_type: 'openclaw' });
      expect(profile?.balances.length).toBeGreaterThan(0);
    });

    it('should return null for unknown handle', async () => {
      const profile = await handleService.getProfile('unknown');
      expect(profile).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true for available handle', async () => {
      expect(await handleService.isAvailable('molty')).toBe(true);
    });

    it('should return false for taken handle', async () => {
      await handleService.register({ handle: 'molty', networks: ['eip155:8453'] });
      expect(await handleService.isAvailable('molty')).toBe(false);
    });

    it('should return false for reserved handle', async () => {
      expect(await handleService.isAvailable('admin')).toBe(false);
    });

    it('should return false for invalid format', async () => {
      expect(await handleService.isAvailable('A')).toBe(false);
    });
  });
});

// ============================================================================
// SettlementService Tests
// ============================================================================

describe('SettlementService', () => {
  let store: InMemoryStore;
  let handleService: HandleService;
  let settlementService: SettlementService;

  beforeEach(async () => {
    store = new InMemoryStore();
    handleService = new HandleService(store, new WalletService(testWalletConfig));
    settlementService = new SettlementService(handleService, store, mockSettlementConfig);

    // Register two agents for testing
    await handleService.register({
      handle: 'molty',
      networks: ['eip155:8453'],
    });
    await handleService.register({
      handle: 'agent-b',
      networks: ['eip155:8453'],
    });
  });

  describe('settle', () => {
    it('should execute a settlement between handles', async () => {
      const result = await settlementService.settle({
        from: 'molty',
        to: 'agent-b',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.success).toBe(true);
      expect(result.tx_hash).toBeDefined();
      expect(result.from).toBe('molty.wazabi-x402');
      expect(result.settlement.gross).toBe('10.00');
      expect(result.settlement.fee).toBe('0.05');
      expect(parseFloat(result.settlement.net)).toBeCloseTo(9.93, 2);
    });

    it('should apply 0.5% fee', async () => {
      const result = await settlementService.settle({
        from: 'molty',
        to: 'agent-b',
        amount: '100.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.settlement.fee).toBe('0.50');
    });

    it('should reject unknown sender handle', async () => {
      await expect(
        settlementService.settle({
          from: 'unknown-agent',
          to: 'agent-b',
          amount: '10.00',
          token: 'USDC',
          network: 'eip155:8453',
        })
      ).rejects.toThrow('not found');
    });

    it('should reject unknown recipient handle', async () => {
      await expect(
        settlementService.settle({
          from: 'molty',
          to: 'unknown-agent',
          amount: '10.00',
          token: 'USDC',
          network: 'eip155:8453',
        })
      ).rejects.toThrow('not found');
    });

    it('should accept recipient as address', async () => {
      const result = await settlementService.settle({
        from: 'molty',
        to: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.success).toBe(true);
      expect(result.to).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('should accept unregistered sender address (no registration required)', async () => {
      const rawAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const result = await settlementService.settle({
        from: rawAddress,
        to: 'agent-b',
        amount: '25.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.success).toBe(true);
      expect(result.from).toBe(rawAddress); // Raw address used as identifier
      expect(result.settlement.fee).toBe('0.13'); // 0.5% of 25
    });

    it('should settle between two raw addresses (fully unregistered)', async () => {
      const sender = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const result = await settlementService.settle({
        from: sender,
        to: recipient,
        amount: '50.00',
        token: 'USDC',
        network: 'eip155:56',
      });

      expect(result.success).toBe(true);
      expect(result.from).toBe(sender);
      expect(result.to).toBe(recipient);
      expect(result.settlement.fee).toBe('0.25');
    });

    it('should resolve registered address to handle in response', async () => {
      // Get molty's wallet address
      const resolved = await handleService.resolve('molty');
      const moltyAddress = resolved!.address;

      const result = await settlementService.settle({
        from: moltyAddress,
        to: 'agent-b',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.success).toBe(true);
      // When using a registered address, response should show the handle
      expect(result.from).toBe('molty.wazabi-x402');
    });

    it('should record transaction in store', async () => {
      await settlementService.settle({
        from: 'molty',
        to: 'agent-b',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      const { total } = await store.getTransactionsByHandle('molty');
      expect(total).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('should return transaction history', async () => {
      await settlementService.settle({
        from: 'molty',
        to: 'agent-b',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      const history = await settlementService.getHistory('molty');
      expect(history.handle).toBe('molty.wazabi-x402');
      expect(history.transactions).toHaveLength(1);
      expect(history.transactions[0]?.type).toBe('payment_sent');
      expect(history.transactions[0]?.amount).toBe('10.00');
    });

    it('should throw for unknown non-address string', async () => {
      await expect(
        settlementService.getHistory('unknown')
      ).rejects.toThrow('not found');
    });

    it('should return empty history for unregistered address', async () => {
      const addr = '0xcccccccccccccccccccccccccccccccccccccccc';
      const history = await settlementService.getHistory(addr);
      expect(history.address).toBe(addr);
      expect(history.transactions).toHaveLength(0);
    });

    it('should return history for unregistered address after settlement', async () => {
      const addr = '0xdddddddddddddddddddddddddddddddddddddddd';
      await settlementService.settle({
        from: addr,
        to: 'agent-b',
        amount: '15.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      const history = await settlementService.getHistory(addr);
      expect(history.address).toBe(addr);
      expect(history.transactions).toHaveLength(1);
      expect(history.transactions[0]?.type).toBe('payment_sent');
    });

    it('should support pagination', async () => {
      // Make 3 transactions
      for (let i = 0; i < 3; i++) {
        await settlementService.settle({
          from: 'molty',
          to: 'agent-b',
          amount: `${i + 1}.00`,
          token: 'USDC',
          network: 'eip155:8453',
        });
      }

      const history = await settlementService.getHistory('molty', 2, 0);
      expect(history.transactions).toHaveLength(2);
      expect(history.pagination.total).toBe(3);
      expect(history.pagination.limit).toBe(2);
    });
  });

  describe('verifyPayment', () => {
    it('should verify a registered sender by handle', async () => {
      const result = await settlementService.verifyPayment({
        from: 'molty',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(true);
      expect(result.signer).toBeDefined();
      expect(result.registered).toBe(true);
    });

    it('should return invalid for unknown handle', async () => {
      const result = await settlementService.verifyPayment({
        from: 'unknown',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should verify an unregistered raw address (no registration needed)', async () => {
      const result = await settlementService.verifyPayment({
        from: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(true);
      expect(result.registered).toBe(false);
      expect(result.signer).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      // No balance info for unregistered addresses
      expect(result.balanceSufficient).toBeUndefined();
    });

    it('should verify registered address and include balance info', async () => {
      const resolved = await handleService.resolve('molty');
      const result = await settlementService.verifyPayment({
        from: resolved!.address,
        amount: '10.00',
        token: 'USDC',
        network: 'eip155:8453',
      });

      expect(result.valid).toBe(true);
      expect(result.registered).toBe(true);
      expect(result.balanceSufficient).toBeDefined();
    });
  });

  describe('getFeeSchedule', () => {
    it('should return fee schedule', () => {
      const schedule = settlementService.getFeeSchedule();
      expect(schedule.rate).toBe(0.005);
      expect(schedule.bps).toBe(50);
      expect(schedule.description).toContain('0.5%');
    });
  });
});
