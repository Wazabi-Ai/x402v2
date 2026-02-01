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
import { BASE_CAIP_ID, BASE_USDC } from '../src/chains/base.js';

// ============================================================================
// Valid payment requirement with new accepts format
// ============================================================================

const validRequirement = {
  x402Version: '2.0.0',
  accepts: [{
    scheme: 'permit2' as const,
    network: BASE_CAIP_ID,
    token: BASE_USDC.address,
    amount: '1000000',
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    settlement: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    treasury: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
    feeBps: 50,
    maxDeadline: Math.floor(Date.now() / 1000) + 300,
  }],
};

const unsupportedNetworkRequirement = {
  x402Version: '2.0.0',
  accepts: [{
    scheme: 'permit2' as const,
    network: 'eip155:1',
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amount: '1000000',
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
    settlement: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    treasury: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
    feeBps: 50,
    maxDeadline: Math.floor(Date.now() / 1000) + 300,
  }],
};

describe('X402Client', () => {
  let mockAxiosInstance: { request: Mock };
  let mockWalletClient: { signTypedData: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockAxiosInstance = {
      request: vi.fn(),
    };

    mockWalletClient = {
      signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
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

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
    });

    it('should throw PaymentRequiredError when no signer configured', async () => {
      const client = new X402Client({ autoRetry: true });

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
    });

    it('should throw UnsupportedNetworkError for unsupported network', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        supportedNetworks: ['eip155:56'],
      });

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(unsupportedNetworkRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(UnsupportedNetworkError);
    });

    it('should retry with payment in x-payment header on 402', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        autoRetry: true,
      });

      mockAxiosInstance.request
        .mockResolvedValueOnce({
          status: 402,
          headers: {
            [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
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

      // Second call should include x-payment header with PaymentPayload JSON
      const secondCall = mockAxiosInstance.request.mock.calls[1]![0];
      expect(secondCall.headers[X402_HEADERS.PAYMENT]).toBeDefined();
      const payment = JSON.parse(secondCall.headers[X402_HEADERS.PAYMENT]);
      expect(payment.scheme).toBe('permit2');
      expect(payment.network).toBe(BASE_CAIP_ID);
    });

    it('should call onPaymentRequired callback', async () => {
      const onPaymentRequired = vi.fn();
      const client = new X402Client({
        autoRetry: false,
        onPaymentRequired,
      });

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow();
      expect(onPaymentRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: '2.0.0',
          accepts: expect.arrayContaining([
            expect.objectContaining({ scheme: 'permit2', network: BASE_CAIP_ID }),
          ]),
        })
      );
    });

    it('should call onPaymentSigned callback', async () => {
      const onPaymentSigned = vi.fn();
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        autoRetry: true,
        onPaymentSigned,
      });

      mockAxiosInstance.request
        .mockResolvedValueOnce({
          status: 402,
          headers: {
            [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { message: 'success' },
        });

      await client.fetch('https://api.example.com/paid');
      expect(onPaymentSigned).toHaveBeenCalledWith(
        expect.objectContaining({
          scheme: 'permit2',
          network: BASE_CAIP_ID,
          signature: expect.any(String),
        })
      );
    });

    it('should parse payment requirement from response body if header missing', async () => {
      const client = new X402Client({ autoRetry: false });

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {},
        data: validRequirement,
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

      const invalidRequirement = {
        x402Version: '2.0.0',
        accepts: [{
          scheme: 'permit2',
          network: 'invalid-network',
          token: '0x123',
          amount: 'not-a-number',
        }],
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

      mockAxiosInstance.request.mockResolvedValue({
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: JSON.stringify(validRequirement),
        },
      });

      await expect(client.fetch('https://api.example.com/paid')).rejects.toThrow(PaymentRequiredError);
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
      const accept = validRequirement.accepts[0]!;
      await expect(client.signPayment(accept)).rejects.toThrow(PaymentVerificationError);
    });

    it('should sign Permit2 payment and return PaymentPayload', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });

      const accept = validRequirement.accepts[0]!;
      const payload = await client.signPayment(accept);

      expect(payload.scheme).toBe('permit2');
      expect(payload.network).toBe(BASE_CAIP_ID);
      expect(payload.payer).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f4b123');
      expect(payload.signature).toBeDefined();
      expect(mockWalletClient.signTypedData).toHaveBeenCalled();

      if (payload.scheme === 'permit2') {
        expect(payload.permit.permitted).toHaveLength(2);
        expect(payload.witness.recipient).toBe(accept.recipient);
        expect(payload.witness.feeBps).toBe(accept.feeBps);
        expect(payload.spender).toBe(accept.settlement);
      }
    });

    it('should sign ERC-3009 payment when scheme is erc3009', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });

      const erc3009Accept = {
        scheme: 'erc3009' as const,
        network: BASE_CAIP_ID,
        token: BASE_USDC.address,
        amount: '1000000',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4b123',
        settlement: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        treasury: '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB',
        feeBps: 50,
        maxDeadline: Math.floor(Date.now() / 1000) + 300,
      };

      const payload = await client.signPayment(erc3009Accept);

      expect(payload.scheme).toBe('erc3009');
      expect(payload.network).toBe(BASE_CAIP_ID);
      expect(payload.signature).toBeDefined();

      if (payload.scheme === 'erc3009') {
        expect(payload.authorization.from).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f4b123');
        expect(payload.authorization.to).toBe(erc3009Accept.settlement);
        expect(payload.authorization.value).toBe(erc3009Accept.amount);
        expect(payload.recipient).toBe(erc3009Accept.recipient);
      }
    });

    it('should split amount into net and fee for Permit2', async () => {
      const client = new X402Client({
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });

      const accept = validRequirement.accepts[0]!;
      const payload = await client.signPayment(accept);

      if (payload.scheme === 'permit2') {
        const net = BigInt(payload.permit.permitted[0]!.amount);
        const fee = BigInt(payload.permit.permitted[1]!.amount);
        const gross = BigInt(accept.amount);
        expect(net + fee).toBe(gross);
        expect(fee).toBe(gross * BigInt(accept.feeBps) / BigInt(10000));
      }
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
