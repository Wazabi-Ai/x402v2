import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import axios, { AxiosInstance, AxiosResponse } from 'axios';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      request: vi.fn(),
    })),
  },
}));

// Mock viem
vi.mock('viem', () => ({
  createWalletClient: vi.fn(() => ({
    signTypedData: vi.fn(),
  })),
  http: vi.fn(),
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn((key: string) => ({
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123' as `0x${string}`,
  })),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  bsc: { id: 56, name: 'BSC' },
  base: { id: 8453, name: 'Base' },
}));

import {
  X402Client,
  createX402Client,
  createX402ClientFromEnv,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
} from '../src/client/index.js';
import { createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { X402_HEADERS } from '../src/types/index.js';
import { BSC_USDT, BSC_CAIP_ID } from '../src/chains/bnb.js';

describe('X402Client', () => {
  let mockAxiosInstance: { request: Mock };
  let mockWalletClient: { signTypedData: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockAxiosInstance = {
      request: vi.fn(),
    };
    
    mockWalletClient = {
      signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
    };

    (axios.create as Mock).mockReturnValue(mockAxiosInstance);
    (createWalletClient as Mock).mockReturnValue(mockWalletClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client without private key (read-only mode)', () => {
      const client = new X402Client();
      expect(client.canSign).toBe(false);
      expect(client.signerAddress).toBeNull();
    });

    it('should create client with private key', () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });
      expect(client.canSign).toBe(true);
      expect(client.signerAddress).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f4b123');
    });

    it('should handle private key without 0x prefix', () => {
      const client = new X402Client({
        privateKey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });
      expect(privateKeyToAccount).toHaveBeenCalledWith('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    });

    it('should use default configuration', () => {
      const client = new X402Client();
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should accept custom axios config', () => {
      new X402Client({
        axiosConfig: { baseURL: 'https://api.example.com' },
      });
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.example.com',
        })
      );
    });
  });

  describe('fetch', () => {
    it('should make successful request', async () => {
      const client = new X402Client();
      const mockResponse: Partial<AxiosResponse> = {
        status: 200,
        data: { message: 'success' },
      };
      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const response = await client.fetch('https://api.example.com/resource');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        url: 'https://api.example.com/resource',
      });
      expect(response.data).toEqual({ message: 'success' });
    });

    it('should throw PaymentRequiredError when autoRetry is false', async () => {
      const client = new X402Client({ autoRetry: false });
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
    });

    it('should throw PaymentRequiredError when no signer configured', async () => {
      const client = new X402Client({ autoRetry: true });
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
    });

    it('should throw UnsupportedNetworkError for unsupported network', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        supportedNetworks: ['eip155:56'],
      });
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: 'eip155:1', // Ethereum mainnet - not supported
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(UnsupportedNetworkError);
    });

    it('should retry with payment signature on 402', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        autoRetry: true,
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        nonce: 'testnonce123',
      };

      // First call returns 402, second call succeeds
      mockAxiosInstance.request
        .mockResolvedValueOnce({
          status: 402,
          headers: {
            [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { message: 'success' },
        });

      const response = await client.fetch('https://api.example.com/paid');

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
      expect(mockWalletClient.signTypedData).toHaveBeenCalled();
      expect(response.data).toEqual({ message: 'success' });
    });

    it('should call onPaymentRequired callback', async () => {
      const onPaymentRequired = vi.fn();
      const client = new X402Client({
        autoRetry: false,
        onPaymentRequired,
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow();
      expect(onPaymentRequired).toHaveBeenCalledWith(expect.objectContaining(requirement));
    });

    it('should call onPaymentSigned callback', async () => {
      const onPaymentSigned = vi.fn();
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        autoRetry: true,
        onPaymentSigned,
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        nonce: 'testnonce123',
      };

      mockAxiosInstance.request
        .mockResolvedValueOnce({
          status: 402,
          headers: {
            [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { message: 'success' },
        });

      await client.fetch('https://api.example.com/paid');
      expect(onPaymentSigned).toHaveBeenCalledWith(expect.objectContaining({
        signature: '0xmocksignature',
      }));
    });

    it('should parse payment requirement from response body if header missing', async () => {
      const client = new X402Client({ autoRetry: false });
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {},
        data: requirement,
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
    });

    it('should throw PaymentVerificationError for invalid header JSON', async () => {
      const client = new X402Client({ autoRetry: false });
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: 'not-valid-json',
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentVerificationError);
    });

    it('should throw PaymentVerificationError for missing requirement', async () => {
      const client = new X402Client({ autoRetry: false });
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {},
        data: null,
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentVerificationError);
    });

    it('should throw PaymentVerificationError for invalid requirement schema', async () => {
      const client = new X402Client({ autoRetry: false });
      
      // Valid JSON but doesn't match PaymentRequirementSchema
      const invalidRequirement = {
        amount: 'not-a-number', // Invalid: should be numeric string
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };
      
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(invalidRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentVerificationError);
    });

    it('should respect maxRetries configuration', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        autoRetry: true,
        maxRetries: 2,
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        nonce: 'testnonce123',
      };

      // Keep returning 402 - should eventually give up
      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(requirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
      // Initial request + maxRetries
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });
  });

  describe('HTTP method shortcuts', () => {
    let client: X402Client;

    beforeEach(() => {
      client = new X402Client();
      mockAxiosInstance.request.mockResolvedValue({
        status: 200,
        data: { success: true },
      });
    });

    it('should call fetch with GET method', async () => {
      await client.get('https://api.example.com/resource');
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should call fetch with POST method and data', async () => {
      await client.post('https://api.example.com/resource', { foo: 'bar' });
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', data: { foo: 'bar' } })
      );
    });

    it('should call fetch with PUT method and data', async () => {
      await client.put('https://api.example.com/resource', { foo: 'bar' });
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PUT', data: { foo: 'bar' } })
      );
    });

    it('should call fetch with DELETE method', async () => {
      await client.delete('https://api.example.com/resource');
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('signPayment', () => {
    it('should throw error if no wallet configured', async () => {
      const client = new X402Client();
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };

      await expect(client.signPayment(requirement)).rejects.toThrow(PaymentVerificationError);
    });

    it('should sign payment and return SignedPayment', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        nonce: 'testnonce123',
      };

      const signed = await client.signPayment(requirement);

      expect(signed).toHaveProperty('signature', '0xmocksignature');
      expect(signed).toHaveProperty('signer', '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123');
      expect(signed.payload).toMatchObject({
        amount: requirement.amount,
        token: requirement.token,
        chainId: 56,
        payTo: requirement.pay_to,
      });
    });

    it('should use default deadline if expires_at not provided', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        defaultDeadline: 600, // 10 minutes
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };

      const signed = await client.signPayment(requirement);

      // Deadline should be roughly now + 600 seconds
      const now = Math.floor(Date.now() / 1000);
      expect(signed.payload.deadline).toBeGreaterThanOrEqual(now + 590);
      expect(signed.payload.deadline).toBeLessThanOrEqual(now + 610);
    });

    it('should generate nonce if not provided', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });
      
      const requirement = {
        amount: '1000000000000000000',
        token: BSC_USDT.address,
        network_id: BSC_CAIP_ID,
        pay_to: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
      };

      const signed = await client.signPayment(requirement);

      expect(signed.payload.nonce).toBeDefined();
      expect(signed.payload.nonce.length).toBe(32); // generateNonce creates 32 char hex
    });
  });
});

describe('createX402Client', () => {
  it('should create X402Client instance', () => {
    const client = createX402Client();
    expect(client).toBeInstanceOf(X402Client);
  });

  it('should pass config to X402Client', () => {
    const client = createX402Client({
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });
    expect(client.canSign).toBe(true);
  });
});

describe('createX402ClientFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client with private key from environment', () => {
    process.env['X402_PRIVATE_KEY'] = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const client = createX402ClientFromEnv();
    expect(client.canSign).toBe(true);
  });

  it('should create read-only client when no private key in environment', () => {
    delete process.env['X402_PRIVATE_KEY'];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const client = createX402ClientFromEnv();
    
    expect(client.canSign).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('X402_PRIVATE_KEY not found'));
    
    warnSpy.mockRestore();
  });

  it('should merge additional config', () => {
    process.env['X402_PRIVATE_KEY'] = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const client = createX402ClientFromEnv({
      autoRetry: false,
    });
    expect(client).toBeInstanceOf(X402Client);
  });
});
