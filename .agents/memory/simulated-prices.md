---
name: Simulated prices bug
description: GeckoTerminal misses DEXs not in top-volume pools; random fallback generates phantom arbitrage opportunities that trigger real reverted transactions.
---

## Root cause

`priceMonitor.ts` fetches top pools sorted by 24h volume from GeckoTerminal. DEXs with low WBTC/USDT volume (e.g. Camelot V3, some Avalanche DEXs) don't appear. When no match is found, a random ±0.3% price is generated as a fallback.

This fake spread can pass the profit threshold in `arbitrageDetector.ts` and trigger a real on-chain transaction. The transaction reverts because no real pool exists (or has no liquidity) — the DEX router returns empty revert data.

**How to identify:** `gasUsed ≈ 186k` (swap fails early in executeOperation) + empty revert (`data: null`).

## Fix

Added `isSimulated: boolean` field to `DexPrice` interface:
- `isSimulated: false` — price came from real GeckoTerminal pool data
- `isSimulated: true` — price came from random fallback simulation (no matching pool found, or full fetch failed)

Both the 1-hop and 2-hop detection loops in `arbitrageDetector.ts` skip any pair where either side has `isSimulated: true`.

**Why:** Simulated prices are random numbers with no on-chain backing. Any trade built on them will revert because the pool spread doesn't exist. The UI can still display simulated prices for reference but must never execute trades on them.

## Gas signature pattern

- `gasUsed ≈ 186k`, empty revert (`data: null`) → swap itself failed early (wrong router, missing pool, or simulated price)
- `gasUsed ≈ 466k`, empty revert → both swaps completed but `InsufficientProfit` custom error fired (ethers v6 shows custom errors as `data: null` when contract not ABI-verified)

## DEX trading fees — must subtract before execution

The profit estimator must subtract both legs' DEX fees, not just Aave fees:
- Uniswap V3 fee-500: 0.05%
- SushiSwap V2: 0.30%
- Camelot V3: ~0.05%
- Minimum viable spread (UniV3 + SushiSwap route): 0.40% + gas
