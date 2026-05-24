import { ethers } from "ethers";
import { logger, createModuleLogger, logPerformance, logError, logTradeEvent } from "../lib/logger.js";
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
  errorDetails?: {
    code?: string;
    reason?: string;
    method?: string;
    transaction?: string;
  };
}

const log = createModuleLogger("flashloan-executor");

const CONTRACT_ADDRESSES: Record<string, string | undefined> = {
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
  "Trader Joe V2.1": 0,
  "Pangolin": 1,
  "PancakeSwap V3": 0,
  "Uniswap V3": 1,
  "Camelot V3": 3,
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
const DEADLINE_BUFFER_SECONDS = 120;
const LOAN_DECIMALS = 6;
const MIN_PROFIT_USD = "0.50";

const NATIVE_TOKEN_PRICES: Record<string, number> = {
  avalanche: 35,
  arbitrum: 3200,
  optimism: 3200,
};

// Custom error classes for better error categorization
class ExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable: boolean = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}

class TransactionRevertedError extends ExecutionError {
  constructor(
    message: string,
    public readonly reason?: string,
    public readonly txHash?: string,
  ) {
    super("TRANSACTION_REVERTED", message, false, { reason, txHash });
    this.name = "TransactionRevertedError";
  }
}

class ContractNotDeployedError extends ExecutionError {
  constructor(network: string) {
    super(
      "CONTRACT_NOT_DEPLOYED",
      `No contract deployed on ${network}`,
      false,
      { network },
    );
    this.name = "ContractNotDeployedError";
  }
}

class PrivateKeyMissingError extends ExecutionError {
  constructor() {
    super("PRIVATE_KEY_MISSING", "No private key configured", false);
    this.name = "PrivateKeyMissingError";
  }
}

class NetworkError extends ExecutionError {
  constructor(message: string, public readonly network: string) {
    super("NETWORK_ERROR", message, true, { network });
    this.name = "NetworkError";
  }
}

class GasEstimationError extends ExecutionError {
  constructor(message: string) {
    super("GAS_ESTIMATION_ERROR", message, true);
    this.name = "GasEstimationError";
  }
}

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

function parseExecutionError(error: unknown): {
  message: string;
  code?: string;
  reason?: string;
  isRevert: boolean;
  details?: Record<string, unknown>;
} {
  if (error instanceof ExecutionError) {
    return {
      message: error.message,
      code: error.code,
      reason: (error.details?.reason as string) ?? undefined,
      isRevert: error.code === "TRANSACTION_REVERTED",
      details: error.details,
    };
  }

  const err = error as Error & { code?: string; reason?: string; transaction?: unknown };
  const message = err.message || String(error);

  const isRevert =
    message.includes("revert") ||
    message.includes("execution reverted") ||
    message.includes("CALL_EXCEPTION") ||
    message.includes("transaction failed") ||
    err.code === "CALL_EXCEPTION" ||
    err.code === "UNPREDICTABLE_GAS_LIMIT";

  let reason: string | undefined;
  if (err.reason) {
    reason = err.reason;
  } else if (message.includes("execution reverted")) {
    const match = message.match(/reverted[:\s]+(.+?)(?:\n|$)/i);
    reason = match?.[1]?.trim();
  }

  return {
    message,
    code: err.code,
    reason,
    isRevert,
    details: err.transaction ? { transaction: err.transaction } : undefined,
  };
}

