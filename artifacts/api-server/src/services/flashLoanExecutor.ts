import { ethers } from "ethers";
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

// Aave V3 Pool address (same on all three networks)
const AAVE_V3_POOL: Record<string, string> = {
  avalanche: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  arbitrum:  "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism:  "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// ArbitrageBot.sol deployed addresses
const CONTRACT_ADDRESSES: Record<string, string> = {
  avalanche: "",
  arbitrum:  "0x818D057F20A6aC398046444e156981B2d9FD500C",
  optimism:  "",
};

// USDT token addresses per network
const USDT_ADDRESSES: Record<string, string> = {
  avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
  arbitrum:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  optimism:  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
};

// WBTC token addresses per network
const WBTC_ADDRESSES: Record<string, string> = {
  avalanche: "0x50b7545627a5162F82A992c33b87aDc75187B218",
  arbitrum:  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  optimism:  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
};

// Public RPC endpoints per network
const RPC_URLS: Record<string, string> = {
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  arbitrum:  "https://arb1.arbitrum.io/rpc",
  optimism:  "https://mainnet.optimism.io",
};

// DEX name → uint8 ID registered in deploy.js
const DEX_ID: Record<string, number> = {
  // Avalanche (deployed IDs 0-3)
  "Trader Joe V2.1": 0,
  "Pangolin":        1,
  "SushiSwap":       2,
  "GMX":             3,
  // Arbitrum (deployed IDs 0-4)
  "Uniswap V3":  0,
  // SushiSwap already 2 for Avalanche; on Arbitrum it's also ID 1
  "Camelot V3":  2,
  "Balancer V2": 4,
  // Optimism (deployed IDs 0-3)
  "Velodrome V2": 1,
  "Beethoven X":  2,
  "Curve":        3,
};

// Per-network SushiSwap DEX ID (different on Avalanche vs Arbitrum)
const SUSHISWAP_ID: Record<string, number> = {
  avalanche: 2,
  arbitrum:  1,
  optimism:  2,
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
const AAVE_FEE_PCT            = 0.0005;
const DEADLINE_BUFFER_SECONDS = 60;
const LOAN_DECIMALS           = 6; // USDT has 6 decimals
const MIN_PROFIT_USD          = "0.50"; // $0.50 minimum net profit enforced on-chain

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
  arbitrum:  2400,
  optimism:  2400,
};

function estimateGas(network: string): GasEstimate {
  const gasPricesGwei: Record<string, number> = {
    avalanche: 30,
    arbitrum:  0.1,
    optimism:  0.001,
  };
  const gasUnits: Record<string, number> = {
    avalanche: 400_000,
    arbitrum:  800_000,
    optimism:  600_000,
  };
  const gasPriceGwei     = gasPricesGwei[network] ?? 1;
  const estimatedGasUnits = gasUnits[network] ?? 500_000;
  const nativePrice      = NATIVE_TOKEN_PRICES[network] ?? 1;
  const gasCostNative    = (gasPriceGwei * estimatedGasUnits) / 1e9;
  const gasCostUsd       = gasCostNative * nativePrice;
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
  const executedAt  = new Date().toISOString();
  const gasEstimate = estimateGas(opp.network);

  logger.info(
    { opp: opp.id, network: opp.network, buyDex: opp.buyDex, sellDex: opp.sellDex },
    "Executing flash loan arbitrage (live)",
  );

  const deadline        = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS;
  const contractAddress = CONTRACT_ADDRESSES[opp.network];
  const usdtAddress     = USDT_ADDRESSES[opp.network];
  const wbtcAddress     = WBTC_ADDRESSES[opp.network];

  // Guard: network must have a deployed contract
  if (!contractAddress) {
    return {
      id: generateId(),
      buyDex: opp.buyDex, sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0, profitPct: 0,
      gasCost: 0, gasSource: config.gasSource,
      txHash: undefined, status: "failed", executedAt,
      errorMessage: `No contract deployed on ${opp.network} — add address to CONTRACT_ADDRESSES`,
    };
  }

  // Guard: private key required
  if (!config.privateKey) {
    return {
      id: generateId(),
      buyDex: opp.buyDex, sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0, profitPct: 0,
      gasCost: 0, gasSource: config.gasSource,
      txHash: undefined, status: "failed", executedAt,
      errorMessage: "No private key configured — set it in Settings",
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URLS[opp.network]);
    const wallet   = new ethers.Wallet(config.privateKey, provider);
    const bot      = new ethers.Contract(contractAddress, BOT_ABI, wallet);

    const loanAmountRaw = ethers.parseUnits(String(FLASH_LOAN_AMOUNT_USDT), LOAN_DECIMALS);
    const minProfitRaw  = ethers.parseUnits(MIN_PROFIT_USD, LOAN_DECIMALS);

    const feeData    = await provider.getFeeData();
    const gasPrice   = feeData.gasPrice != null
      ? feeData.gasPrice * 110n / 100n  // +10% bump to beat competing txs
      : undefined;

    logger.info(
      {
        contract: contractAddress,
        buyDex: opp.buyDex, sellDex: opp.sellDex,
        buyDexId: resolveDexId(opp.buyDex, opp.network),
        sellDexId: resolveDexId(opp.sellDex, opp.network),
        loanAmount: FLASH_LOAN_AMOUNT_USDT,
        deadline,
      },
      "Sending initiateArbitrage transaction",
    );

    const tx = await bot.initiateArbitrage(
      {
        buyDexId:    resolveDexId(opp.buyDex,  opp.network),
        sellDexId:   resolveDexId(opp.sellDex, opp.network),
        tokenBorrow: usdtAddress,
        tokenBuy:    wbtcAddress,
        loanAmount:  loanAmountRaw,
        minProfit:   minProfitRaw,
        deadline:    BigInt(deadline),
        hops:        opp.hops ?? 1,
        hopDexId:    0,
        hopToken:    ethers.ZeroAddress,
      },
      { ...(gasPrice != null && { gasPrice }) },
    );

    logger.info({ txHash: tx.hash }, "Transaction submitted — waiting for receipt");

    const receipt = await tx.wait();
    const success = receipt?.status === 1;

    const gasCostUsd = receipt
      ? parseFloat(
          (
            Number(receipt.gasUsed) *
            Number(feeData.gasPrice ?? 0n) /
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
      buyDex: opp.buyDex, sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit:    success ? parseFloat(opp.estimatedProfit.toFixed(4)) : 0,
      profitPct: success
        ? parseFloat(((opp.estimatedProfit / FLASH_LOAN_AMOUNT_USDT) * 100).toFixed(4))
        : 0,
      gasCost:   gasCostUsd,
      gasSource: config.gasSource,
      txHash:    receipt?.hash,
      status:    success ? "success" : "reverted",
      executedAt,
      errorMessage: success ? undefined : "Transaction reverted on-chain",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, opp: opp.id }, "Flash loan execution threw");

    // Distinguish revert (contract rejected) from infra errors
    const isRevert = message.includes("revert") ||
                     message.includes("execution reverted") ||
                     message.includes("CALL_EXCEPTION");

    return {
      id: generateId(),
      buyDex: opp.buyDex, sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT_USDT,
      profit: 0, profitPct: 0,
      gasCost: parseFloat(gasEstimate.gasCostUsd.toFixed(4)),
      gasSource: config.gasSource,
      txHash: undefined,
      status: isRevert ? "reverted" : "failed",
      executedAt,
      errorMessage: message.slice(0, 200),
    };
  }
}
