#!/usr/bin/env node
/**
 * Standalone Wazabi x402 Facilitator Server
 *
 * Starts the facilitator API with the portal dashboard at root.
 *
 * Environment variables:
 *   PORT       — Server port (default: 3000)
 *   PORTAL_DIR — Path to portal static files (default: ./facilitator-portal)
 */

import { resolve } from 'node:path';
import { startFacilitator } from '../facilitator/index.js';

const port = parseInt(process.env['PORT'] || '3000', 10);
const portalDir = resolve(process.env['PORTAL_DIR'] || 'facilitator-portal');

startFacilitator(port, { portalDir });
