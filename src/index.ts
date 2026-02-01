/**
 * @wazabiai/x402 - x402 v2 Payment Protocol SDK for Ethereum, BNB Smart Chain & Base
 *
 * Open protocol for internet-native payments using HTTP 402.
 * Non-custodial settlement via Permit2 and ERC-3009.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * // Client usage
 * import { X402Client } from '@wazabiai/x402/client';
 *
 * const client = new X402Client({
 *   privateKey: process.env.PRIVATE_KEY,
 * });
 *
 * const response = await client.fetch('https://api.example.com/paid-resource');
 * ```
 *
 * @example
 * ```typescript
 * // Server usage
 * import express from 'express';
 * import { x402Middleware } from '@wazabiai/x402/server';
 *
 * const app = express();
 *
 * app.use('/api/paid', x402Middleware({
 *   recipientAddress: '0x...',
 *   amount: '1000000000000000000',
 * }));
 * ```
 *
 * @example
 * ```typescript
 * // Facilitator usage (settlement relay)
 * import { startFacilitator } from '@wazabiai/x402/facilitator';
 *
 * startFacilitator(3000);
 * // Now serving: /x402/settle, /verify, /history, /supported, /skill.md
 * ```
 */

// Re-export everything from types
export * from './types/index.js';

// Re-export everything from chains
export * from './chains/index.js';

// Re-export client
export { X402Client, createX402Client, createX402ClientFromEnv } from './client/index.js';

// Re-export server
export {
  x402Middleware,
  createPaymentRequirement,
  parsePaymentFromRequest,
  type X402Request,
} from './server/index.js';

// Re-export facilitator
export {
  createFacilitator,
  startFacilitator,
  SettlementService,
  InMemoryStore,
} from './facilitator/index.js';
