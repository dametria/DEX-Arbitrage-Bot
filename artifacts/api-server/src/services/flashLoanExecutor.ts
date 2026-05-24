import { ethers } from "ethers";
import { logger } from "../lib/logger.js";
import type { ArbitrageOpportunity } from "./arbitrageDetector.js";

export interface ExecutionConfig {
  gasSource: "flashloan" | "contract";
  slippageTolerance: number;
  walletAddress: string;
  privateKey: string;
}

export interface TradeRecord {
  id: string;
  buyDex: string;
  sellDex: string;
  network: string;
  buyPrice: number;
  sellPrice: number;
  loanAmount: number;
  profit: number;
  profitPct: number;
  gasCost: number;
  gasSource: string;
  txHash: string | undefined;
  status: "success" | "reverted" | "failed";
  executedAt: string;
  errorMessage?: string;
}

const CONTRACT_ADDRESSES: Record<string, string> = {
  arbitrum: "0x88379b60dAbaC8759d2577E52f0aB74D731724F9",
  avalanche: undefined,
  optimism: undefined,
};

const USDT_ADDRESSES: Record<string, string> = {
  avalanche: "0x9702230A8Ea53655438EE1C719456B2Bbf26Ad3D",
  arbitrum: "0xFd086bC7CD5C481DCC9C85fE04213A929da48929",
  optimism: "0x94b008aA00579c1307B0EF2C499aD98BE8348085",
};

const WBTC_ADDRESSES: Record<string, string> = {
  avalanche: "0x50b674Da3E581653D9b603a7c1AF7458f5e7CD50",
  arbitrum: "0x2f2a2543B76A4166567F48F5b3b2F4F6627F35D9",
  optimism: "0x68f180fcCe68366896E3649Fb2824D77550884eA",
};

const RPC_URLS: Record<string, string> = {
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
};

const DEX_ID: Record<string, number> = {
  // Avalanche
  "Trader Joe V2.1": 0,
  "Pangolin": 1,
  "SushiSwap": 2,
  // Arbitrum
  "PancakeSwap V3": 0,
  "Uniswap V3": 1,
  "SushiSwap": 2,
  "Camelot V3": 3,
  // Optimism
  "Uniswap V3": 0,
  "Velodrome V2": 1,
};

const SUSHISWAP_ID: Record<string, number> = {
  avalanche: 2,
  arbitrum: 2,
  optimism: 2,
};

const BOT_ABI = [
  `function initiateArbitrage(tuple(
      uint8   buyDexId,
      uint8   sellDexId,
      address tokenBorrow,
      address tokenBuy,
      uint256 loanAmount,
      uint256 minProfit,
      uint256 deadline,
      uint8   hops,
      uint8   hopDexId,
      address hopToken
  ) p) external`,
];

const FLASH_LOAN_AMOUNT_USDT = 10_000;
const AAVE_FEE_PCT = 0.0005;
const DEADLINE_BUFFER_SECONDS = 120;
const LOAN_DECIMALS = 6;
const MIN_PROFIT_USD = "0.50";

