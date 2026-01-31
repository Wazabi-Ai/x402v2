#!/usr/bin/env node
/**
 * Standalone Wazabi x402 Facilitator Server
 *
 * Starts the facilitator API with the portal dashboard at root.
 * Requires all environment variables to be set — will not start without them.
 *
 * Required environment variables:
 *   TREASURY_PRIVATE_KEY — Treasury wallet private key
 *   ACCOUNT_FACTORY_BSC  — WazabiAccountFactory on BNB Chain
 *   ACCOUNT_FACTORY_BASE — WazabiAccountFactory on Base
 *   PAYMASTER_BSC        — Paymaster address on BNB Chain
 *   PAYMASTER_BASE       — Paymaster address on Base
 *   BUNDLER_URL_BSC      — ERC-4337 bundler URL for BNB Chain
 *   BUNDLER_URL_BASE     — ERC-4337 bundler URL for Base
 *
 * Optional environment variables:
 *   PORT                 — Server port (default: 3000)
 *   PORTAL_DIR           — Path to portal static files (default: ./facilitator-portal)
 *   RPC_BSC              — BNB Chain RPC URL (default: public endpoint)
 *   RPC_BASE             — Base RPC URL (default: public endpoint)
 *   DATABASE_URL         — PostgreSQL connection string (default: in-memory)
 */

import { resolve } from 'node:path';
import { startFacilitator } from '../facilitator/index.js';
import { loadConfig, createClients } from '../facilitator/config.js';

const config = loadConfig();
const { publicClients, walletClients } = createClients(config);

const portalDir = resolve(config.portalDir || process.env['PORTAL_DIR'] || 'facilitator-portal');

startFacilitator(config.port, {
  portalDir,
  treasuryAddress: config.treasuryAddress,
  publicClients,
  walletClients,
});
