/**
 * Wazabi x402 Facilitator
 *
 * The Agent Financial Platform — identity, wallets, and payments
 * for the agent economy.
 *
 * @packageDocumentation
 */

// Server & routes
export { createFacilitator, startFacilitator, type FacilitatorConfig } from './server.js';

// Services
export { HandleService, HandleError } from './services/handle.js';
export { SettlementService, SettlementError } from './services/settlement.js';
export {
  WalletService,
  ENTRYPOINT_ADDRESS,
  WAZABI_ACCOUNT_FACTORY,
  WAZABI_PAYMASTERS,
  WAZABI_TREASURY,
} from './services/wallet.js';

// Database
export { InMemoryStore, CREATE_ALL_TABLES } from './db/schema.js';

// Types
export type {
  RegisterRequest,
  RegisterResponse,
  Agent,
  AgentBalance,
  Transaction,
  TransactionStatus,
  ResolveResponse,
  BalanceResponse,
  HistoryResponse,
  ProfileResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
} from './types.js';

export {
  HANDLE_SUFFIX,
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_FEE_BPS,
  AGENT_SUPPORTED_NETWORKS,
  RegisterRequestSchema,
  SettleRequestSchema,
  HandleSchema,
  toFullHandle,
  toShortHandle,
  isFullHandle,
  isAddress,
  calculateFee,
  calculateNet,
} from './types.js';
