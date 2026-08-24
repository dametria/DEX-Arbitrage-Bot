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

// ArbitrageBot.sol deployed addresses (Balancer flash-loan bytecode)
const CONTRACT_ADDRESSES: Record<string, string> = {
  avalanche: "",
  arbitrum:  "0xa9f98c9254B3918a811e449E24e6e22CA34965C2",
  optimism:  "",
};

const USDT_ADDRESSES: Record<string, string> = {
  avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
  arbitrum:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  optimism:  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
};

const USDC_ADDRESSES: Record<string, string> = {
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  arbitrum:  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism:  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

const WETH_ADDRESSES: Record<string, string> = {
  avalanche: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  arbitrum:  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  optimism:  "0x4200000000000000000000000000000000000006",
};

const WBTC_ADDRESSES: Record<string, string> = {
  avalanche: "0x50b7545627a5162F82A992c33b87aDc75187B218",
  arbitrum:  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  optimism:  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
};

const RPC_URLS: Record<string, string> = {
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  arbitrum:  "https://arb1.arbitrum.io/rpc",
  optimism:  "https://mainnet.optimism.io",
};

const DEX_ID: Record<string, number> = {
  "avalanche:Trader Joe V2.1": 0,
  "avalanche:Pangolin":        1,
  "avalanche:SushiSwap":       2,
  "arbitrum:Uniswap V3":       0,
  "arbitrum:SushiSwap":        1,
  "arbitrum:Camelot V3":       2,
  "arbitrum:PancakeSwap V3":   3,
  "arbitrum:Fluid":            4,
  "optimism:Uniswap V3":       0,
  "optimism:Velodrome V2":     1,
  "optimism:Beethoven X":      2,
  "optimism:Curve":            3,
  "Trader Joe V2.1": 0,
  "Pangolin":        1,
  "Uniswap V3":      0,
  "Camelot V3":      2,
  "PancakeSwap V3":  3,
  "Fluid":           4,
  "Velodrome V2":    1,
  "Beethoven X":     2,
  "Curve":           3,
};

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

// Aligned with arbitrageDetector FLASH_LOAN_AMOUNT; Balancer flash fee = 0
const FLASH_LOAN_AMOUNT = 50_000;
const DEADLINE_BUFFER_SECONDS = 60;
const LOAN_DECIMALS = 6; // USDC / USDT
const MIN_PROFIT_USD = "0.10";

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
  arbitrum:  3500,
  optimism:  3500,
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
  const gasPriceGwei = gasPricesGwei[network] ?? 1;
  const estimatedGasUnits = gasUnits[network] ?? 500_000;
  const nativePrice = NATIVE_TOKEN_PRICES[network] ?? 1;
  const gasCostNative = (gasPriceGwei * estimatedGasUnits) / 1e9;
  const gasCostUsd = gasCostNative * nativePrice;
  return { gasPriceGwei, estimatedGasUnits, gasCostUsd };
}

function resolveDexId(dexName: string, network: string): number {
  if (dexName === "SushiSwap") return SUSHISWAP_ID[network] ?? 2;
  const qualifiedId = DEX_ID[`${network}:${dexName}`];
  if (qualifiedId !== undefined) return qualifiedId;
  return DEX_ID[dexName] ?? 0;
}

/** Default pair for Arbitrum MEV volume: borrow USDC, trade vs WETH. */
function resolveTokens(network: string): { borrow: string; buy: string } {
  if (network === "arbitrum") {
    return {
      borrow: USDC_ADDRESSES.arbitrum!,
      buy: WETH_ADDRESSES.arbitrum!,
    };
  }
  return {
    borrow: USDT_ADDRESSES[network] ?? USDT_ADDRESSES.arbitrum!,
    buy: WBTC_ADDRESSES[network] ?? WBTC_ADDRESSES.arbitrum!,
  };
}

