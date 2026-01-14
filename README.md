# @wazabiai/x402

<div align="center">

**Production-ready SDK for the x402 v2 Payment Protocol on BNB Smart Chain**

[![npm version](https://img.shields.io/npm/v/@wazabiai/x402)](https://www.npmjs.com/package/@wazabiai/x402)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

</div>

---

## Overview

The x402 protocol standardizes crypto payments over HTTP, enabling seamless pay-per-use APIs and premium content access on the blockchain.

**Protocol Flow:**
1. **402 Payment Required** — Server responds with payment details in headers
2. **EIP-712 Signing** — Client signs typed data payload
3. **Retry with Signature** — Client retries with `X-PAYMENT-SIGNATURE` header
4. **Verification** — Server verifies signature and processes request

## Installation

```bash
npm install @wazabiai/x402
# or
pnpm add @wazabiai/x402
# or
yarn add @wazabiai/x402
```

**Peer Dependencies:**
```bash
npm install viem express
```

## Quick Start

### Client Usage

```typescript
import { X402Client } from '@wazabiai/x402/client';

// Create client with private key (for server-to-server)
const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
});

// Make requests - 402 responses are handled automatically
const response = await client.fetch('https://api.example.com/premium-data');
console.log(response.data);
```

### Server Usage

```typescript
import express from 'express';
import { x402Middleware } from '@wazabiai/x402/server';
import { BSC_USDT, parseTokenAmount } from '@wazabiai/x402/chains';

const app = express();

// Protect routes with payment requirement
app.use('/api/paid', x402Middleware({
  recipientAddress: '0xYourWalletAddress',
  amount: parseTokenAmount('0.10', BSC_USDT.address).toString(), // $0.10 USDT
  tokenAddress: BSC_USDT.address,
  description: 'Access to premium API',
}));

app.get('/api/paid/data', (req, res) => {
  // Payment verified ✓
  res.json({ premium: 'content' });
});

app.listen(3000);
```

## API Reference

### Client

#### `X402Client`

```typescript
import { X402Client } from '@wazabiai/x402/client';

const client = new X402Client({
  // Private key for signing (hex, with or without 0x)
  privateKey?: string;
  
  // Custom RPC URL (defaults to BSC public RPC)
  rpcUrl?: string;
  
  // Supported networks (defaults to ['eip155:56'])
  supportedNetworks?: string[];
  
  // Payment deadline in seconds (default: 300)
  defaultDeadline?: number;
  
  // Auto-retry on 402 (default: true)
  autoRetry?: boolean;
  
  // Maximum retry attempts (default: 1)
  maxRetries?: number;
  
  // Callbacks
  onPaymentRequired?: (requirement: PaymentRequirement) => void;
  onPaymentSigned?: (payment: SignedPayment) => void;
});
```

**Methods:**

```typescript
// Generic fetch with automatic 402 handling
await client.fetch(url, options);

// HTTP verb shortcuts
await client.get(url, options);
await client.post(url, data, options);
await client.put(url, data, options);
await client.delete(url, options);

// Manual signing
const signedPayment = await client.signPayment(requirement);
```

### Server

#### `x402Middleware`

```typescript
import { x402Middleware } from '@wazabiai/x402/server';

const middleware = x402Middleware({
  // Required: Payment recipient address
  recipientAddress: '0x...',
  
  // Required: Amount in smallest token unit (wei)
  amount: '1000000000000000000',
  
  // Token address (default: BSC-USDT)
  tokenAddress?: '0x...',
  
  // External facilitator URL for verification
  facilitatorUrl?: string;
  
  // Payment description
  description?: string;
  
  // Network ID (default: 'eip155:56')
  networkId?: string;
  
  // Deadline duration in seconds (default: 300)
  deadlineDuration?: number;
  
  // Custom verification logic
  verifyPayment?: (payment, req) => Promise<boolean>;
  
  // Routes to exclude from payment
  excludeRoutes?: string[];
});
```

#### Utility Functions

```typescript
import { 
  createPaymentRequirement,
  verifyPayment,
  parsePaymentFromRequest
} from '@wazabiai/x402/server';

// Create a payment requirement manually
const requirement = createPaymentRequirement({
  recipientAddress: '0x...',
  amount: '1000000000000000000',
  resource: '/api/resource',
});

// Verify a signed payment
const result = await verifyPayment(
  signedPayment,
  recipientAddress,
  'eip155:56'
);

// Parse payment from Express request
const payment = parsePaymentFromRequest(req);
```

### Types

```typescript
import type {
  PaymentRequirement,
  PaymentPayload,
  SignedPayment,
  NetworkConfig,
  TokenConfig,
} from '@wazabiai/x402/types';
```

### Chain Configuration

```typescript
import {
  BSC_CHAIN_ID,        // 56
  BSC_CAIP_ID,         // 'eip155:56'
  BSC_USDT,            // TokenConfig
  BSC_USDC,            // TokenConfig
  BSC_TOKENS,          // All tokens
  formatTokenAmount,   // Convert wei to readable
  parseTokenAmount,    // Convert readable to wei
} from '@wazabiai/x402/chains';
```

## Supported Tokens (BSC)

| Token | Address | Decimals |
|-------|---------|----------|
| USDT  | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USDC  | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| BUSD  | `0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56` | 18 |
| WBNB  | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |

## Protocol Details

### HTTP Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-PAYMENT-REQUIRED` | Response | JSON payment requirement |
| `X-PAYMENT-SIGNATURE` | Request | EIP-712 signature |
| `X-PAYMENT-PAYLOAD` | Request | JSON payment payload |

### EIP-712 Structure

**Domain:**
```typescript
{
  name: 'x402',
  version: '2.0.0',
  chainId: 56  // BSC
}
```

**Payment Type:**
```typescript
{
  Payment: [
    { name: 'amount', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'payTo', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'resource', type: 'string' },
  ]
}
```

## Error Handling

```typescript
import {
  PaymentRequiredError,
  PaymentVerificationError,
  UnsupportedNetworkError,
  PaymentExpiredError,
} from '@wazabiai/x402/client';

try {
  await client.fetch(url);
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    console.log('Payment needed:', error.requirement);
  }
  if (error instanceof UnsupportedNetworkError) {
    console.log('Unsupported network:', error.details);
  }
}
```

## Examples

### Pay-per-API-Call

```typescript
// Server
app.use('/api/ai', x402Middleware({
  recipientAddress: TREASURY,
  amount: parseTokenAmount('0.001', BSC_USDT.address).toString(),
  description: 'AI API call',
}));

app.post('/api/ai/generate', async (req, res) => {
  const { x402 } = req as X402Request;
  console.log(`Payment from: ${x402?.signer}`);
  
  const result = await generateAIResponse(req.body);
  res.json(result);
});
```

### Tiered Pricing

```typescript
const PRICES = {
  basic: '100000000000000000',    // 0.1 USDT
  premium: '1000000000000000000', // 1 USDT
};

app.use('/api/basic', x402Middleware({
  recipientAddress: TREASURY,
  amount: PRICES.basic,
}));

app.use('/api/premium', x402Middleware({
  recipientAddress: TREASURY,
  amount: PRICES.premium,
}));
```

### With Facilitator

```typescript
// Offload verification to external service
app.use('/api/paid', x402Middleware({
  recipientAddress: TREASURY,
  amount: PRICE,
  facilitatorUrl: 'https://facilitator.example.com',
}));
```

## Environment Variables

```bash
# Client
X402_PRIVATE_KEY=0x...  # Used by createX402ClientFromEnv()
```

## License

MIT © Wazabi

---

<div align="center">
  <sub>Built with ❤️ for the decentralized web</sub>
</div>
