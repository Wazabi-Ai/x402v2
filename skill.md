# Wazabi x402 Payment Skill

## Description
Enable your agent to send and receive payments using the Wazabi x402 protocol.
Provides ERC-4337 smart wallet with gasless transactions on BNB Chain and Base.

## Setup
To activate this skill, tell your agent:
```
Register me for x402 payments with handle <your-handle>
```

## API Base URL
```
https://facilitator.wazabi.ai
```

## Commands

### Register for Payments
**User says:** "Register me for x402 as molty"
```http
POST https://facilitator.wazabi.ai/register
Content-Type: application/json

{
  "handle": "molty",
  "networks": ["eip155:56", "eip155:8453"]
}
```
**Response:** Wallet address + session key (store the session key securely — it is returned only once)

### Check Balance
**User says:** "What's my x402 balance?"
```http
GET https://facilitator.wazabi.ai/balance/molty.wazabi-x402
```
**Response:**
```json
{
  "handle": "molty.wazabi-x402",
  "balances": {
    "eip155:56": { "USDT": "142.50", "USDC": "0.00" },
    "eip155:8453": { "USDC": "50.25" }
  },
  "total_usd": "192.75"
}
```

### Send Payment
**User says:** "Pay agent-b 5 USDC"
```http
POST https://facilitator.wazabi.ai/settle
Content-Type: application/json

{
  "from": "molty",
  "to": "agent-b",
  "amount": "5.00",
  "token": "USDC",
  "network": "eip155:8453"
}
```
**Response:**
```json
{
  "success": true,
  "tx_hash": "0xABC123...",
  "settlement": {
    "gross": "5.00",
    "fee": "0.03",
    "gas": "0.02",
    "net": "4.95"
  }
}
```
**Note:** A 0.5% settlement fee is applied automatically.

### View Payment History
**User says:** "Show my payment history"
```http
GET https://facilitator.wazabi.ai/history/molty.wazabi-x402?limit=20
```

### Resolve Handle to Address
**User says:** "What's my deposit address?"
```http
GET https://facilitator.wazabi.ai/resolve/molty.wazabi-x402
```
Returns the ERC-4337 smart wallet address for depositing funds.

### Check Supported Networks
```http
GET https://facilitator.wazabi.ai/supported
```

## Auto-Payment Behavior (HTTP 402)

When your agent encounters an HTTP 402 Payment Required response:

1. **Parse** the `X-Payment-Required` header to get payment requirements
2. **Check** balance via `GET /balance/<handle>.wazabi-x402`
3. **Verify** sufficient funds (amount + 0.5% fee)
4. **Execute** payment via `POST /settle`
5. **Retry** the original request after successful payment

## Supported Networks

| Network | Chain ID | Tokens |
|---------|----------|--------|
| BNB Chain | eip155:56 | USDT, USDC |
| Base | eip155:8453 | USDC |

## Handle Format

Handles follow the format: `<name>.wazabi-x402`

- **Example:** `molty.wazabi-x402`
- **Rules:** 3-50 characters, alphanumeric with hyphens/underscores
- **Resolution:** Each handle resolves to an ERC-4337 smart wallet address that is identical on all supported chains

## Wallet Details

- **Type:** ERC-4337 (Account Abstraction)
- **Gas:** Paid from agent's token balance (USDC/USDT) — no native tokens needed
- **Security:** Session keys with spending limits and expiration
- **Cross-chain:** Same wallet address on BNB Chain and Base

## Fee Structure

| Item | Rate |
|------|------|
| Settlement Fee | 0.5% of transaction amount |
| Gas | Paid in USDC from sender balance |
