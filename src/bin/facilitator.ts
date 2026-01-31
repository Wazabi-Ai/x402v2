#!/usr/bin/env node
/**
 * Standalone Wazabi x402 Facilitator Server
 *
 * Starts the facilitator API with the portal dashboard at root.
 * When TREASURY_PRIVATE_KEY and contract addresses are set, starts in
 * live mode with real viem clients. Otherwise falls back to demo mode.
 *
 * Environment variables:
 *   PORT                 — Server port (default: 3000)
 *   PORTAL_DIR           — Path to portal static files (default: ./facilitator-portal)
 *   TREASURY_PRIVATE_KEY — Treasury wallet private key (enables live mode)
 *   ACCOUNT_FACTORY_BSC  — WazabiAccountFactory on BNB Chain
 *   ACCOUNT_FACTORY_BASE — WazabiAccountFactory on Base
 *   PAYMASTER_BSC        — Paymaster address on BNB Chain
 *   PAYMASTER_BASE       — Paymaster address on Base
 *   RPC_BSC              — BNB Chain RPC URL
 *   RPC_BASE             — Base RPC URL
 */

import { resolve } from 'node:path';
import { startFacilitator } from '../facilitator/index.js';
import { loadConfigSafe, createClients } from '../facilitator/config.js';

const config = loadConfigSafe();
const { publicClients, walletClients } = createClients(config);

const portalDir = resolve(config.portalDir || process.env['PORTAL_DIR'] || 'facilitator-portal');

startFacilitator(config.port, {
  portalDir,
  treasuryAddress: config.treasuryAddress,
  publicClients,
  walletClients,
});
