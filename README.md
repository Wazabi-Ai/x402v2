# @wazabiai/x402

An open protocol for internet-native payments. Pay for any HTTP resource with crypto using the `402 Payment Required` status code.

Supports **Ethereum**, **Base**, and **BNB Chain** out of the box.

```
npm install @wazabiai/x402
```

## How it works

```
Client                         Server
  |                               |
  |  GET /api/premium             |
  |------------------------------>|
  |                               |
  |  402 + x-payment-required     |
  |<------------------------------|
  |                               |
  |  Signs EIP-712 payment        |
  |  (Permit2 or ERC-3009)        |
  |                               |
  |  GET /api/premium             |
  |  + x-payment (signed payload) |
  |------------------------------>|
  |                               |
  |  200 OK + x-payment-response  |
  |<------------------------------|
```

## Pay for a resource (client)

```typescript
import { X402Client } from '@wazabiai/x402/client';

const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
});

const response = await client.fetch('https://api.example.com/premium');
console.log(response.data);
```

The client detects `402` responses, signs a payment, and retries automatically.

## Charge for a resource (server)

```typescript
import express from 'express';
import { x402Middleware } from '@wazabiai/x402/server';

const app = express();

app.use('/api/paid', x402Middleware({
  recipientAddress: '0xYourAddress',
  amount: '1000000',           // in token smallest unit
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on ETH
  networkId: 'eip155:1',
}));

app.get('/api/paid/data', (req, res) => {
  res.json({ result: 'premium content' });
});

app.listen(3000);
```

The middleware returns `402` with payment details to unsigned requests, and verifies EIP-712 signatures on retry.

## Supported networks

| Network | ID | Tokens |
|---------|----|--------|
| Ethereum | `eip155:1` | USDC (6d), USDT (6d), WETH (18d) |
| BNB Chain | `eip155:56` | USDT (18d), USDC (18d), WBNB (18d) |
| Base | `eip155:8453` | USDC (6d), WETH (18d) |

## Installation

```bash
npm install @wazabiai/x402 viem
```

`viem` is a peer dependency. Install `express` too if you use the server middleware or facilitator.

Tree-shakeable imports -- use only what you need:

```typescript
import { X402Client }       from '@wazabiai/x402/client';
import { x402Middleware }   from '@wazabiai/x402/server';
import { ETH_USDC }         from '@wazabiai/x402/chains';
import type { SignedPayment } from '@wazabiai/x402/types';
```

## Client API

```typescript
const client = new X402Client({
  privateKey: '0x...',
  supportedNetworks: ['eip155:1', 'eip155:56', 'eip155:8453'],
  defaultDeadline: 300,       // seconds
  autoRetry: true,
  maxRetries: 1,
  onPaymentRequired: (req) => console.log('Payment needed:', req.amount),
  onPaymentSigned: (payment) => console.log('Signed:', payment.signature),
});

await client.fetch(url);
await client.get(url);
await client.post(url, data);
await client.put(url, data);
await client.delete(url);

// Or sign manually (returns Permit2Payload or ERC3009Payload)
const signed = await client.signPayment(acceptEntry);
```

The client automatically selects the best payment scheme from the server's `accepts` array, preferring ERC-3009 (no Permit2 approval needed) and falling back to Permit2.

Factory helpers:

```typescript
import { createX402Client, createX402ClientFromEnv } from '@wazabiai/x402/client';

const client = createX402Client({ privateKey: '0x...' });
const client = createX402ClientFromEnv(); // reads X402_PRIVATE_KEY
```

## Server API

```typescript
import { x402Middleware } from '@wazabiai/x402/server';

app.use('/api/paid', x402Middleware({
  recipientAddress: '0x...',     // required
  amount: '1000000',             // required, smallest unit
  tokenAddress: '0x...',         // defaults to Base USDC
  settlementAddress: '0x...',    // WazabiSettlement contract
  treasuryAddress: '0x...',      // fee recipient address
  feeBps: 50,                    // fee in basis points (default: 50 = 0.5%)
  networkId: 'eip155:8453',      // defaults to eip155:8453 (Base)
  acceptedSchemes: ['permit2'],  // 'permit2' and/or 'erc3009'
  description: 'API access',     // optional
  excludeRoutes: ['/health'],    // optional
  facilitatorUrl: 'https://...', // optional, delegate settlement
}));
```

Access verified payment info on the request:

```typescript
app.get('/api/paid/data', (req, res) => {
  const payer = req.x402?.signer;
  res.json({ payer, data: '...' });
});
```

Standalone verification:

```typescript
import { verifyPayment, parsePaymentFromRequest } from '@wazabiai/x402/server';

const payment = parsePaymentFromRequest(req);
const result = await verifyPayment(payment, recipientAddress, networkId);
```

## Chains

```typescript
import {
  // Ethereum
  ETH_USDC, ETH_USDT, ETH_WETH, ETH_CAIP_ID,
  formatEthTokenAmount, parseEthTokenAmount,

  // BNB Chain
  BSC_USDT, BSC_USDC, BSC_WBNB, BSC_CAIP_ID,
  formatTokenAmount, parseTokenAmount,

  // Base
  BASE_USDC, BASE_WETH, BASE_CAIP_ID,
  formatBaseTokenAmount, parseBaseTokenAmount,

  // Registry
  getNetworkConfig, isNetworkSupported,
  getSupportedNetworkIds, getTokenForNetwork,
} from '@wazabiai/x402/chains';

parseEthTokenAmount('10.50', ETH_USDC.address);  // 10500000n
formatTokenAmount(1000000000000000000n, BSC_USDT.address); // '1.00'
```

