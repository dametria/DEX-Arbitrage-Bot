import { ethers } from "ethers";
import { logger } from "../lib/logger.js";

const RPC_URL = process.env["RPC_URL"] ?? "https://arb-mainnet.g.alchemy.com/v2/alch_DC-0Rhmo3-RDk7l2q7gjx";
const CONTRACT_ADDRESS = process.env["CONTRACT_ADDRESS"] ?? "0xa9f98c9254B3918a811e449E24e6e22CA34965C2";

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
  `function setFlashLoanProvider(bool _useBalancer) external`,
  `function useBalancerFlashLoan() external view returns (bool)`,
];

// Arbitrum DEXs aligned with MEV volume leaders + requested Fluid / Pancake
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
    feeTier: 500,
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
    label:   "PancakeSwap V3",
    router:  "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    dexType: 8,
    feeTier: 500,
    balancerPoolId: ethers.ZeroHash,
  },
  {
    dexId:   4,
    label:   "Fluid",
    router:  "0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085",
    dexType: 1,
    feeTier: 0,
    balancerPoolId: ethers.ZeroHash,
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

  try {
    const useBal = await contract.useBalancerFlashLoan?.().catch(() => null);
    if (useBal === false) {
      const tx = await contract.setFlashLoanProvider(true, { gasLimit: 80_000n });
      await tx.wait();
      logger.info("Switched flash-loan provider to Balancer (0 fee)");
    }
  } catch {
    // Old contract without Balancer support
  }

  for (const dex of ARBITRUM_DEX_CONFIGS) {
    try {
      const existing = await contract.dexConfigs(dex.dexId) as {
        router: string;
        feeTier: bigint;
        balancerPoolId: string;
      };
      const routerMatch   = existing.router.toLowerCase() === dex.router.toLowerCase();
      const feeTierMatch  = Number(existing.feeTier) === dex.feeTier;
      const poolIdMatch   = existing.balancerPoolId.toLowerCase() === dex.balancerPoolId.toLowerCase();
      if (routerMatch && feeTierMatch && poolIdMatch) {
        logger.info({ dexId: dex.dexId, label: dex.label }, "DEX config already set — skipping");
        alreadySet.push(dex.label);
        continue;
      }

      logger.info({ dexId: dex.dexId, label: dex.label, router: dex.router }, "Setting DEX config");

      const feeData = await provider.getFeeData();
      const maxFee  = feeData.maxFeePerGas
        ? feeData.maxFeePerGas * 130n / 100n
        : undefined;

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
        {
          gasLimit: 200_000n,
          ...(maxFee && { maxFeePerGas: maxFee }),
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
