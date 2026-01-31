# x402 Protocol — Complete Repository Overview

> **The Payment Rails for the Agent Economy** — HTTP 402 + EIP-712 crypto payments with identity, ERC-4337 wallets, and settlement.

---

## What Is x402?

x402 is a **complete payment protocol ecosystem** that standardizes cryptocurrency payments over HTTP. It leverages the HTTP `402 Payment Required` status code and EIP-712 typed data signatures to enable seamless, cryptographically-verified payments for API access, premium content, and agent-to-agent transactions.

---

## Repository Structure

```
x402v2/
├── contracts/              # Solidity smart contracts (ERC-4337)
├── src/
│   ├── client/             # Client SDK — make x402 payments
│   ├── server/             # Express middleware — receive x402 payments
│   ├── chains/             # Chain configs (BNB Chain, Base)
│   ├── types/              # Core TypeScript type definitions
│   └── facilitator/        # Agent Financial Platform
│       ├── services/       # Handle, Settlement, Wallet services
│       ├── db/             # Database schema
│       ├── server.ts       # REST API server
│       └── types.ts        # Facilitator types
├── portal/                 # Marketing/docs website
├── facilitator-portal/     # Agent dashboard UI
├── tests/                  # Full test suite (Vitest)
├── skill.md                # OpenClaw AI skill manifest
└── package.json            # @wazabiai/x402 NPM package
```

---

## What a User Can Do

### 1. Make Payments Automatically (Client SDK)

Use the `X402Client` to make HTTP requests that **auto-detect and auto-pay** when a server requires payment.

```typescript
import { X402Client } from '@wazabiai/x402/client';

const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
  autoRetry: true,
});

// If the server returns 402, the client signs payment and retries automatically
const response = await client.fetch('https://api.example.com/premium-data');
```

**Capabilities:**
- Automatic 402 detection and payment signing
- EIP-712 typed data signatures (no raw transactions)
- HTTP verb shortcuts: `client.get()`, `client.post()`, `client.put()`, `client.delete()`
- Callbacks: `onPaymentRequired`, `onPaymentSigned`
- Configurable deadlines, retries, and network preferences
- Environment-based setup via `createX402ClientFromEnv()`

---

### 2. Charge for API Access (Server Middleware)

Protect any Express route with a payment wall using `x402Middleware`.

```typescript
import express from 'express';
import { x402Middleware } from '@wazabiai/x402/server';

const app = express();

app.use('/api/premium', x402Middleware({
  recipientAddress: '0xYourWallet...',
  amount: '100000000000000000',       // in wei
  tokenAddress: '0x55d398...',        // BSC-USDT
  description: 'Premium API access',
}));

app.get('/api/premium/data', (req, res) => {
  // req.x402.signer — the address that paid
  res.json({ premium: 'content' });
});
```

**Capabilities:**
- Drop-in Express middleware
- Local signature verification (no external calls needed)
- External facilitator verification (optional)
- Custom verification callbacks
- Route exclusion patterns
- Nonce + deadline-based replay protection

---

### 3. Register an Agent Handle

Register a human-readable handle (e.g., `molty.wazabi-x402`) and get an ERC-4337 smart wallet.

```
POST /register
{
  "handle": "molty",
  "networks": ["eip155:56", "eip155:8453"]
}
```

**What you get:**
- A unique handle: `molty.wazabi-x402`
- A deterministic ERC-4337 smart wallet address (same across all chains)
- A session key pair for signing operations (shown only once)
- Lazy wallet deployment — wallet deploys on first use

**Handle rules:** 3-50 chars, lowercase alphanumeric, optional hyphens/underscores.

---

### 4. Resolve Handles to Addresses

Look up any registered handle to find its wallet address.

```
GET /resolve/molty
→ { "handle": "molty.wazabi-x402", "wallet": "0x7A3b...F9c2", "deployed": {...} }
```

---

### 5. Check Balances

Query token balances across all supported networks.

```
GET /balance/molty
→ {
    "balances": {
      "eip155:56": { "USDT": "250.00", "USDC": "100.00" },
      "eip155:8453": { "USDC": "75.00" }
    },
    "total_usd": "425.00"
  }
```

---

### 6. Send Payments (Settle)

Transfer tokens between handles or raw addresses with a 0.5% settlement fee.

```
POST /settle
{
  "from": "molty",
  "to": "agent-b",
  "amount": "100.00",
  "token": "USDC",
  "network": "eip155:8453"
}
→ {
    "settlement": {
      "gross": "100.00",
      "fee": "0.50",
      "gas": "0.02",
      "net": "99.48"
    },
    "tx_hash": "0xABC123..."
  }
```

**Supports:** Handle-to-handle, handle-to-address, address-to-address. Registration is optional.

---

### 7. View Transaction History