## Facilitator

The Facilitator is a thin settlement relay for the x402 payment protocol. It receives signed Permit2 or ERC-3009 payloads and submits them on-chain. The facilitator pays gas but cannot redirect funds (non-custodial). Agents and users bring their own EOA wallet.

```bash
# Run standalone
npx x402-facilitator

# Or mount on your app
```

```typescript
import { createFacilitator } from '@wazabiai/x402/facilitator';

const app = express();
createFacilitator(app);
app.listen(3000);
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/x402/settle` | Submit signed payment for on-chain settlement (0.5% fee) |
| POST | `/verify` | Verify x402 payment sender address |
| GET | `/history/:address` | Transaction history for an Ethereum address |
| GET | `/supported` | Available networks, tokens, and schemes |
| GET | `/skill.md` | OpenClaw skill file for AI agents |
| GET | `/health` | Health check |

### Settle

```bash
curl -X POST http://localhost:3000/x402/settle \
  -H 'Content-Type: application/json' \
  -d '{
    "scheme": "permit2",
    "network": "eip155:8453",
    "payer": "0x...",
    "signature": "0x...",
    "permit": {
      "permitted": [
        { "token": "0x...", "amount": "9950000" },
        { "token": "0x...", "amount": "50000" }
      ],
      "nonce": "123456789",
      "deadline": 1700000000
    },
    "witness": { "recipient": "0x...", "feeBps": 50 },
    "spender": "0x..."
  }'
```

Settlement is **non-custodial** -- funds move directly from payer to recipient via on-chain contracts. The facilitator submits the transaction but cannot redirect funds because the payer's EIP-712 signature cryptographically commits to the recipient address.

Two settlement paths:
- **Permit2** -- for any ERC-20 token. Uses Uniswap's canonical Permit2 contract with batch witness transfers. The witness commits to `(recipient, feeBps)` in the payer's signature.
- **ERC-3009** -- for USDC. Uses native `transferWithAuthorization`. The settlement contract receives the gross amount and atomically splits it to recipient (net) and treasury (fee).

A 0.5% protocol fee (50 basis points, configurable up to 10% max) is split atomically on-chain. The facilitator pays gas but cannot alter the payment destination.

### Configuration

Copy `.env.example` and set:

```bash
TREASURY_PRIVATE_KEY=0x...          # required, derives treasury address

# WazabiSettlement contract addresses (per chain)
SETTLEMENT_ETH=0x...
SETTLEMENT_BSC=0x...
SETTLEMENT_BASE=0x...

# Optional
RPC_ETH=https://eth.llamarpc.com
RPC_BSC=https://bsc-dataseed.binance.org
RPC_BASE=https://mainnet.base.org
DATABASE_URL=postgresql://...       # defaults to in-memory
PORT=3000
PORTAL_DIR=./facilitator-portal     # dashboard UI directory
```

## OpenClaw (AI Agent Integration)

The Facilitator exposes an **OpenClaw skill** at `GET /skill.md` -- a machine-readable markdown file that AI agents can discover and use to interact with the x402 payment protocol.

```bash
curl http://localhost:3000/skill.md
```

Agents bring their own EOA wallet and use the facilitator for gas-abstracted settlement. This enables any OpenClaw-compatible agent to:

- **Make payments** by signing Permit2 or ERC-3009 payloads and submitting to `/x402/settle`
- **Accept payments** by embedding x402 headers in HTTP responses
- **Check history** via `/history/:address`

No special SDK needed on the agent side -- just HTTP, an EOA wallet, and the skill file.

## Smart contracts

One Solidity contract in `contracts/` (Solidity 0.8.24):

- **WazabiSettlement** -- Non-custodial payment settlement with Permit2 batch witness and ERC-3009 paths. Atomically splits funds between recipient (net) and treasury (fee). The payer's signature commits to the recipient and fee rate, so the facilitator cannot redirect funds.

Compile with `npx hardhat compile`. Deploy with `npx hardhat run scripts/deploy.ts --network <network>`.

## Development

```bash
npm install
npm run build          # ESM + CJS + declarations
npm test               # 278 tests via Vitest
npm run dev            # build with watch
```

## Protocol

x402 uses [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed data signatures over HTTP headers.

**Headers:**
- `x-payment-required` -- Server sends payment details (402 response with `accepts` array)
- `x-payment` -- Client sends signed payment payload (Permit2 or ERC-3009)
- `x-payment-response` -- Server sends settlement result (200 response)

**Payment schemes:**

*Permit2* (any ERC-20 via Uniswap canonical contract):
```
Domain: { name: 'Permit2', chainId, verifyingContract: PERMIT2_ADDRESS }
PermitBatchWitnessTransferFrom(TokenPermissions[] permitted, address spender, uint256 nonce, uint256 deadline, SettlementWitness witness)
SettlementWitness(address recipient, uint256 feeBps)
```

*ERC-3009* (USDC native transferWithAuthorization):
```
Domain: { name: 'USD Coin', version: '2', chainId, verifyingContract: tokenAddress }
TransferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
```

Replay protection via per-nonce tracking with 10-minute TTL.

## Security

The facilitator includes production security hardening:

- **Rate limiting** -- 100 requests per minute per IP (configurable via `rateLimitMax`)
- **Security headers** -- CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **CORS** -- Configurable origin allowlists (`corsOrigins` option)
- **Request validation** -- Zod schemas with strict field validation (enum types, address/amount regex)
- **Nonce replay protection** -- Per-nonce registry with 10-minute TTL and periodic cleanup
- **Non-custodial settlement** -- Payer signatures commit to recipient; facilitator cannot redirect funds

## License

MIT
