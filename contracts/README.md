# ArbitrageBot.sol — Deployment Guide

Flash-loan arbitrage contract for WBTC/USDT across Aave V3 + multi-DEX on Arbitrum.

## Architecture

```
Owner calls initiateArbitrage(ArbParams)
  └─► ArbitrageBot calls Aave V3 flashLoanSimple()
        └─► Aave calls back executeOperation()
              ├─► Leg 1: USDT → WBTC  on buyDex
              ├─► Leg 2: WBTC → USDT  on sellDex   (1-hop)
              │   or
              ├─► Leg 1: USDT → hopToken on buyDex
              ├─► Leg 2: hopToken → WBTC on hopDex
              └─► Leg 3: WBTC → USDT  on sellDex   (2-hop)
              └─► Assert netProfit ≥ minProfit
              └─► Approve Aave repayment (loan + 0.05% fee)
```

Surplus USDT stays in the contract. Call `withdraw()` to collect profits.

## Supported DEX types

| dexType | Protocol              | Used by                                    |
|---------|-----------------------|--------------------------------------------|
| 0       | Uniswap V3            | PancakeSwap V3, Uniswap V3 (Arbitrum)      |
| 1       | Uniswap V2-compatible | SushiSwap (Arbitrum)                       |
| 2       | Trader Joe V2.1       | Trader Joe V2.1 (Avalanche)                |
| 3       | Balancer V2           | Balancer V2 (Arbitrum), Beethoven X        |
| 4       | Velodrome V2          | Velodrome V2 (Optimism)                    |
| 7       | Camelot V3            | Camelot V3 (Arbitrum)                      |

## Arbitrum DEX IDs

| dexId | DEX            | Router Address                                      | Type |
|-------|----------------|-----------------------------------------------------|------|
| 0     | PancakeSwap V3 | 0x1A1f72651F34782990d2fDb087a9235630F73569         | V3   |
| 1     | Uniswap V3     | 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45         | V3   |
| 2     | SushiSwap      | 0x1b02dA8Cb0d097eB8D57A175b8897D913111F124         | V2   |
| 3     | Camelot V3     | 0xc7DD1dD2E5B14f51c08a9A7418E3595566Bb0932         | V3   |

## Prerequisites

1. Foundry (for compiling Solidity)
2. Node.js 18+ (for deployment)
3. Private key with ETH on Arbitrum

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Compile Contract

```bash
forge build contracts/ArbitrageBot.sol --out contracts/out
```

## Deploy

```bash
# Set your private key
export PRIVATE_KEY=0x...

# Deploy to Arbitrum
NETWORK=arbitrum node contracts/deploy.js
```

The deploy script will:
1. Deploy the contract to Arbitrum
2. Configure all DEX routers automatically
3. Print the contract address

## Post-Deploy Setup

### 1. Update Contract Address

Add the deployed contract address to `artifacts/api-server/src/services/flashLoanExecutor.ts`:

```typescript
const CONTRACT_ADDRESSES: Record<string, string> = {
  arbitrum: "0xYOUR_DEPLOYED_ADDRESS",
};
```

### 2. Configure Environment Variables

Add to your `.env` file or environment:

```
PRIVATE_KEY=0x...your_private_key...
```

### 3. Run the Bot

```bash
pnpm --filter api-server run dev
```

Navigate to the web interface and:
1. Go to Settings
2. Enter your wallet private key
3. Configure gas source (flashloan or contract)
4. Set minimum profit percentage
5. Select networks (arbitrum)
6. Start the bot

## Gas Estimates

| Network   | Estimated gas units | Typical gas price | Estimated cost |
|-----------|--------------------:|------------------:|---------------:|
| Arbitrum  | 800,000             | 0.1 gwei          | ~$0.25         |

## Security Notes

- Only the **owner** can call `initiateArbitrage()` and `setDexConfig()`
- The Aave callback reverts if called by anyone other than Aave Pool
- Every swap leg carries a `deadline` - transaction reverts if block timestamp exceeds it
- `minProfit` is enforced on-chain - transaction reverts with `InsufficientProfit` if net return falls below threshold
- `ReentrancyGuard` applied to `initiateArbitrage()`
- No external dependencies - OpenZeppelin guards inlined

## Owner Functions

| Function | Description |
|---|---|
| `initiateArbitrage(ArbParams)` | Trigger a flash loan + arbitrage |
| `setDexConfig(dexId, DexConfig)` | Register or update a DEX router |
| `withdraw(token, to)` | Pull ERC-20 profits out of the contract |
| `withdrawNative(to)` | Pull any accidentally-sent native tokens |
| `transferOwnership(newOwner)` | Hand off ownership |

## ArbParams Reference

| Field | Type | Description |
|---|---|---|
| `buyDexId` | uint8 | DEX ID to buy WBTC on (0=PancakeSwap, 1=Uniswap, 2=SushiSwap, 3=Camelot) |
| `sellDexId` | uint8 | DEX ID to sell WBTC on |
| `tokenBorrow` | address | USDT address: 0xFd086bC7CD5C481DCC9C85fE04213A929da48929 |
| `tokenBuy` | address | WBTC address: 0x2f2a2543B76A4166567F48F5b3b2F4F6627F35D9 |
| `loanAmount` | uint256 | USDT loan in token units (10000 * 10^6 = 10,000 USDT) |
| `minProfit` | uint256 | Minimum net profit in USDT token units before tx reverts |
| `deadline` | uint256 | Unix timestamp — revert if inclusion is too late |
| `hops` | uint8 | 1 = direct swap, 2 = via intermediate token |
| `hopDexId` | uint8 | DEX ID for the middle hop (2-hop only) |
| `hopToken` | address | Intermediate token address (2-hop only) |

## Live Contract on Arbitrum

A contract is already deployed at: `0x88379b60dAbaC8759d2577E52f0aB74D731724F9`

This contract has DEXs pre-configured for:
- PancakeSwap V3 (dexId 0)
- Uniswap V3 (dexId 1)
- SushiSwap (dexId 2)
- Camelot V3 (dexId 3)
