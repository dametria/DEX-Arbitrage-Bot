---
name: 2026-08-14 rework Fluid Pancake Balancer
description: Expo mobile start fixed; Fluid + PancakeSwap V3 added; Balancer Vault as flash-loan provider (0 fee); pairs expanded to USDC MEV leaders from screenshot.
---

## Expo fix
`artifacts/mobile/package.json` scripts:
- `dev` auto-detects Replit vs local and runs the appropriate `expo start`
- `start`, `android`, `ios`, `web` for standard Expo usage outside Replit

## Flash loan
- Primary: Balancer Vault `0xBA12222222228d8Ba445958a75a0704d566BF2C8` (zero fee)
- Aave path retained for compatibility / old deployments
- Contract constructor now: `(aavePool, balancerVault, owner)`
- `setFlashLoanProvider(bool)` owner toggle

## New DEXs (Arbitrum)
| dexId | Name | Router | dexType |
|-------|------|--------|---------|
| 0 | Uniswap V3 | 0xE592...1564 | 0 |
| 1 | SushiSwap V2 | 0x1b02...7506 | 1 |
| 2 | Camelot V3 | 0x1F72...9e18 | 7 |
| 3 | PancakeSwap V3 | 0x1b81...eB14 | 8 |
| 4 | Fluid | 0x9171...9085 (DexFactory) | 1 (provisional) |

Fluid full swap path (resolver/router) still needs a dedicated adapter for production execution; monitoring + config are in place.

## Pairs (from Arbitrum MEV volume chart)
USDC-USDT, USDC-WETH, USDT-WETH, USDC-WBTC, WBTC-USDT, WETH-WBTC, USDC-DAI, USDT-DAI

## Redeploy required
Old contract at 0x28B493...992d only knows Aave. After forge build + `NETWORK=arbitrum PRIVATE_KEY=... node contracts/deploy.js`, update CONTRACT_ADDRESS in flashLoanExecutor / contractInit / env.
