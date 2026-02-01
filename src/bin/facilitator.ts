#!/usr/bin/env node
/**
 * Standalone Wazabi x402 Facilitator Server
 *
 * Non-custodial settlement relay for the x402 payment protocol.
 * Requires TREASURY_PRIVATE_KEY to be set.
 *
 * Required environment variables:
 *   TREASURY_PRIVATE_KEY — Treasury wallet private key (pays gas, receives fees)
 *
 * Optional environment variables:
 *   SETTLEMENT_ETH       — WazabiSettlement address on Ethereum
 *   SETTLEMENT_BSC       — WazabiSettlement address on BNB Chain
 *   SETTLEMENT_BASE      — WazabiSettlement address on Base
 *   RPC_ETH              — Ethereum RPC URL (default: public endpoint)
 *   RPC_BSC              — BNB Chain RPC URL (default: public endpoint)
 *   RPC_BASE             — Base RPC URL (default: public endpoint)
 *   PORT                 — Server port (default: 3000)
 *   PORTAL_DIR           — Path to portal static files (default: ./facilitator-portal)
 */

import { resolve } from 'node:path';
import { startFacilitator } from '../facilitator/index.js';
import { loadConfig, createClients } from '../facilitator/config.js';

const config = loadConfig();
const { publicClients, walletClients } = createClients(config);

const portalDir = resolve(config.portalDir || 'facilitator-portal');

startFacilitator(config.port, {
  portalDir,
  treasuryAddress: config.treasuryAddress,
  settlementAddresses: config.settlementAddresses,
  publicClients,
  walletClients,
});
