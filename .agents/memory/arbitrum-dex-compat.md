---
name: Arbitrum DEX compatibility
description: Which Arbitrum DEXs are compatible with the ArbitrageBot.sol flash loan pattern and why GMX/Balancer were removed.
---

## Active Arbitrum DEXs (as of June 2026)

| dexId | DEX | Status |
|-------|-----|--------|
| 0 | Uniswap V3 (feeTier 500) | ✅ Active |
| 1 | SushiSwap V2 | ✅ Active |
| 2 | Camelot V3 | ✅ Active |

## Removed DEXs

### GMX (dexId 3)
**Why:** GMX V2 (ExchangeRouter `0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8`) uses an async order/keeper model (`createOrder`). Flash loans require all swaps to complete synchronously within one transaction. The ArbitrageBot.sol uses the GMX V1 `swap(address[],uint256,uint256,address)` interface — that function no longer exists on V2. Calling it silently reverts with empty data (`0x`). GMX V1 was permanently disabled July 2025.

**How to apply:** Do NOT add GMX to `ARBITRUM_DEX_CONFIGS` in `contractInit.ts` or to `DEX_CONFIGS` in `priceMonitor.ts`. On-chain dexId=3 remains set (can't zero it out — contract requires non-zero router), but since no GMX prices are monitored, no GMX opportunities are generated.

### Balancer V2 (dexId 4)
**Why:** No liquid WBTC/USDT pool exists on Arbitrum Balancer. The pool ID `0x64541216bafffeec8ea535bb71fbc927831d0595000000000000000000000002` returns `BAL#500 = NONEXISTENT_POOL` from the Vault. GeckoTerminal has no real Balancer WBTC/USDT data, so the price monitor falls back to random simulated prices → generates phantom arbitrage opportunities → transactions always fail on-chain.

**How to apply:** Do NOT add Balancer to `ARBITRUM_DEX_CONFIGS` in `contractInit.ts` or to `DEX_CONFIGS` in `priceMonitor.ts`.

## Debugging context

### Init "already set" check
The `contractInit.ts` check now compares `router + feeTier + balancerPoolId` (not just router). Previously only compared `router`, so fee tier changes (e.g. Uniswap V3 3000→500) were silently skipped.

### eth_call simulation trap
When simulating a past failed transaction via `eth_call` at 'latest', the block.timestamp is the CURRENT block — not the one the tx was mined in. A 60-second deadline from a transaction mined 5+ minutes ago will appear expired in simulation. Always use a fresh deadline when simulating.

### Uniswap V3 fee tier
The liquid WBTC/USDT pool on Arbitrum is fee-500 (`0x5969efdde3cf5c0d9a88ae51e47d721096a97203`, 2.2T liquidity). The fee-3000 pool has 275× less liquidity and causes slippage failures.
