import { ethers } from "ethers";
import { logger } from "../lib/logger.js";

const RPC_URL = process.env["RPC_URL"] ?? "https://arb1.arbitrum.io/rpc";
const CONTRACT_ADDRESS = "0xb2dbB869E7474edfB49129955EA5C60beEf91648";

// setDexConfig(uint8 dexId, DexConfig cfg)
// DexConfig: (address router, uint8 dexType, uint24 feeTier,
//             bytes32 balancerPoolId, int128 curveIndexIn, int128 curveIndexOut,
//             address veloFactory, bool veloStable, uint256 lbBinStep)
const ABI = [
  `function setDexConfig(uint8 dexId, tuple(
      address router,
      uint8   dexType,
      uint24  feeTier,
      bytes32 balancerPoolId,
      int128  curveIndexIn,
      int128  curveIndexOut,
      address veloFactory,
      bool    veloStable,
      uint256 lbBinStep
  ) cfg) external`,
  `function dexConfigs(uint8) external view returns (
      address router,
      uint8   dexType,
      uint24  feeTier,
      bytes32 balancerPoolId,
      int128  curveIndexIn,
      int128  curveIndexOut,
      address veloFactory,
      bool    veloStable,
      uint256 lbBinStep
  )`,
];

// Arbitrum DEX routers — one entry per dexId used by initiateArbitrage
// dexType mirrors the contract's enum: 0=UniV3, 1=UniV2, 3=BalancerV2, 6=GMX, 7=CamelotV3
const ARBITRUM_DEX_CONFIGS: {
  dexId: number;
  label: string;
  router: string;
  dexType: number;
  feeTier: number;
  balancerPoolId: string;
}[] = [
  {
    dexId:   0,
    label:   "Uniswap V3",
    router:  "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    dexType: 0,
    feeTier: 3000,
    balancerPoolId: ethers.ZeroHash,
  },
  {
    dexId:   1,
    label:   "SushiSwap V2",
    router:  "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    dexType: 1,
    feeTier: 0,
    balancerPoolId: ethers.ZeroHash,
  },
  {
    dexId:   2,
    label:   "Camelot V3",
    router:  "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
    dexType: 7,
    feeTier: 0,
    balancerPoolId: ethers.ZeroHash,
  },
  {
    dexId:   3,
    label:   "GMX",
    router:  "0xaBBc5F99639c9B6bCb58544ddf04165AD37D89e9",
    dexType: 6,
    feeTier: 0,
    balancerPoolId: ethers.ZeroHash,
  },
  {
    dexId:   4,
    label:   "Balancer V2",
    // Balancer Vault is the same on all networks
    router:  "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    dexType: 3,
    feeTier: 0,
    // WBTC/USDT ComposableStablePool on Arbitrum Balancer
    balancerPoolId: "0x64541216bafffeec8ea535bb71fbc927831d0595000000000000000000000002",
  },
];

export interface InitResult {
  success: boolean;
  configured: string[];
  failed:     string[];
  alreadySet: string[];
  errorMessage?: string;
}

export async function initDexConfigs(privateKey: string): Promise<InitResult> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const configured: string[] = [];
  const failed:     string[] = [];
  const alreadySet: string[] = [];

  for (const dex of ARBITRUM_DEX_CONFIGS) {
    try {
      // Check if already set — skip if router matches
      const existing = await contract.dexConfigs(dex.dexId) as { router: string };
      if (existing.router.toLowerCase() === dex.router.toLowerCase()) {
        logger.info({ dexId: dex.dexId, label: dex.label }, "DEX config already set — skipping");
        alreadySet.push(dex.label);
        continue;
      }

      logger.info({ dexId: dex.dexId, label: dex.label, router: dex.router }, "Setting DEX config");

      const tx = await contract.setDexConfig(
        dex.dexId,
        {
          router:          dex.router,
          dexType:         dex.dexType,
          feeTier:         dex.feeTier,
          balancerPoolId:  dex.balancerPoolId,
          curveIndexIn:    0n,
          curveIndexOut:   0n,
          veloFactory:     ethers.ZeroAddress,
          veloStable:      false,
          lbBinStep:       0n,
        },
      );

      await tx.wait();
      logger.info({ dexId: dex.dexId, label: dex.label, txHash: tx.hash }, "DEX config set");
      configured.push(dex.label);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      logger.error({ dexId: dex.dexId, label: dex.label, err }, "Failed to set DEX config");
      failed.push(`${dex.label}: ${msg}`);
    }
  }

  return {
    success:    failed.length === 0,
    configured,
    failed,
    alreadySet,
  };
}