Paginated history of all settlements for a handle or address.

```
GET /history/molty?limit=20&offset=0
```

Each record includes: direction (sent/received), amount, fee, token, counterparty, network, status, and timestamp.

---

### 8. View Agent Profile

Full profile with metadata, balances, and transaction summary.

```
GET /profile/molty
```

---

### 9. Verify Payments

Check whether a payment signature is valid and the payer has sufficient balance.

```
POST /verify
{
  "payment": { "payload": {...}, "signature": "0x...", "signer": "0x..." },
  "recipient": "0x...",
  "network": "eip155:56"
}
```

---

### 10. Deploy Smart Contracts

Three production-ready Solidity contracts in `/contracts/`:

| Contract | Purpose |
|---|---|
| **WazabiAccount.sol** | ERC-4337 smart account with session keys, spending limits, batch execution |
| **WazabiAccountFactory.sol** | Deterministic CREATE2 deployment — same address on every chain |
| **WazabiPaymaster.sol** | Gas sponsorship — agents pay gas in USDC/USDT instead of ETH/BNB |

**Smart account features:**
- Session key management with per-tx and daily spending limits
- Key expiration and revocation
- Batch execution support
- UUPS upgradeable pattern
- Owner recovery key

---

### 11. Run the Facilitator Server

Start a standalone facilitator or integrate into an existing Express app.

```typescript
import { startFacilitator } from '@wazabiai/x402/facilitator';
startFacilitator(3000);
```

**REST API Endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/register` | Create handle + deploy wallet |
| GET | `/resolve/:handle` | Handle to address lookup |
| GET | `/balance/:handle` | Token balances across chains |
| GET | `/history/:handle` | Transaction history (paginated) |
| GET | `/profile/:handle` | Full agent profile |
| POST | `/verify` | Verify payment signature + balance |
| POST | `/settle` | Execute payment (0.5% fee) |
| GET | `/supported` | Networks, tokens, fee schedule |
| GET | `/health` | Health check |
| GET | `/skill.md` | OpenClaw AI skill manifest |

---

### 12. Use the Portal & Dashboard

**Public Portal** (`/portal/`) — Marketing site with:
- Protocol flow visualization
- Interactive code demos (client, server, types)
- Token and network showcase
- Getting started guide

**Facilitator Portal** (`/facilitator-portal/`) — Agent dashboard with:
- Handle registration form
- Handle lookup (resolve, balance, profile)
- Settlement form with live fee preview
- Transaction history table
- API reference grid

---

### 13. Integrate AI Agents via OpenClaw

The `skill.md` file defines AI agent capabilities for payment operations. Any OpenClaw-compatible AI agent can:
- Register handles
- Check balances
- Send payments
- View history
- Auto-pay on HTTP 402 responses

---

## Supported Networks & Tokens

| Network | CAIP-2 ID | Tokens |
|---|---|---|
| **BNB Chain** | `eip155:56` | USDT, USDC, BUSD, WBNB |
| **Base** | `eip155:8453` | USDC |

---

## Protocol Flow (How x402 Works)

```
1. Client ──GET /api/data──────────────────> Server
2. Client <──402 + PaymentRequirement─────── Server
3. Client signs EIP-712 typed data locally
4. Client ──GET /api/data + X-Payment-*────> Server
5. Client <──200 OK + response data───────── Server
```

**Security properties:**
- EIP-712 ensures tamper-proof, typed signatures
- Server never sees private keys
- Nonce + deadline prevent replay attacks
- Resource binding ties signatures to specific endpoints

---

## Fee Structure

| Fee Type | Rate |
|---|---|
| Settlement fee | 0.5% (50 basis points) |
| Estimated gas | ~0.02 token units |

---

## Developer Quick Start

```bash
# Install
npm install @wazabiai/x402

# Build
npm run build

# Test
npm run test

# Watch mode
npm run dev
npm run test:watch
```

**Package exports (tree-shakeable):**
- `@wazabiai/x402` — everything
- `@wazabiai/x402/client` — client SDK only
- `@wazabiai/x402/server` — server middleware only
- `@wazabiai/x402/types` — type definitions only
- `@wazabiai/x402/chains` — chain configs only
- `@wazabiai/x402/facilitator` — facilitator server only

---

## Summary

| Capability | Module |
|---|---|
| Make auto-payments over HTTP | `client` |
| Charge for API access | `server` middleware |
| Register agent handles | `facilitator` |
| Deploy ERC-4337 smart wallets | `facilitator` + contracts |
| Settle payments (0.5% fee) | `facilitator` |
| Sponsor gas with stablecoins | `WazabiPaymaster` contract |
| Multi-chain support (BNB + Base) | `chains` |
| AI agent integration | `skill.md` |
| Marketing portal | `portal` |
| Agent dashboard | `facilitator-portal` |