export async function executeFlashLoan(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
): Promise<TradeRecord> {
  const startTime = Date.now();
  const executedAt = new Date().toISOString();
  const gasEstimate = estimateGas(opp.network);
  const oppId = opp.id;

  log.info({
    oppId,
    network: opp.network,
    buyDex: opp.buyDex,
    sellDex: opp.sellDex,
    expectedProfit: opp.estimatedProfit,
    profitPct: opp.profitPct,
  }, "Starting flash loan execution");

  logTradeEvent("execution_started", {
    oppId,
    network: opp.network,
    buyDex: opp.buyDex,
    sellDex: opp.sellDex,
    expectedProfit: opp.estimatedProfit,
  });

  const contractAddress = CONTRACT_ADDRESSES[opp.network] ?? undefined;
  const usdtAddress = USDT_ADDRESSES[opp.network];
  const wbtcAddress = WBTC_ADDRESSES[opp.network];

  // Pre-flight validation
  if (!contractAddress) {
    const error = new ContractNotDeployedError(opp.network);
    logError("flashloan-executor", "preflight", error, { oppId });
    logTradeEvent("execution_failed", { oppId, reason: error.message, code: error.code });

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
      errorMessage: error.message,
      errorDetails: { code: error.code },
    };
  }

  if (!config.privateKey) {
    const error = new PrivateKeyMissingError();
    logError("flashloan-executor", "preflight", error, { oppId });
    logTradeEvent("execution_failed", { oppId, reason: error.message, code: error.code });

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
      errorMessage: error.message,
      errorDetails: { code: error.code },
    };
  }

  try {
    log.debug({ oppId, contract: contractAddress }, "Connecting to network");

    const provider = new ethers.JsonRpcProvider(RPC_URLS[opp.network]);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const bot = new ethers.Contract(contractAddress, BOT_ABI, wallet);

    // Log wallet info
    const walletBalance = await provider.getBalance(wallet.address);
    log.debug({
      oppId,
      wallet: wallet.address,
      balance: ethers.formatEther(walletBalance),
      contract: contractAddress,
    }, "Wallet connected");

    const loanAmountRaw = ethers.parseUnits(String(FLASH_LOAN_AMOUNT_USDT), LOAN_DECIMALS);
    const minProfitRaw = ethers.parseUnits(MIN_PROFIT_USD, LOAN_DECIMALS);
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS;

    // Fetch gas data with error handling
    log.trace({ oppId }, "Fetching fee data");
    let feeData: ethers.FeeData;
    try {
      feeData = await provider.getFeeData();
      log.trace({
        oppId,
        gasPrice: feeData.gasPrice?.toString(),
        maxFee: feeData.maxFeePerGas?.toString(),
        maxPriority: feeData.maxPriorityFeePerGas?.toString(),
      }, "Fee data retrieved");
    } catch (feeError) {
      log.warn({ oppId, error: String(feeError) }, "Failed to fetch fee data, using defaults");
      feeData = {
        gasPrice: ethers.parseUnits("0.15", "gwei"),
        maxFeePerGas: ethers.parseUnits("0.15", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
      } as ethers.FeeData;
    }

    const maxFeePerGas = feeData.maxFeePerGas ? feeData.maxFeePerGas * 12n / 10n : ethers.parseUnits("0.165", "gwei");
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      ? feeData.maxPriorityFeePerGas * 11n / 10n
      : ethers.parseUnits("0.011", "gwei");

    const txOptions: Record<string, unknown> = {
      gasLimit: 1_200_000,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };

    const params = {
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
    };

    log.info({
      oppId,
      params: {
        ...params,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        buyDexId: params.buyDexId,
        sellDexId: params.sellDexId,
        loanAmount: FLASH_LOAN_AMOUNT_USDT,
      },
      gas: {
        maxFee: ethers.formatUnits(maxFeePerGas, "gwei"),
        maxPriority: ethers.formatUnits(maxPriorityFeePerGas, "gwei"),
      },
    }, "Transaction parameters prepared");

    // Execute transaction
    log.debug({ oppId }, "Initiating arbitrage transaction");
    const txStartTime = Date.now();

    let tx: ethers.ContractTransactionResponse;
    try {
      tx = await bot.initiateArbitrage(params, txOptions);
      logTradeEvent("transaction_sent", {
        oppId,
        txHash: tx.hash,
        network: opp.network,
      });
      log.info({ oppId, txHash: tx.hash }, "Transaction submitted");
    } catch (txError: unknown) {
      const parsed = parseExecutionError(txError);
      log.error({
        oppId,
        error: parsed.message,
        code: parsed.code,
        reason: parsed.reason,
      }, "Transaction submission failed");
      throw txError;
    }

    log.debug({ oppId, txHash: tx.hash }, "Waiting for transaction confirmation");

    let receipt: ethers.TransactionReceipt | null;
    try {
      receipt = await tx.wait(1);
      logPerformance("flashloan-executor", "transaction_confirm", txStartTime, { oppId, txHash: tx.hash });
    } catch (waitError) {
      log.warn({ oppId, txHash: tx.hash, error: String(waitError) }, "Transaction wait failed, checking status");
      receipt = await provider.getTransactionReceipt(tx.hash);

      if (!receipt) {
        log.error({ oppId, txHash: tx.hash }, "Transaction receipt not found");
        throw new NetworkError("Transaction receipt not found", opp.network);
      }
    }

    const success = receipt?.status === 1;

    // Calculate gas cost
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

    const duration = Date.now() - startTime;

    if (success) {
      log.info({
        oppId,
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed?.toString(),
        gasCostUsd,
        durationMs: duration,
      }, "Flash loan execution successful");

      logTradeEvent("execution_success", {
        oppId,
        txHash: receipt?.hash,
        profit: opp.estimatedProfit,
        gasCost: gasCostUsd,
        gasUsed: receipt?.gasUsed?.toString(),
      });

      return {
        id: generateId(),
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        network: opp.network,
        buyPrice: opp.buyPrice,
        sellPrice: opp.sellPrice,
        loanAmount: FLASH_LOAN_AMOUNT_USDT,
        profit: parseFloat(opp.estimatedProfit.toFixed(4)),
        profitPct: parseFloat(((opp.estimatedProfit / FLASH_LOAN_AMOUNT_USDT) * 100).toFixed(4)),
        gasCost: gasCostUsd,
        gasSource: config.gasSource,
        txHash: receipt?.hash,
        status: "success",
        executedAt,
      };
    } else {
      log.error({
        oppId,
        txHash: receipt?.hash,
        status: receipt?.status,
        gasUsed: receipt?.gasUsed?.toString(),
      }, "Flash loan transaction reverted");

      logTradeEvent("transaction_reverted", {
        oppId,
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
      });

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
        gasCost: gasCostUsd,
        gasSource: config.gasSource,
        txHash: receipt?.hash,
        status: "reverted",
        executedAt,
        errorMessage: "Transaction reverted on-chain",
        errorDetails: {
          reason: "Transaction reverted",
          transaction: receipt?.hash,
        },
      };
    }
  } catch (err: unknown) {
    const parsedError = parseExecutionError(err);
    const isRevert = parsedError.isRevert;

    log.error({
      oppId,
      error: parsedError.message,
      code: parsedError.code,
      reason: parsedError.reason,
      isRevert,
    }, "Flash loan execution failed");

    logTradeEvent("execution_failed", {
      oppId,
      reason: parsedError.message,
      code: parsedError.code,
    });

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
      errorMessage: parsedError.message.slice(0, 200),
      errorDetails: {
        code: parsedError.code,
        reason: parsedError.reason,
      },
    };
  }
}
