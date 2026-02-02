/**
 * Wazabi x402 Facilitator
 *
 * Non-custodial settlement relay for the x402 payment protocol.
 *
 * @packageDocumentation
 */

// Configuration
export {
  loadConfig,
  createClients,
  CHAIN_MAP,
  KNOWN_SETTLEMENTS,
  type FacilitatorEnvConfig,
} from './config.js';

// Server & routes
export { createFacilitator, startFacilitator, RateLimiter, type FacilitatorConfig } from './server.js';

// Services
export { SettlementService, SettlementError } from './services/settlement.js';
export type { SettlementConfig } from './services/settlement.js';

// Database
export { InMemoryStore, CREATE_ALL_TABLES } from './db/schema.js';

// Types
export type {
  Transaction,
  TransactionStatus,
  HistoryResponse,
  SupportedResponse,
  VerifyRequest,
} from './types.js';

export {
  SUPPORTED_NETWORK_IDS,
  VerifyRequestSchema,
  isAddress,
  calculateFee,
  calculateNet,
} from './types.js';
