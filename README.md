# @wazabiai/x402

<div align="center">

**Payment Rails for the Agent Economy**

x402 Protocol SDK with Identity, ERC-4337 Wallets & Settlement

[![npm version](https://img.shields.io/npm/v/@wazabiai/x402)](https://www.npmjs.com/package/@wazabiai/x402)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Modules](#modules)
  - [Client](#client)
  - [Server](#server)
  - [Types](#types)
  - [Chains](#chains)
  - [Facilitator](#facilitator)
- [Protocol Specification](#protocol-specification)
- [Smart Contracts](#smart-contracts)
- [Configuration](#configuration)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

The x402 protocol standardizes crypto payments over HTTP using the `402 Payment Required` status code. It enables seamless pay-per-use APIs, premium content access, and agent-to-agent payments on the blockchain.

**How it works:**

1. Client requests a protected resource
2. Server responds `402` with payment details in `X-PAYMENT-REQUIRED` header
3. Client signs an EIP-712 typed data payload with their private key
4. Client retries the request with `X-PAYMENT-SIGNATURE` and `X-PAYMENT-PAYLOAD` headers
5. Server verifies the signature and serves the resource

The SDK provides both sides of this flow (client + server middleware), plus a full-featured **Facilitator** service that adds agent identity (handles), ERC-4337 smart wallets, and on-chain settlement with fee collection.

---

## Architecture

```
@wazabiai/x402
├── types       Core protocol types, Zod schemas, error classes
├── client      HTTP client with automatic 402 handling
├── server      Express middleware for payment verification
├── chains      Network configs (BNB Chain, Base)
└── facilitator Agent Financial Platform
    ├── Handle service     Identity & registration
    ├── Wallet service     ERC-4337 smart wallets
    ├── Settlement service On-chain payments + 0.5% fee
    └── InMemoryStore      Development data store
```

Each module is a separate entry point and can be imported independently for tree-shaking:

```typescript
import { X402Client }       from '@wazabiai/x402/client';
import { x402Middleware }   from '@wazabiai/x402/server';
import type { TokenConfig } from '@wazabiai/x402/types';
import { BSC_USDT }         from '@wazabiai/x402/chains';
import { startFacilitator } from '@wazabiai/x402/facilitator';
```

**Build output:** ESM + CommonJS with TypeScript declarations, bundled via `tsup`.

---

## Installation

```bash
npm install @wazabiai/x402
```

**Peer dependencies:**

```bash
npm install viem           # Required (crypto, signing, chain interaction)
npm install express        # Required only if using server middleware or facilitator
```

**Node.js requirement:** >= 18.0.0

---

## Quick Start

### Client -- Make paid API calls

```typescript
import { X402Client } from '@wazabiai/x402/client';

const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
});

// 402 responses are detected and handled automatically
const response = await client.fetch('https://api.example.com/premium-data');
console.log(response.data);
```

### Server -- Protect routes with payment

```typescript
import express from 'express';
import { x402Middleware } from '@wazabiai/x402/server';
import { BSC_USDT, parseTokenAmount } from '@wazabiai/x402/chains';

const app = express();

app.use('/api/paid', x402Middleware({
  recipientAddress: '0xYourWalletAddress',
  amount: parseTokenAmount('0.10', BSC_USDT.address).toString(),
  tokenAddress: BSC_USDT.address,
  description: 'Access to premium API',
}));

app.get('/api/paid/data', (req, res) => {
  res.json({ premium: 'content' });
});

app.listen(3000);
```

---

## Modules

### Client

**Import:** `@wazabiai/x402/client`

The client automatically detects `402 Payment Required` responses, signs the payment, and retries with the appropriate headers.

#### Constructor

```typescript
const client = new X402Client({
  // Signing key (hex string, with or without 0x prefix)
  privateKey?: string;

  // RPC URL (resolved from supportedNetworks by default)
  rpcUrl?: string;

  // Networks this client will accept payments on
  // Default: ['eip155:56']
  supportedNetworks?: string[];

  // Payment deadline in seconds (default: 300)
  defaultDeadline?: number;

  // Automatically retry on 402 (default: true)
  autoRetry?: boolean;

  // Max retry attempts (default: 1)
  maxRetries?: number;

  // Callbacks
  onPaymentRequired?: (requirement: PaymentRequirement) => void;
  onPaymentSigned?: (payment: SignedPayment) => void;
});
```

#### Methods

```typescript
// Generic fetch with auto 402 handling
await client.fetch(url, options?);

// HTTP verb shortcuts
await client.get(url, options?);
await client.post(url, data, options?);
await client.put(url, data, options?);
await client.delete(url, options?);

// Manual payment signing
const signedPayment = await client.signPayment(requirement);
```

#### Factory functions

```typescript
import { createX402Client, createX402ClientFromEnv } from '@wazabiai/x402/client';

// Explicit config
const client = createX402Client({ privateKey: '0x...' });

// Reads X402_PRIVATE_KEY from process.env
const client = createX402ClientFromEnv();
```

#### Error classes

```typescript
import {
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  PaymentExpiredError,
} from '@wazabiai/x402/client';
```

---

### Server

**Import:** `@wazabiai/x402/server`

Express middleware that intercepts requests and enforces payment. Includes replay protection via an in-memory nonce registry.

#### Middleware

```typescript
import { x402Middleware, type X402Request } from '@wazabiai/x402/server';

const middleware = x402Middleware({
  // Required
  recipientAddress: '0x...',
  amount: '1000000000000000000',    // smallest token unit

  // Optional
  tokenAddress?: string;             // Default: BSC USDT
  networkId?: string;                // Default: 'eip155:56'
  facilitatorUrl?: string;           // Delegate verification to facilitator
  description?: string;              // Human-readable description
  deadlineDuration?: number;         // Seconds (default: 300)
  excludeRoutes?: string[];          // Paths to skip (e.g. ['/health'])
  verifyPayment?: (payment, req) => Promise<boolean>; // Custom check
  onError?: (error, req, res) => void;
});
```

Verified requests have payment info attached:

```typescript
app.get('/api/paid/data', (req: X402Request, res) => {
  console.log(req.x402?.signer);   // payer address
  console.log(req.x402?.verified); // true
});
```

#### Utility functions

```typescript
import {
  createPaymentRequirement,
  verifyPayment,
  parsePaymentFromRequest,
} from '@wazabiai/x402/server';

// Build a 402 requirement manually
const requirement = createPaymentRequirement({
  recipientAddress: '0x...',
  amount: '100000',
  resource: '/api/resource',
});

// Verify a signed payment independently
const result = await verifyPayment(signedPayment, recipientAddress, networkId);

// Extract payment from Express request headers
const payment = parsePaymentFromRequest(req);
```

#### Replay protection

The server maintains an in-memory `NonceRegistry` with a 10-minute TTL. Each nonce is accepted exactly once. For production at scale, replace with Redis SET + TTL.

---

### Types

**Import:** `@wazabiai/x402/types`

Core protocol types, Zod schemas for runtime validation, error classes, and utility functions.

#### Key types

| Type | Description |
|------|-------------|
| `PaymentRequirement` | What the server asks for (amount, token, network, recipient, deadline) |
| `PaymentPayload` | What the client signs (EIP-712 typed data) |
| `SignedPayment` | Payload + signature + signer address |
| `PaymentVerificationResult` | Verification outcome (valid/invalid + error) |
| `NetworkConfig` | Chain configuration (RPC, tokens, explorer) |
| `TokenConfig` | Token details (address, symbol, decimals) |
| `X402ClientConfig` | Client constructor options |
| `X402MiddlewareConfig` | Server middleware options |

#### Zod schemas

```typescript
import {
  PaymentPayloadSchema,
  SignedPaymentSchema,
  PaymentRequirementSchema,
} from '@wazabiai/x402/types';

// Runtime validation
const result = PaymentPayloadSchema.safeParse(untrustedInput);
if (result.success) {
  const payload: PaymentPayload = result.data;
}
```

#### Constants

```typescript
import {
  X402_VERSION,       // '2.0.0'
  X402_DOMAIN_NAME,   // 'x402'
  X402_HEADERS,       // { PAYMENT_REQUIRED, PAYMENT_SIGNATURE, PAYMENT_PAYLOAD }
  PAYMENT_TYPES,      // EIP-712 type definitions
} from '@wazabiai/x402/types';
```

#### Utilities

```typescript
import {
  generateNonce,      // Cryptographically secure random hex (node:crypto)
  calculateDeadline,  // Unix timestamp + duration in seconds
  extractChainId,     // 'eip155:56' -> 56
  createCaipId,       // 56 -> 'eip155:56'
} from '@wazabiai/x402/types';
```

---

### Chains

**Import:** `@wazabiai/x402/chains`

Network and token configurations for all supported chains.

#### Supported networks

| Network | CAIP-2 ID | Chain ID | Tokens | Token Decimals |
|---------|-----------|----------|--------|----------------|
| BNB Chain | `eip155:56` | 56 | USDT, USDC, BUSD, WBNB | 18 |
| Base | `eip155:8453` | 8453 | USDC (native) | 6 |

#### BNB Chain

```typescript
import {
  BSC_CHAIN_ID,         // 56
  BSC_CAIP_ID,          // 'eip155:56'
  BSC_USDT,             // TokenConfig { address, symbol, decimals: 18, name }
  BSC_USDC,             // TokenConfig
  BSC_BUSD,             // TokenConfig
  BSC_WBNB,             // TokenConfig
  BSC_TOKENS,           // Record of all BSC tokens
  BSC_DEFAULT_RPC,      // 'https://bsc-dataseed.binance.org'
  formatTokenAmount,    // bigint -> '1.50'
  parseTokenAmount,     // '1.50' -> bigint
  getTokenByAddress,
  getTokenBySymbol,
  getTxUrl,             // txHash -> BscScan URL
  getAddressUrl,        // address -> BscScan URL
} from '@wazabiai/x402/chains';
```

#### Base

```typescript
import {
  BASE_CHAIN_ID,            // 8453
  BASE_CAIP_ID,             // 'eip155:8453'
  BASE_USDC,                // TokenConfig { address, decimals: 6 }
  BASE_TOKENS,
  BASE_DEFAULT_RPC,         // 'https://mainnet.base.org'
  formatBaseTokenAmount,
  parseBaseTokenAmount,
  getBaseTokenByAddress,
  getBaseTokenBySymbol,
  getBaseTxUrl,
  getBaseAddressUrl,
} from '@wazabiai/x402/chains';
```

#### Registry

```typescript
import {
  SUPPORTED_NETWORKS,       // Record<string, NetworkConfig>
  getNetworkConfig,         // CAIP-2 ID -> NetworkConfig
  isNetworkSupported,       // CAIP-2 ID -> boolean
  getSupportedNetworkIds,   // string[]
  getTokenForNetwork,       // (caipId, symbol) -> TokenConfig
} from '@wazabiai/x402/chains';
```

---

### Facilitator

**Import:** `@wazabiai/x402/facilitator`

The Facilitator extends the SDK into a complete Agent Financial Platform. It provides:

- **Identity** -- Human-readable handles (e.g. `molty.wazabi-x402`)
- **Wallets** -- ERC-4337 smart wallets with session keys, deterministic across all chains
- **Settlement** -- On-chain ERC-20 transfers with 0.5% fee collection
- **History** -- Transaction tracking with pagination

#### Start standalone server

```typescript
import { startFacilitator } from '@wazabiai/x402/facilitator';

startFacilitator(3000);
```

Or via CLI:

```bash
x402-facilitator
```

#### Mount on existing Express app

```typescript
import express from 'express';
import { createFacilitator } from '@wazabiai/x402/facilitator';

const app = express();
app.use(express.json());
createFacilitator(app);
app.listen(3000);
```

#### API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /register` | Register an agent handle + deploy ERC-4337 wallet |
| `GET /resolve/:handle` | Resolve handle to wallet address |
| `GET /balance/:handle` | Token balances across all networks |
| `GET /history/:handle` | Transaction history with pagination |
| `GET /profile/:handle` | Full agent profile |
| `POST /verify` | Verify an x402 payment signature |
| `POST /settle` | Execute payment with 0.5% fee |
| `GET /supported` | List supported networks, tokens, and schemes |
| `GET /health` | Health check |
| `GET /skill.md` | OpenClaw-compatible skill file |

#### Register an agent

```http
POST /register
Content-Type: application/json

{
  "handle": "molty",
  "networks": ["eip155:56", "eip155:8453"]
}
```

Response:

```json
{
  "handle": "molty.wazabi-x402",
  "wallet": {
    "address": "0x7A3b...F9c2",
    "type": "ERC-4337",
    "deployed": { "eip155:56": false, "eip155:8453": false }
  },
  "session_key": {
    "public": "0xABC...",
    "private": "0xDEF...",
    "expires": "2027-01-30T00:00:00Z"
  }
}
```

The session key private key is returned only once at registration. The wallet address is deterministic via CREATE2 and identical on all supported chains.

#### Handle format

- Pattern: `<name>.wazabi-x402`
- Name rules: 3-50 characters, lowercase alphanumeric, hyphens and underscores allowed
- Regex: `^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$`
- Reserved words are blocked (admin, wazabi, system, root, api, etc.)

#### Settle a payment

```http
POST /settle
Content-Type: application/json

{
  "from": "molty",
  "to": "agent-b",
  "amount": "100.00",
  "token": "USDC",
  "network": "eip155:8453"
}
```

Response:

```json
{
  "success": true,
  "tx_hash": "0xABC123...",
  "settlement": {
    "gross": "100.00",
    "fee": "0.50",
    "gas": "0.02",
    "net": "99.48"
  },
  "from": "molty.wazabi-x402",
  "to": "agent-b.wazabi-x402",
  "network": "eip155:8453"
}
```

Settlement accepts both registered handles and raw Ethereum addresses. Registration is not required -- any valid address can use `/settle` and `/verify`. Registered agents get additional benefits (handles, gasless UX, history tracking).

#### Fee schedule

| Parameter | Value |
|-----------|-------|
| Settlement fee | 0.5% (50 bps) |
| Fee collection | Retained in treasury wallet |
| Gas estimate | Fixed at $0.02 (dynamic estimation planned) |

#### Services

```typescript
import {
  HandleService,
  WalletService,
  SettlementService,
  InMemoryStore,
} from '@wazabiai/x402/facilitator';
```

Services can be used programmatically outside of the HTTP server for custom integrations.

---

## Protocol Specification

### HTTP headers

| Header | Direction | Content |
|--------|-----------|---------|
| `x-payment-required` | Server -> Client | JSON `PaymentRequirement` |
| `x-payment-signature` | Client -> Server | EIP-712 hex signature |
| `x-payment-payload` | Client -> Server | JSON `PaymentPayload` |

### EIP-712 domain

```typescript
{
  name: 'x402',
  version: '2.0.0',
  chainId: number  // e.g. 56 for BSC, 8453 for Base
}
```

### EIP-712 Payment type

```typescript
Payment: [
  { name: 'amount',   type: 'uint256' },
  { name: 'token',    type: 'address' },
  { name: 'chainId',  type: 'uint256' },
  { name: 'payTo',    type: 'address' },
  { name: 'payer',    type: 'address' },
  { name: 'deadline', type: 'uint256' },
  { name: 'nonce',    type: 'string'  },
  { name: 'resource', type: 'string'  },
]
```

### Verification flow

1. Parse `X-PAYMENT-PAYLOAD` header as JSON
2. Validate against `PaymentPayloadSchema` (Zod)
3. Check deadline has not passed
4. Check chain ID matches expected network
5. Check recipient matches expected address
6. Verify EIP-712 signature using `viem.verifyTypedData()`
7. Check nonce has not been used (replay protection)
8. Check amount meets minimum requirement
9. Attach verified payment info to request and call `next()`

---

## Smart Contracts

Three Solidity contracts are included in `contracts/`. These are designed for ERC-4337 Account Abstraction and require deployment before the facilitator can create on-chain wallets.

| Contract | File | Purpose |
|----------|------|---------|
| **WazabiAccount** | `WazabiAccount.sol` | ERC-4337 smart wallet with session key support, spending limits, batch execution |
| **WazabiAccountFactory** | `WazabiAccountFactory.sol` | CREATE2 factory for deterministic wallet addresses across chains |
| **WazabiPaymaster** | `WazabiPaymaster.sol` | Verifying paymaster that sponsors gas in exchange for ERC-20 tokens |

### WazabiAccount

- Owner + session key authorization model
- Per-session-key spending limits (per-transaction and daily)
- `execute()` and `executeBatch()` for arbitrary calls
- Session key management (add, revoke, check validity)
- EIP-4337 `_validateSignature()` integration

### WazabiAccountFactory

- CREATE2 deployment for address determinism
- ERC-1967 proxy pattern (upgradeable)
- Handle-to-account mapping
- Counterfactual address computation (`getAddress()`)

### WazabiPaymaster

- Pre-execution: validates token balance and allowance
- Post-execution: deducts gas cost equivalent in ERC-20 tokens
- Configurable token support with price ratios
- Admin controls for token management and fund withdrawal

### Deployment

A deployment script is provided at `scripts/deploy.ts`. Contract compilation uses Hardhat:

```bash
npx hardhat compile
```

> **Note:** Contract deployment is a separate step that requires wallet access and is not part of the SDK build. The contracts are not yet audited for production use.

---

## Configuration

### Environment variables

Copy `.env.example` to `.env` and configure:

```bash
# === REQUIRED (for facilitator) ===

# Treasury wallet private key (hex, with or without 0x prefix)
TREASURY_PRIVATE_KEY=0x_your_treasury_private_key

# Deployed contract addresses per network
ACCOUNT_FACTORY_BSC=0x...
ACCOUNT_FACTORY_BASE=0x...
PAYMASTER_BSC=0x...
PAYMASTER_BASE=0x...

# ERC-4337 Bundler endpoints (for wallet deployment)
BUNDLER_URL_BSC=https://api.pimlico.io/v2/56/rpc?apikey=...
BUNDLER_URL_BASE=https://api.pimlico.io/v2/8453/rpc?apikey=...

# === OPTIONAL ===

# ERC-4337 EntryPoint (default: v0.7 @ 0x0000000071727De22E5E9d8BAf0edAc6f37da032)
ENTRYPOINT_ADDRESS=0x...

# RPC endpoints (default: public RPCs)
RPC_BSC=https://bsc-dataseed.binance.org
RPC_BASE=https://mainnet.base.org

# PostgreSQL (default: in-memory store)
DATABASE_URL=postgresql://user:password@localhost:5432/x402

# Server
PORT=3000
PORTAL_DIR=facilitator-portal
```

### Client environment variable

```bash
# Used by createX402ClientFromEnv()
X402_PRIVATE_KEY=0x...
```

---

## Testing

The test suite uses [Vitest](https://vitest.dev/) with 334 tests across 8 test files.

```bash
# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage
```

### Test files

| File | Coverage |
|------|----------|
| `tests/types.test.ts` | Zod schemas, type validation, utilities |
| `tests/chains.test.ts` | BNB network config, token utilities |
| `tests/base-chain.test.ts` | Base network config, token formatting |
| `tests/client.test.ts` | X402Client signing, retry, multi-chain |
| `tests/server.test.ts` | Middleware, verification, nonce replay protection |
| `tests/facilitator-types.test.ts` | Handle validation, fee calculation |
| `tests/facilitator-services.test.ts` | Handle registration, settlement logic |
| `tests/facilitator-server.test.ts` | Express routes, HTTP endpoints |

### Build

```bash
npm run build          # Build ESM + CJS + declarations
npm run typecheck      # Type-check without emitting
npm run clean          # Remove dist/
npm run dev            # Build with watch mode
```

---

## Project Structure

```
x402v2/
├── src/
│   ├── index.ts                    Main re-export hub
│   ├── types/
│   │   └── index.ts                Protocol types, Zod schemas, errors, utilities
│   ├── client/
│   │   └── index.ts                X402Client with auto 402 handling
│   ├── server/
│   │   └── index.ts                Express middleware + nonce registry
│   ├── chains/
│   │   ├── index.ts                Network registry
│   │   ├── bnb.ts                  BNB Chain (56) config + tokens
│   │   └── base.ts                 Base (8453) config + tokens
│   ├── facilitator/
│   │   ├── index.ts                Facilitator exports
│   │   ├── server.ts               Express routes (10+ endpoints)
│   │   ├── config.ts               Environment config + viem client setup
│   │   ├── types.ts                Agent, Transaction, request/response types
│   │   ├── services/
│   │   │   ├── handle.ts           Handle registration + resolution
│   │   │   ├── wallet.ts           ERC-4337 wallet provisioning
│   │   │   └── settlement.ts       On-chain settlement + fee collection
│   │   └── db/
│   │       └── schema.ts           SQL schema + InMemoryStore + DataStore interface
│   └── bin/
│       └── facilitator.ts          CLI entry point
├── contracts/
│   ├── WazabiAccount.sol           ERC-4337 smart wallet
│   ├── WazabiAccountFactory.sol    CREATE2 wallet factory
│   └── WazabiPaymaster.sol         Gas sponsorship paymaster
├── tests/                          8 test files, 334 tests
├── scripts/
│   └── deploy.ts                   Contract deployment script
├── facilitator-portal/             Dashboard UI (static files)
├── package.json                    npm config, 6 entry points
├── tsconfig.json                   TypeScript strict mode, ES2022
├── tsup.config.ts                  ESM + CJS bundling
├── vitest.config.ts                Test configuration
├── hardhat.config.ts               Solidity compilation
└── .env.example                    Environment template
```

### Package exports map

| Import path | Module |
|-------------|--------|
| `@wazabiai/x402` | Everything (re-exports all modules) |
| `@wazabiai/x402/client` | X402Client, factory functions, error classes |
| `@wazabiai/x402/server` | Middleware, verification utilities |
| `@wazabiai/x402/types` | Types, schemas, constants |
| `@wazabiai/x402/chains` | Network configs, token utilities |
| `@wazabiai/x402/facilitator` | Agent platform (handles, wallets, settlement) |

---

## Examples

### Pay-per-API-call

```typescript
// Server
app.use('/api/ai', x402Middleware({
  recipientAddress: TREASURY,
  amount: parseTokenAmount('0.001', BSC_USDT.address).toString(),
  description: 'AI API call',
}));

app.post('/api/ai/generate', async (req: X402Request, res) => {
  console.log(`Paid by: ${req.x402?.signer}`);
  const result = await generateAIResponse(req.body);
  res.json(result);
});
```

### Tiered pricing

```typescript
const PRICES = {
  basic:   parseTokenAmount('0.10', BSC_USDT.address).toString(),
  premium: parseTokenAmount('1.00', BSC_USDT.address).toString(),
};

app.use('/api/basic',   x402Middleware({ recipientAddress: TREASURY, amount: PRICES.basic }));
app.use('/api/premium', x402Middleware({ recipientAddress: TREASURY, amount: PRICES.premium }));
```

### With external facilitator

```typescript
app.use('/api/paid', x402Middleware({
  recipientAddress: TREASURY,
  amount: PRICE,
  facilitatorUrl: 'https://facilitator.wazabi.ai',
}));
```

### Multi-chain client

```typescript
const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
  supportedNetworks: ['eip155:56', 'eip155:8453'],
});
```

---

## License

MIT