export async function executeFlashLoan(
  opp: ArbitrageOpportunity,
  config: ExecutionConfig,
): Promise<TradeRecord> {
  const executedAt = new Date().toISOString();
  const gasEstimate = estimateGas(opp.network);

  logger.info(
    { opp: opp.id, network: opp.network, buyDex: opp.buyDex, sellDex: opp.sellDex },
    "Executing flash loan arbitrage (live)",
  );

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS;
  const contractAddress = CONTRACT_ADDRESSES[opp.network];
  const { borrow: tokenBorrow, buy: tokenBuy } = resolveTokens(opp.network);

  if (!contractAddress) {
    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT,
      profit: 0,
      profitPct: 0,
      gasCost: 0,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: `No contract deployed on ${opp.network} — add address to CONTRACT_ADDRESSES`,
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
      loanAmount: FLASH_LOAN_AMOUNT,
      profit: 0,
      profitPct: 0,
      gasCost: 0,
      gasSource: config.gasSource,
      txHash: undefined,
      status: "failed",
      executedAt,
      errorMessage: "No private key configured — set it in Settings",
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URLS[opp.network]);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const bot = new ethers.Contract(contractAddress, BOT_ABI, wallet);

    const loanAmountRaw = ethers.parseUnits(String(FLASH_LOAN_AMOUNT), LOAN_DECIMALS);
    const minProfitRaw = ethers.parseUnits(MIN_PROFIT_USD, LOAN_DECIMALS);

    const [feeData, pendingNonce, confirmedNonce] = await Promise.all([
      provider.getFeeData(),
      provider.getTransactionCount(wallet.address, "pending"),
      provider.getTransactionCount(wallet.address, "latest"),
    ]);

    if (pendingNonce > confirmedNonce) {
      const stuckMsg =
        `Stuck nonce detected: pending=${pendingNonce}, confirmed=${confirmedNonce}. ` +
        `Clear with a 0-ETH self-transfer at nonce ${confirmedNonce}.`;
      logger.warn({ pendingNonce, confirmedNonce }, stuckMsg);
      return {
        id: generateId(),
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        network: opp.network,
        buyPrice: opp.buyPrice,
        sellPrice: opp.sellPrice,
        loanAmount: FLASH_LOAN_AMOUNT,
        profit: 0,
        profitPct: 0,
        gasCost: 0,
        gasSource: config.gasSource,
        txHash: undefined,
        status: "failed",
        executedAt,
        errorMessage: stuckMsg,
      };
    }

    const maxPriorityFee = feeData.maxPriorityFeePerGas ?? 100_000_000n;
    const rawMaxFee = feeData.maxFeePerGas ?? 200_000_000n;
    const baseFee =
      rawMaxFee > maxPriorityFee ? rawMaxFee - maxPriorityFee : 100_000_000n;
    const maxFeePerGas = ((baseFee + maxPriorityFee) * 130n) / 100n;

    logger.info(
      {
        contract: contractAddress,
        tokenBorrow,
        tokenBuy,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        buyDexId: resolveDexId(opp.buyDex, opp.network),
        sellDexId: resolveDexId(opp.sellDex, opp.network),
        loanAmount: FLASH_LOAN_AMOUNT,
        deadline,
        nonce: confirmedNonce,
        maxFeePerGasGwei: Number(maxFeePerGas) / 1e9,
      },
      "Sending initiateArbitrage transaction",
    );

    const tx = await bot.initiateArbitrage(
      {
        buyDexId: resolveDexId(opp.buyDex, opp.network),
        sellDexId: resolveDexId(opp.sellDex, opp.network),
        tokenBorrow,
        tokenBuy,
        loanAmount: loanAmountRaw,
        minProfit: minProfitRaw,
        deadline: BigInt(deadline),
        hops: 1,
        hopDexId: 0,
        hopToken: ethers.ZeroAddress,
      },
      {
        gasLimit: 1_200_000n,
        maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFee,
        nonce: confirmedNonce,
      },
    );

    logger.info({ txHash: tx.hash }, "Transaction submitted — waiting for receipt");

    const receipt = await tx.wait();
    const success = receipt?.status === 1;

    const gasCostUsd = receipt
      ? parseFloat(
          (
            (Number(receipt.gasUsed) * Number(maxFeePerGas ?? 0n)) /
            1e18 *
            NATIVE_TOKEN_PRICES[opp.network]!
          ).toFixed(4),
        )
      : gasEstimate.gasCostUsd;

    logger.info(
      {
        txHash: receipt?.hash,
        status: receipt?.status,
        gasUsed: receipt?.gasUsed?.toString(),
      },
      success ? "Flash loan succeeded" : "Flash loan reverted",
    );

    return {
      id: generateId(),
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      network: opp.network,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      loanAmount: FLASH_LOAN_AMOUNT,
      profit: success ? parseFloat(opp.estimatedProfit.toFixed(4)) : 0,
      profitPct: success
        ? parseFloat(((opp.estimatedProfit / FLASH_LOAN_AMOUNT) * 100).toFixed(4))
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
      loanAmount: FLASH_LOAN_AMOUNT,
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
