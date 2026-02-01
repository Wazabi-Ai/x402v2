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
  type Permit2Payload,
  type ERC3009Payload,
  type X402ClientConfig,
  PaymentRequirementSchema,
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  X402_HEADERS,
  PERMIT2_BATCH_WITNESS_TYPES,
  ERC3009_TYPES,
  getPermit2Domain,
  getERC3009Domain,
  extractChainId,
  calculateFeeSplit,
  calculateDeadline,
  generatePermit2Nonce,
  generateBytes32Nonce,
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
 * X402 Client — signs Permit2 or ERC-3009 payment authorizations
 *
 * Handles the full x402 flow:
 * 1. Makes HTTP request to a paid resource
 * 2. Receives 402 with payment requirement (accepts array)
 * 3. Signs the appropriate authorization (Permit2 or ERC-3009)
 * 4. Retries with the signed payment in the x-payment header
 *
 * @example
 * ```typescript
 * const client = new X402Client({ privateKey: '0x...' });
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
    this.config = {
      supportedNetworks: [BASE_CAIP_ID],
      defaultDeadline: 300,
      autoRetry: true,
      maxRetries: 1,
      ...config,
    };

    this.axiosInstance = axios.create({
      timeout: 30000,
      validateStatus: (status) => status < 500,
      ...config.axiosConfig,
    });

    if (config.privateKey) {
      const normalizedKey = config.privateKey.startsWith('0x')
        ? config.privateKey as `0x${string}`
        : `0x${config.privateKey}` as `0x${string}`;

      this.account = privateKeyToAccount(normalizedKey);

      const primaryNetwork = this.config.supportedNetworks[0] ?? BASE_CAIP_ID;
      const lookup = CHAIN_LOOKUP[primaryNetwork] ?? CHAIN_LOOKUP[BASE_CAIP_ID]!;

      this.walletClient = createWalletClient({
        account: this.account,
        chain: lookup.chain,
        transport: http(config.rpcUrl ?? lookup.rpc),
      });
    }
  }

  get signerAddress(): `0x${string}` | null {
    return this.account?.address ?? null;
  }

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

        if (response.status === 402) {
          const requirement = this.parsePaymentRequirement(response);

          if (this.config.onPaymentRequired) {
            await this.config.onPaymentRequired(requirement);
          }

          if (!this.config.autoRetry || attempts >= this.config.maxRetries) {
            throw new PaymentRequiredError(requirement);
          }

          if (!this.canSign) {
            throw new PaymentRequiredError(
              requirement,
              'Payment required but no signer configured. Provide a privateKey in client config.'
            );
          }

          // Select an accept entry for a supported network
          const accept = this.selectAcceptEntry(requirement);
          if (!accept) {
            throw new UnsupportedNetworkError(
              'none',
              this.config.supportedNetworks
            );
          }

          // Sign the payment
          const payment = await this.signPayment(accept);

          if (this.config.onPaymentSigned) {
            await this.config.onPaymentSigned(payment);
          }

          // Retry with payment in x-payment header
          options = {
            ...options,
            headers: {
              ...options.headers,
              [X402_HEADERS.PAYMENT]: JSON.stringify(payment),
            },
          };
          attempts++;
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
   * Select the best accept entry from a payment requirement.
   * Prefers erc3009 (no Permit2 approval needed), falls back to permit2.
   */
  private selectAcceptEntry(
    requirement: PaymentRequirement
  ): PaymentRequirement['accepts'][0] | null {
    const supported = requirement.accepts.filter(a =>
      this.config.supportedNetworks.includes(a.network)
    );
    if (supported.length === 0) return null;

    // Prefer erc3009 (no Permit2 approval needed for USDC)
    const erc3009 = supported.find(a => a.scheme === 'erc3009');
    if (erc3009) return erc3009;

    return supported.find(a => a.scheme === 'permit2') ?? null;
  }

  /**
   * Sign a payment authorization for a specific accept entry.
   * Returns a Permit2Payload or ERC3009Payload depending on scheme.
   */
  async signPayment(
    accept: PaymentRequirement['accepts'][0]
  ): Promise<PaymentPayload> {
    if (!this.walletClient || !this.account) {
      throw new PaymentVerificationError('Cannot sign payment: no wallet configured');
    }

    if (accept.scheme === 'erc3009') {
      return this.signERC3009(accept);
    }
    return this.signPermit2(accept);
  }

  /**
   * Sign a Permit2 batch witness authorization.
   *
   * The payer signs a PermitBatchWitnessTransferFrom with:
   *   permitted[0] = { token, netAmount }   → goes to recipient
   *   permitted[1] = { token, feeAmount }   → goes to treasury
   *   witness = { recipient, feeBps }        → committed in signature
   */
  private async signPermit2(
    accept: PaymentRequirement['accepts'][0]
  ): Promise<Permit2Payload> {
    const chainId = extractChainId(accept.network);
    const grossAmount = BigInt(accept.amount);
    const { net, fee } = calculateFeeSplit(grossAmount, accept.feeBps);

    const nonce = generatePermit2Nonce();
    const deadline = Math.min(
      calculateDeadline(this.config.defaultDeadline),
      accept.maxDeadline
    );

    const permit = {
      permitted: [
        { token: accept.token, amount: net.toString() },
        { token: accept.token, amount: fee.toString() },
      ],
      nonce,
      deadline,
    };

    const witness = {
      recipient: accept.recipient,
      feeBps: accept.feeBps,
    };

    const domain = getPermit2Domain(chainId);

    const signature = await this.walletClient!.signTypedData({
      account: this.account!,
      domain,
      types: PERMIT2_BATCH_WITNESS_TYPES,
      primaryType: 'PermitBatchWitnessTransferFrom',
      message: {
        permitted: [
          { token: accept.token as `0x${string}`, amount: net },
          { token: accept.token as `0x${string}`, amount: fee },
        ],
        spender: accept.settlement as `0x${string}`,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
        witness: {
          recipient: accept.recipient as `0x${string}`,
          feeBps: BigInt(accept.feeBps),
        },
      },
    });

    return {
      scheme: 'permit2',
      network: accept.network,
      permit,
      witness,
      spender: accept.settlement,
      payer: this.account!.address,
      signature,
    };
  }

  /**
   * Sign an ERC-3009 transferWithAuthorization.
   *
   * The payer signs a transferWithAuthorization to the settlement contract
   * for the gross amount. The contract splits net→recipient, fee→treasury.
   */
  private async signERC3009(
    accept: PaymentRequirement['accepts'][0]
  ): Promise<ERC3009Payload> {
    const chainId = extractChainId(accept.network);
    const grossAmount = BigInt(accept.amount);
    const nonce = generateBytes32Nonce();
    const validAfter = 0;
    const validBefore = Math.min(
      calculateDeadline(this.config.defaultDeadline),
      accept.maxDeadline
    );

    const domain = getERC3009Domain(
      accept.token as `0x${string}`,
      'USD Coin',
      chainId
    );

    const signature = await this.walletClient!.signTypedData({
      account: this.account!,
      domain,
      types: ERC3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: this.account!.address,
        to: accept.settlement as `0x${string}`,
        value: grossAmount,
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce: nonce as `0x${string}`,
      },
    });

    return {
      scheme: 'erc3009',
      network: accept.network,
      authorization: {
        from: this.account!.address,
        to: accept.settlement,
        value: grossAmount.toString(),
        validAfter,
        validBefore,
        nonce,
      },
      recipient: accept.recipient,
      payer: this.account!.address,
      signature,
    };
  }

  /**
   * Parse payment requirement from 402 response
   */
  private parsePaymentRequirement(response: AxiosResponse): PaymentRequirement {
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
      requirementData = response.data;
    } else {
      throw new PaymentVerificationError(
        'No payment requirement found in response headers or body'
      );
    }

    const result = PaymentRequirementSchema.safeParse(requirementData);
    if (!result.success) {
      throw new PaymentVerificationError(
        `Invalid payment requirement: ${result.error.message}`,
        { errors: result.error.errors }
      );
    }

    return result.data;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createX402Client(config?: X402ClientConfig): X402Client {
  return new X402Client(config);
}

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
  type Permit2Payload,
  type ERC3009Payload,
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
