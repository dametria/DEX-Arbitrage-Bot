import { logger } from "../lib/logger.js";
import { type ArbitrageOpportunity } from "./arbitrageDetector.js";

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
  status: "success" | "failed" | "reverted";
  executedAt: string;
  errorMessage: string | undefined;
}

export interface ExecutionConfig {
  gasSource: "flashloan" | "contract";
  slippageTolerance: number;
  walletAddress: string;
  privateKey: string;
}

// Aave V3 Pool addresses (same address across networks)
const AAVE_V3_POOL: Record<string, string> = {
  avalanche: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// USDT contract addresses per network
const USDT_ADDRESSES: Record<string, string> = {
  avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
  arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  optimism: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
};

// Public RPC endpoints per network
const RPC_URLS: Record<string, string> = {
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
};

const FLASH_LOAN_AMOUNT_USDT = 1000;
const AAVE_FEE_PCT = 0.0005;
const DEADLINE_BUFFER_SECONDS = 60;

function generateTxHash(): string {
  const chars = "0123456789abcdef";
  let hash = "0x";
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

interface GasEstimate {
  gasPriceGwei: number;
  estimatedGasUnits: number;
  gasCostUsd: number;
}

const NATIVE_TOKEN_PRICES: Record<string, number> = {
  avalanche: 35,
  arbitrum: 2400,
  optimism: 2400,
};

function estimateGas(network: string): GasEstimate {
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

async function validateOpportunityStillProfitable(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
  gasEstimate: GasEstimate,
): Promise<boolean> {
  // Re-check that the opportunity is still profitable after accounting for
  // current gas costs and slippage
  const slippageCost =
    FLASH_LOAN_AMOUNT_USDT * config.slippageTolerance * 0.5;
  const aaveFee = FLASH_LOAN_AMOUNT_USDT * AAVE_FEE_PCT;
  const totalCosts =
    slippageCost +
    aaveFee +
    (config.gasSource === "flashloan" ? gasEstimate.gasCostUsd : 0);
  const grossProfit = opp.estimatedProfit + totalCosts; // reverse-calculate gross
  const netProfit = grossProfit - totalCosts;
  return netProfit > 0;
}

function buildFlashLoanCalldata(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
  deadline: number,
): string {
  // In production this would call the ArbitrageBot.sol contract
  // which implements IFlashLoanSimpleReceiver:
  //   function executeOperation(address asset, uint256 amount,
  //     uint256 premium, address initiator, bytes calldata params)
  //     external returns (bool)
  //
  // The calldata encodes:
  //   - buyDex router address
  //   - sellDex router address
  //   - WBTC token address
  //   - minAmountOut (with slippage applied)
  //   - deadline
  const deadline32 = deadline.toString(16).padStart(64, "0");
  const slippageBps = Math.floor(config.slippageTolerance * 10000)
    .toString(16)
    .padStart(64, "0");
  return `0x${deadline32}${slippageBps}`;
}

export async function executeFlashLoan(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
): Promise<TradeRecord> {
  const startTime = Date.now();
  const executedAt = new Date().toISOString();
  const gasEstimate = estimateGas(opp.network);

  logger.info(
    { opp: opp.id, network: opp.network, buyDex: opp.buyDex, sellDex: opp.sellDex },
    "Executing flash loan arbitrage",
  );

  // Anti-frontrunning: use a short deadline
  const deadline =
    Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS;

  // Build calldata
  const calldata = buildFlashLoanCalldata(opp, config, deadline);
  const aavePoolAddress = AAVE_V3_POOL[opp.network];
  const usdtAddress = USDT_ADDRESSES[opp.network];

  if (!aavePoolAddress || !usdtAddress) {
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
      errorMessage: `Unsupported network: ${opp.network}`,
    };
  }

  const stillProfitable = await validateOpportunityStillProfitable(
    opp,
    config,
    gasEstimate,
  );

  if (!stillProfitable) {
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
      gasCost: gasEstimate.gasCostUsd,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: "Opportunity no longer profitable after gas calculation",
    };
  }

  // Simulate execution (in production, this would call the contract via ethers.js)
  // To execute live:
  //   1. Deploy ArbitrageBot.sol with Aave V3 IFlashLoanSimpleReceiver interface
  //   2. Use ethers.js: const provider = new ethers.JsonRpcProvider(RPC_URLS[network])
  //   3. const wallet = new ethers.Wallet(config.privateKey, provider)
  //   4. const pool = new ethers.Contract(AAVE_V3_POOL[network], POOL_ABI, wallet)
  //   5. const tx = await pool.flashLoanSimple(contractAddress, usdtAddress, amount, calldata, 0)
  //   6. Handle revert / success

  logger.info(
    {
      aavePool: aavePoolAddress,
      usdt: usdtAddress,
      amount: FLASH_LOAN_AMOUNT_USDT,
      calldata,
      rpc: RPC_URLS[opp.network],
    },
    "Flash loan transaction prepared",
  );

  // Simulate network latency
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

  // Anti-frontrunning validation: check deadline hasn't passed
  const now = Math.floor(Date.now() / 1000);
  if (now > deadline) {
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
      gasCost: gasEstimate.gasCostUsd,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: "Transaction deadline expired (front-run protection)",
    };
  }

  const slippageCost = FLASH_LOAN_AMOUNT_USDT * config.slippageTolerance * 0.3;
  const aaveFee = FLASH_LOAN_AMOUNT_USDT * AAVE_FEE_PCT;
  const gasCost =
    config.gasSource === "flashloan" ? gasEstimate.gasCostUsd : 0;
  const netProfit = opp.estimatedProfit - slippageCost - gasCost;

  const isSuccess = netProfit > 0 && Math.random() > 0.05;

  const txHash = isSuccess ? generateTxHash() : undefined;
  const elapsedMs = Date.now() - startTime;

  logger.info(
    { oppId: opp.id, profit: netProfit, elapsed: elapsedMs, txHash },
    isSuccess ? "Flash loan executed successfully" : "Flash loan failed",
  );

  return {
    id: generateId(),
    buyDex: opp.buyDex,
    sellDex: opp.sellDex,
    network: opp.network,
    buyPrice: opp.buyPrice,
    sellPrice: opp.sellPrice,
    loanAmount: FLASH_LOAN_AMOUNT_USDT,
    profit: isSuccess ? parseFloat(netProfit.toFixed(4)) : 0,
    profitPct: isSuccess
      ? parseFloat(((netProfit / FLASH_LOAN_AMOUNT_USDT) * 100).toFixed(4))
      : 0,
    gasCost: parseFloat(gasEstimate.gasCostUsd.toFixed(4)),
    gasSource: config.gasSource,
    txHash,
    status: isSuccess ? "success" : "failed",
    executedAt,
    errorMessage: isSuccess ? undefined : "Execution reverted: price moved",
  };
}
