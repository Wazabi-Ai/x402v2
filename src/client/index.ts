import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import {
  createWalletClient,
  http,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { bsc, base, mainnet } from 'viem/chains';
import type { Chain } from 'viem';

import {
  type PaymentRequirement,
  type PaymentPayload,
  type SignedPayment,
  type X402ClientConfig,
  PaymentRequirementSchema,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  X402_HEADERS,
  X402_DOMAIN_NAME,
  X402_VERSION,
  PAYMENT_TYPES,
  extractChainId,
  generateNonce,
  calculateDeadline,
} from '../types/index.js';
import { ETH_CAIP_ID, ETH_DEFAULT_RPC } from '../chains/ethereum.js';
import { BSC_CAIP_ID, BSC_DEFAULT_RPC } from '../chains/bnb.js';
import { BASE_CAIP_ID, BASE_DEFAULT_RPC } from '../chains/base.js';

/** Map CAIP-2 network IDs to viem chain objects */
const CHAIN_LOOKUP: Record<string, { chain: Chain; rpc: string }> = {
  [ETH_CAIP_ID]: { chain: mainnet, rpc: ETH_DEFAULT_RPC },
  [BSC_CAIP_ID]: { chain: bsc, rpc: BSC_DEFAULT_RPC },
  [BASE_CAIP_ID]: { chain: base, rpc: BASE_DEFAULT_RPC },
};

// ============================================================================
// X402 Client Class
// ============================================================================

/**
 * X402 Client for making HTTP requests with automatic payment handling
 * 
 * @example
 * ```typescript
 * // Server-to-server with private key
 * const client = new X402Client({
 *   privateKey: '0x...',
 * });
 * 
 * // Make requests - 402 responses are handled automatically
 * const response = await client.fetch('https://api.example.com/paid-resource');
 * ```
 */
export class X402Client {
  private readonly axiosInstance: AxiosInstance;
  private readonly walletClient: WalletClient | null = null;
  private readonly account: PrivateKeyAccount | null = null;
  private readonly config: Required<Pick<X402ClientConfig, 
    'supportedNetworks' | 'defaultDeadline' | 'autoRetry' | 'maxRetries'
  >> & X402ClientConfig;

  constructor(config: X402ClientConfig = {}) {
    // Set default configuration
    this.config = {
      supportedNetworks: [BSC_CAIP_ID],
      defaultDeadline: 300, // 5 minutes
      autoRetry: true,
      maxRetries: 1,
      ...config,
    };

    // Initialize axios instance
    this.axiosInstance = axios.create({
      timeout: 30000,
      validateStatus: (status) => status < 500, // Don't throw on 402
      ...config.axiosConfig,
    });

    // Initialize wallet if private key is provided
    if (config.privateKey) {
      const normalizedKey = config.privateKey.startsWith('0x')
        ? config.privateKey as `0x${string}`
        : `0x${config.privateKey}` as `0x${string}`;

      this.account = privateKeyToAccount(normalizedKey);

      // Resolve chain from the first supported network (defaults to BSC)
      const primaryNetwork = this.config.supportedNetworks[0] ?? BSC_CAIP_ID;
      const lookup = CHAIN_LOOKUP[primaryNetwork] ?? CHAIN_LOOKUP[BSC_CAIP_ID]!;

      this.walletClient = createWalletClient({
        account: this.account,
        chain: lookup.chain,
        transport: http(config.rpcUrl ?? lookup.rpc),
      });
    }
  }

  /**
   * Get the signer address if available
   */
  get signerAddress(): `0x${string}` | null {
    return this.account?.address ?? null;
  }

  /**
   * Check if the client can sign payments
   */
  get canSign(): boolean {
    return this.account !== null;
  }

  /**
   * Make an HTTP request with automatic 402 payment handling
   */
  async fetch<T = unknown>(
    url: string,
    options: AxiosRequestConfig = {}
  ): Promise<AxiosResponse<T>> {
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= this.config.maxRetries) {
      try {
        const response = await this.axiosInstance.request<T>({
          url,
          ...options,
        });

        // Check for 402 Payment Required
        if (response.status === 402) {
          const requirement = this.parsePaymentRequirement(response);
          
          // Notify callback if configured
          if (this.config.onPaymentRequired) {
            await this.config.onPaymentRequired(requirement);
          }

          // If auto-retry is disabled, throw
          if (!this.config.autoRetry || attempts >= this.config.maxRetries) {
            throw new PaymentRequiredError(requirement);
          }

          // Check if we can sign
          if (!this.canSign) {
            throw new PaymentRequiredError(
              requirement,
              'Payment required but no signer configured. Provide a privateKey in client config.'
            );
          }

          // Check if network is supported
          if (!this.config.supportedNetworks.includes(requirement.network_id)) {
            throw new UnsupportedNetworkError(
              requirement.network_id,
              this.config.supportedNetworks
            );
          }

          // Sign the payment
          const signedPayment = await this.signPayment(requirement);

          // Notify callback if configured
          if (this.config.onPaymentSigned) {
            await this.config.onPaymentSigned(signedPayment);
          }

          // Retry with payment signature
          const retryOptions = this.addPaymentHeaders(options, signedPayment);
          attempts++;
          
          // Continue to next iteration with payment headers
          options = retryOptions;
          continue;
        }

        return response;
      } catch (error) {
        if (error instanceof PaymentRequiredError || 
            error instanceof UnsupportedNetworkError) {
          throw error;
        }
        lastError = error as Error;
        attempts++;
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  /**
   * Convenience methods for common HTTP verbs
   */
  async get<T = unknown>(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.fetch<T>(url, { ...options, method: 'GET' });
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    options?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.fetch<T>(url, { ...options, method: 'POST', data });
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    options?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.fetch<T>(url, { ...options, method: 'PUT', data });
  }

  async delete<T = unknown>(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.fetch<T>(url, { ...options, method: 'DELETE' });
  }

  /**
   * Sign a payment requirement and return the signed payment
   */
  async signPayment(requirement: PaymentRequirement): Promise<SignedPayment> {
    if (!this.walletClient || !this.account) {
      throw new PaymentVerificationError(
        'Cannot sign payment: no wallet configured'
      );
    }

    const chainId = extractChainId(requirement.network_id);
    const nonce = requirement.nonce ?? generateNonce();
    const deadline = requirement.expires_at ?? calculateDeadline(this.config.defaultDeadline);

    // Build the payment payload
    const payload: PaymentPayload = {
      amount: requirement.amount,
      token: requirement.token,
      chainId,
      payTo: requirement.pay_to,
      payer: this.account.address,
      deadline,
      nonce,
      resource: requirement.resource ?? '',
    };

    // Create EIP-712 domain
    const domain = {
      name: X402_DOMAIN_NAME,
      version: X402_VERSION,
      chainId,
    };

    // Sign the typed data
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain,
      types: PAYMENT_TYPES,
      primaryType: 'Payment',
      message: {
        amount: BigInt(payload.amount),
        token: payload.token as `0x${string}`,
        chainId: BigInt(payload.chainId),
        payTo: payload.payTo as `0x${string}`,
        payer: payload.payer as `0x${string}`,
        deadline: BigInt(payload.deadline),
        nonce: payload.nonce,
        resource: payload.resource ?? '',
      },
    });

    return {
      payload,
      signature,
      signer: this.account.address,
    };
  }

  /**
   * Parse payment requirement from 402 response
   */
  private parsePaymentRequirement(response: AxiosResponse): PaymentRequirement {
    // Try to get from header first
    const headerValue = response.headers[X402_HEADERS.PAYMENT_REQUIRED];

    let requirementData: unknown;

    if (headerValue) {
      try {
        requirementData = JSON.parse(
          typeof headerValue === 'string' ? headerValue : String(headerValue)
        );
      } catch {
        throw new PaymentVerificationError(
          'Invalid payment requirement header: failed to parse JSON'
        );
      }
    } else if (response.data && typeof response.data === 'object') {
      // Fall back to response body
      requirementData = response.data;
    } else {
      throw new PaymentVerificationError(
        'No payment requirement found in response headers or body'
      );
    }

    // Validate with Zod
    const result = PaymentRequirementSchema.safeParse(requirementData);
    if (!result.success) {
      throw new PaymentVerificationError(
        `Invalid payment requirement: ${result.error.message}`,
        { errors: result.error.errors }
      );
    }

    return result.data;
  }

  /**
   * Add payment headers to request options
   */
  private addPaymentHeaders(
    options: AxiosRequestConfig,
    payment: SignedPayment
  ): AxiosRequestConfig {
    const headers = {
      ...options.headers,
      [X402_HEADERS.PAYMENT_SIGNATURE]: payment.signature,
      [X402_HEADERS.PAYMENT_PAYLOAD]: JSON.stringify(payment.payload),
    };

    return {
      ...options,
      headers,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an X402 client with a private key for server-to-server usage
 */
export function createX402Client(config?: X402ClientConfig): X402Client {
  return new X402Client(config);
}

/**
 * Create an X402 client from environment variables
 * Looks for X402_PRIVATE_KEY in process.env
 */
export function createX402ClientFromEnv(
  config?: Omit<X402ClientConfig, 'privateKey'>
): X402Client {
  const privateKey = process.env['X402_PRIVATE_KEY'];
  
  if (!privateKey) {
    console.warn('X402_PRIVATE_KEY not found in environment. Client will be read-only.');
  }

  return new X402Client({
    ...config,
    privateKey,
  });
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
  type X402ClientConfig,
  type PaymentRequirement,
  type PaymentPayload,
  type SignedPayment,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  PaymentExpiredError,
} from '../types/index.js';

export {
  ETH_CAIP_ID,
  ETH_CHAIN_ID,
  ETH_USDC,
  ETH_USDT,
  ETH_TOKENS,
} from '../chains/ethereum.js';

export {
  BSC_CAIP_ID,
  BSC_CHAIN_ID,
  BSC_USDT,
  BSC_USDC,
  BSC_TOKENS,
} from '../chains/bnb.js';

export {
  BASE_CAIP_ID,
  BASE_CHAIN_ID,
  BASE_USDC,
  BASE_TOKENS,
} from '../chains/base.js';
