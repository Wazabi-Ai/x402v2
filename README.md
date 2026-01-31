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
  |  402 + X-PAYMENT-REQUIRED     |
  |<------------------------------|
  |                               |
  |  Signs EIP-712 payment        |
  |                               |
  |  GET /api/premium             |
  |  + X-PAYMENT-SIGNATURE        |
  |  + X-PAYMENT-PAYLOAD          |
  |------------------------------>|
  |                               |
  |  200 OK                       |
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
| BNB Chain | `eip155:56` | USDT (18d), USDC (18d), BUSD (18d), WBNB (18d) |
| Base | `eip155:8453` | USDC (6d) |

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

// Or sign manually
const signed = await client.signPayment(requirement);
```

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
  recipientAddress: '0x...',   // required
  amount: '1000000',           // required, smallest unit
  tokenAddress: '0x...',       // optional, defaults to USDT
  networkId: 'eip155:1',       // optional, defaults to eip155:56
  description: 'API access',   // optional
  excludeRoutes: ['/health'],  // optional
  facilitatorUrl: 'https://...', // optional, delegate verification
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
  BSC_USDT, BSC_USDC, BSC_BUSD, BSC_WBNB, BSC_CAIP_ID,
  formatTokenAmount, parseTokenAmount,

  // Base
  BASE_USDC, BASE_CAIP_ID,
  formatBaseTokenAmount, parseBaseTokenAmount,

  // Registry
  getNetworkConfig, isNetworkSupported,
  getSupportedNetworkIds, getTokenForNetwork,
} from '@wazabiai/x402/chains';

parseEthTokenAmount('10.50', ETH_USDC.address);  // 10500000n
formatTokenAmount(1000000000000000000n, BSC_USDT.address); // '1.00'
```

## Facilitator

The Facilitator is an optional service that extends x402 with agent identity, ERC-4337 smart wallets, and on-chain settlement.

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
| POST | `/register` | Register a handle + deploy smart wallet |
| GET | `/resolve/:handle` | Handle to address lookup |
| GET | `/balance/:handle` | Token balances |
| GET | `/history/:handle` | Transaction history |
| POST | `/settle` | Execute payment (0.5% fee) |
| POST | `/verify` | Verify x402 payment |
| GET | `/supported` | Available networks and tokens |
| GET | `/health` | Health check |

### Register

```bash
curl -X POST http://localhost:3000/register \
  -H 'Content-Type: application/json' \
  -d '{"handle": "my-agent"}'
```

Returns a handle (`my-agent.wazabi-x402`), a deterministic wallet address (same on all chains), and a session key pair.

### Settle

```bash
curl -X POST http://localhost:3000/settle \
  -H 'Content-Type: application/json' \
  -d '{"from": "agent-a", "to": "agent-b", "amount": "10.00", "token": "USDC", "network": "eip155:8453"}'
```

Works with both handles and raw addresses. 0.5% fee is deducted automatically.

### Configuration

Copy `.env.example` and set:

```bash
TREASURY_PRIVATE_KEY=0x...          # required

# Contract addresses (per chain)
ACCOUNT_FACTORY_ETH=0x...           # required
ACCOUNT_FACTORY_BSC=0x...
ACCOUNT_FACTORY_BASE=0x...
PAYMASTER_ETH=0x...                 # required
PAYMASTER_BSC=0x...
PAYMASTER_BASE=0x...

# Bundler endpoints
BUNDLER_URL_ETH=https://...         # required for wallet deployment
BUNDLER_URL_BSC=https://...
BUNDLER_URL_BASE=https://...

# Optional
RPC_ETH=https://eth.llamarpc.com
RPC_BSC=https://bsc-dataseed.binance.org
RPC_BASE=https://mainnet.base.org
DATABASE_URL=postgresql://...       # defaults to in-memory
PORT=3000
```

## Smart contracts

Three Solidity contracts in `contracts/` power the ERC-4337 wallet system:

- **WazabiAccount** -- Smart wallet with session keys and spending limits
- **WazabiAccountFactory** -- CREATE2 factory for deterministic addresses
- **WazabiPaymaster** -- Gas sponsorship via ERC-20 token payment

Compile with `npx hardhat compile`. Deployment requires wallet access and is separate from the SDK build.

## Development

```bash
npm install
npm run build          # ESM + CJS + declarations
npm test               # 336 tests via Vitest
npm run dev            # build with watch
```

## Protocol

x402 uses [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed data signatures over HTTP headers.

**Headers:**
- `x-payment-required` -- Server sends payment details (amount, token, network, recipient)
- `x-payment-signature` -- Client sends EIP-712 signature
- `x-payment-payload` -- Client sends signed payload

**EIP-712 domain:** `{ name: 'x402', version: '2.0.0', chainId }`

**Payment type:**
```
Payment(uint256 amount, address token, uint256 chainId, address payTo, address payer, uint256 deadline, string nonce, string resource)
```

Replay protection via per-nonce tracking with 10-minute TTL.

## License

MIT
