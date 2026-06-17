# ArbBot — WBTC/USDT Flash Arbitrage Bot

A mobile arbitrage bot that monitors WBTC/USDT price spreads across major DEXs on Avalanche, Arbitrum, and Optimism. When a profitable opportunity (≥0.2%) is detected, it executes a $1,000 USDT flash loan via Aave V3 to capture the spread and repay.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/mobile run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo (React Native) with expo-router
- API: Express 5
- DB: none (in-memory for now, trade history lives in botEngine.ts)
- Validation: Zod (`zod/v4`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `artifacts/api-server/src/services/priceMonitor.ts` — GeckoTerminal price fetching
- `artifacts/api-server/src/services/arbitrageDetector.ts` — opportunity detection logic
- `artifacts/api-server/src/services/flashLoanExecutor.ts` — Aave V3 flash loan execution
- `artifacts/api-server/src/services/botEngine.ts` — bot orchestration + state
- `artifacts/mobile/context/BotContext.tsx` — mobile bot state provider
- `artifacts/mobile/app/(tabs)/` — 4 main screens

## Architecture decisions

- Flash loan provider: Aave V3 (same contract address 0x794a6... on all 3 networks)
- Price data: GeckoTerminal public API (no key needed), falls back to simulation if rate-limited
- Anti-frontrunning: short deadline (60s), gas price bump, pre-execution profit re-check
- Slippage: fixed at 1% (0.01 of loan amount applied as cost estimate)
- Max hops: 2 (1-hop and 2-hop routes both detected)
- Gas source: user-selected per initialization (flashloan or contract wallet)
- No cross-chain routes: each opportunity is scoped to a single network

## DEXs Monitored

- **Avalanche (4):** Trader Joe V2.1, Pangolin, SushiSwap, GMX
- **Arbitrum (3):** Uniswap V3 (fee-500), SushiSwap, Camelot V3
- **Optimism (4):** Uniswap V3, Velodrome V2, Beethoven X, Curve

### Arbitrum DEXs removed and why
- **GMX** — GMX V2 uses an async order/keeper model (`createOrder`) — incompatible with flash loans which require synchronous execution in one tx. GMX V1's `swap()` interface was permanently disabled July 2025.
- **Balancer V2** — no liquid WBTC/USDT pool on Arbitrum Balancer (pool ID returns `BAL#500 = NONEXISTENT_POOL`); GeckoTerminal has no real data for it so the price monitor fell back to random simulated prices, generating phantom opportunities that always reverted on-chain.

## Product

- **Dashboard:** Bot status, P&L stats, live top opportunities, start/stop control
- **Markets:** WBTC/USDT prices per DEX across networks with spread visualization
- **Signals:** Full arbitrage opportunity list with route display (buy DEX → sell DEX)
- **Trades:** Complete execution history with P&L, gas cost, tx hash

## User preferences

- Slippage tolerance: 1% (fixed)
- Flash loan amount: $1,000 USDT
- Minimum profit threshold: configurable (default 0.2%)
- Gas fee source: user-selected at each bot initialization

## Gotchas

- Live flash loan execution requires deploying ArbitrageBot.sol (implements IFlashLoanSimpleReceiver). See flashLoanExecutor.ts comments for the full ethers.js integration pattern.
- The executor currently runs in simulation mode — profit/loss is calculated from real prices but transaction is not broadcast on-chain.
- GeckoTerminal API may rate-limit under heavy polling; the price monitor falls back to simulated spreads around the last known price.
- Private key is stored only in AsyncStorage locally on device — never transmitted or logged.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Aave V3 Pool address: 0x794a61358D6845594F94dc1DB02A252b5b4814aD (Avalanche, Arbitrum, Optimism)
