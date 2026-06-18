---
name: dexConfigs on-chain reads
description: Correct ABI selector and verified on-chain state for ArbitrageBot dexConfigs mapping.
---

## Correct selector

`dexConfigs(uint8)` full return-type signature needed for the selector:
```
dexConfigs(uint8) view returns (address,uint8,uint24,bytes32,int128,int128,address,bool,uint256)
```
Selector: **`0xf51d1aa0`**

The wrong selector `0x0e5cc9c5` causes `execution reverted` (no fallback function) — not an ABI mismatch error, just an empty revert.

## Verified on-chain state (Arbitrum, contract 0x28B493…eF992d, June 2026)

| dexId | router | dexType | feeTier |
|-------|--------|---------|---------|
| 0 | 0xE592427A0AEce92De3Edee1F18E0157C05861564 (UniV3 Router) | 0 | 500 |
| 1 | 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506 (SushiSwap V2) | 1 | 0 |
| 2 | 0x1F721E2E82F6676FCE4eA07A5958cF098D339e18 (CamelotV3 AlgebraSwapRouter) | 7 | 0 |

**Why:** deploy.js originally had `0x1F98431c8aD98523631AE4a59f267346ea31F984` (UniV3 Factory, NOT Camelot router) for dexId=2. Running "Initialize DEX Adapters" from the mobile app (contractInit.ts) corrected this to the right AlgebraSwapRouter address. deploy.js has since been updated with the correct address.
