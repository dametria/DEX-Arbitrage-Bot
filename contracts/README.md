# ArbitrageBot.sol — Deployment Guide

Flash-loan arbitrage contract for WBTC/USDT across Aave V3 + 13 DEXs on Avalanche, Arbitrum, and Optimism.

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
| 0       | Uniswap V3            | Uniswap V3 (Arbitrum, Optimism)            |
| 1       | Uniswap V2-compatible | Pangolin (Avalanche), SushiSwap (Avalanche, Arbitrum) |
| 2       | Trader Joe V2.1       | Trader Joe V2.1 (Avalanche)                |
| 3       | Balancer V2           | Balancer V2 (Arbitrum), Beethoven X (Optimism) |
| 4       | Velodrome V2          | Velodrome V2 (Optimism)                    |
| 5       | Curve                 | Curve (Optimism)                           |
| 6       | GMX                   | GMX (Avalanche, Arbitrum)                  |
| 7       | Camelot V3            | Camelot V3 (Arbitrum)                      |

## Prerequisites

### Compile with Foundry (recommended)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# From the project root
forge build contracts/ArbitrageBot.sol --out contracts/out
```

### Or compile with solc directly

```bash
solc --bin --abi --optimize --optimize-runs 200 \
     -o contracts/out/ArbitrageBot.sol/ \
     contracts/ArbitrageBot.sol
```

## Deploy

```bash
# Install deploy script dependency
npm install ethers@6

# Deploy to Arbitrum
PRIVATE_KEY=0x... NETWORK=arbitrum node contracts/deploy.js

# Deploy to Avalanche
PRIVATE_KEY=0x... NETWORK=avalanche node contracts/deploy.js

# Deploy to Optimism
PRIVATE_KEY=0x... NETWORK=optimism node contracts/deploy.js
```

The script deploys the contract and automatically calls `setDexConfig` for each of the DEXs on that network.

## Post-deploy wiring

1. **Paste the printed contract address** into `artifacts/api-server/src/services/flashLoanExecutor.ts`:
   ```ts
   const CONTRACT_ADDRESSES: Record<string, string> = {
     arbitrum: "0xYourDeployedAddress",
     // ...
   };
   ```

2. **Fund the contract with native gas** (only required when `gasSource = "contract"`):
   ```bash
   # Arbitrum example
   cast send 0xYourContract --value 0.005ether --private-key $PRIVATE_KEY \
     --rpc-url https://arb1.arbitrum.io/rpc
   ```
   When `gasSource = "flashloan"` the gas fee is covered by the flash loan surplus — no pre-funding needed.

3. **Uncomment the live execution block** in `flashLoanExecutor.ts` (lines marked `// import { ethers }...`).

## Gas estimates

| Network   | Estimated gas units | Typical gas price | Estimated cost |
|-----------|--------------------:|------------------:|---------------:|
| Avalanche | 400,000             | 30 gwei           | ~$0.42         |
| Arbitrum  | 800,000             | 0.1 gwei          | ~$0.19         |
| Optimism  | 600,000             | 0.001 gwei        | ~$0.001        |

## Security notes

- Only the **owner** can call `initiateArbitrage()` and `setDexConfig()`.
- The Aave callback (`executeOperation`) reverts if called by anyone other than the Aave Pool or by any initiator other than the contract itself — preventing flash loan griefing.
- Every swap leg carries a `deadline` — if the block timestamp exceeds it the whole transaction reverts, preventing frontrunning via delayed inclusion.
- `minProfit` is enforced on-chain; the transaction reverts with `InsufficientProfit` if the net return falls below the threshold, so a bad price move cannot drain the contract.
- `ReentrancyGuard` is applied to `initiateArbitrage()`.
- No external dependencies — OpenZeppelin guards are inlined to keep the deploy self-contained.

## Owner functions

| Function | Description |
|---|---|
| `initiateArbitrage(ArbParams)` | Trigger a flash loan + arbitrage |
| `setDexConfig(dexId, DexConfig)` | Register or update a DEX router |
| `withdraw(token, to)` | Pull ERC-20 profits out of the contract |
| `withdrawNative(to)` | Pull any accidentally-sent native tokens |
| `transferOwnership(newOwner)` | Hand off ownership |

## ArbParams reference

| Field | Type | Description |
|---|---|---|
| `buyDexId` | uint8 | DEX ID to buy WBTC on (see deploy.js for mappings) |
| `sellDexId` | uint8 | DEX ID to sell WBTC on |
| `tokenBorrow` | address | USDT address on this network |
| `tokenBuy` | address | WBTC address on this network |
| `loanAmount` | uint256 | USDT loan in token units (1000 × 10^6 = 1,000 USDT) |
| `minProfit` | uint256 | Minimum net profit in USDT token units before tx reverts |
| `deadline` | uint256 | Unix timestamp — revert if inclusion is too late |
| `hops` | uint8 | 1 = direct swap, 2 = via intermediate token |
| `hopDexId` | uint8 | DEX ID for the middle hop (2-hop only) |
| `hopToken` | address | Intermediate token address (2-hop only) |