const NATIVE_TOKEN_PRICES: Record<string, number> = {
  avalanche: 35,
  arbitrum: 3200,
  optimism: 3200,
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

function estimateGas(network: string): { gasPriceGwei: number; estimatedGasUnits: number; gasCostUsd: number } {
  const gasPricesGwei: Record<string, number> = {
    avalanche: 30,
    arbitrum: 0.1,
    optimism: 0.001,
  };
  const gasUnits: Record<string, number> = {
    avalanche: 400_000,
    arbitrum: 800_000,
    optimism: 600_000,
  };
  const gasPriceGwei = gasPricesGwei[network] ?? 1;
  const estimatedGasUnits = gasUnits[network] ?? 500_000;
  const nativePrice = NATIVE_TOKEN_PRICES[network] ?? 1;
  const gasCostNative = (gasPriceGwei * estimatedGasUnits) / 1e9;
  const gasCostUsd = gasCostNative * nativePrice;
  return { gasPriceGwei, estimatedGasUnits, gasCostUsd };
}

function resolveDexId(dexName: string, network: string): number {
  if (dexName === "SushiSwap") return SUSHISWAP_ID[network] ?? 2;
  return DEX_ID[dexName] ?? 0;
}

export async function executeFlashLoan(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
): Promise<TradeRecord> {
  const executedAt = new Date().toISOString();
  const gasEstimate = estimateGas(opp.network);

  logger.info(
    { opp: opp.id, network: opp.network, buyDex: opp.buyDex, sellDex: opp.sellDex },
    "Executing flash loan arbitrage",
  );

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS;
  const contractAddress = CONTRACT_ADDRESSES[opp.network];
  const usdtAddress = USDT_ADDRESSES[opp.network];
  const wbtcAddress = WBTC_ADDRESSES[opp.network];

  if (!contractAddress) {
    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0,
      profitPct: 0,
      gasCost: 0,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: `No contract deployed on ${opp.network}`,
    };
  }

  if (!config.privateKey) {
    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0,
      profitPct: 0,
      gasCost: 0,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: "No private key configured",
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URLS[opp.network]);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const bot = new ethers.Contract(contractAddress, BOT_ABI, wallet);

    const loanAmountRaw = ethers.parseUnits(String(FLASH_LOAN_AMOUNT_USDT), LOAN_DECIMALS);
    const minProfitRaw = ethers.parseUnits(MIN_PROFIT_USD, LOAN_DECIMALS);

    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas ? feeData.maxFeePerGas * 12n / 10n : undefined;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas * 11n / 10n : undefined;

    const txOptions: Record<string, unknown> = {
      gasLimit: 1_200_000,
    };
    if (maxFeePerGas && maxPriorityFeePerGas) {
      txOptions.maxFeePerGas = maxFeePerGas;
      txOptions.maxPriorityFeePerGas = maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
      txOptions.gasPrice = feeData.gasPrice * 11n / 10n;
    }

    logger.info(
      {
        contract: contractAddress,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        buyDexId: resolveDexId(opp.buyDex, opp.network),
        sellDexId: resolveDexId(opp.sellDex, opp.network),
        loanAmount: FLASH_LOAN_AMOUNT_USDT,
        deadline,
      },
      "Sending initiateArbitrage transaction",
    );

    const tx = await bot.initiateArbitrage(
      {
        buyDexId: resolveDexId(opp.buyDex, opp.network),
        sellDexId: resolveDexId(opp.sellDex, opp.network),
        tokenBorrow: usdtAddress,
        tokenBuy: wbtcAddress,
        loanAmount: loanAmountRaw,
        minProfit: minProfitRaw,
        deadline: BigInt(deadline),
        hops: opp.hops ?? 1,
        hopDexId: 0,
        hopToken: ethers.ZeroAddress,
      },
      txOptions,
    );

    logger.info({ txHash: tx.hash }, "Transaction submitted - waiting for receipt");

    const receipt = await tx.wait(1);
    const success = receipt?.status === 1;

    const gasCostUsd = receipt
      ? parseFloat(
          (
            (Number(receipt.gasUsed) *
              Number(feeData.gasPrice ?? 0n)) /
              1e18 *
              NATIVE_TOKEN_PRICES[opp.network]!
          ).toFixed(4),
        )
      : gasEstimate.gasCostUsd;

    logger.info(
      { txHash: receipt?.hash, status: receipt?.status, gasUsed: receipt?.gasUsed?.toString() },
      success ? "Flash loan succeeded" : "Flash loan reverted",
    );

    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: success ? parseFloat(opp.estimatedProfit.toFixed(4)) : 0,
      profitPct: success
        ? parseFloat(((opp.estimatedProfit / FLASH_LOAN_AMOUNT_USDT) * 100).toFixed(4))
        : 0,
      gasCost: gasCostUsd,
      gasSource: config.gasSource,
      txHash: receipt?.hash,
      status: success ? "success" : "reverted",
      executedAt,
      errorMessage: success ? undefined : "Transaction reverted on-chain",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, opp: opp.id }, "Flash loan execution threw");

    const isRevert =
      message.includes("revert") ||
      message.includes("execution reverted") ||
      message.includes("CALL_EXCEPTION");

    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0,
      profitPct: 0,
      gasCost: parseFloat(gasEstimate.gasCostUsd.toFixed(4)),
      gasSource: config.gasSource,
      txHash: undefined,
      status: isRevert ? "reverted" : "failed",
      executedAt,
      errorMessage: message.slice(0, 200),
    };
  }
}
