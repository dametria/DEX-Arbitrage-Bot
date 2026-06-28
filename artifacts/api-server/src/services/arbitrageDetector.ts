import { type DexPrice } from "./priceMonitor.js";

export interface ArbitrageOpportunity {
  id: string;
  buyDex: string;
  sellDex: string;
  network: string;
  buyPrice: number;
  sellPrice: number;
  profitPct: number;
  estimatedProfit: number;
  hops: number;
  detectedAt: string;
  status: "pending" | "executing" | "executed" | "failed" | "expired";
}

const FLASH_LOAN_AMOUNT = 100_000;
const AAVE_FLASH_FEE_PCT = 0.0009; // Aave V3 actual fee = 0.09% (not 0.05%)
// Realistic price impact for a $100,000 swap on deep WBTC pools.
// At $100k vs a $500k+ pool, price impact is roughly 0.05% per leg.
// Smaller swaps would be less; larger swaps would be more.
const EXPECTED_PRICE_IMPACT_PCT = 0.0005;

// Trading fee charged by each DEX (taken from amountIn before swap).
// These are real fees paid to LPs on every swap — they are NOT optional.
// A trade is only profitable if spread > buyFee + sellFee + aaveFee + slippage + gas.
const DEX_TRADE_FEE_PCT: Record<string, number> = {
  // Arbitrum
  "Uniswap V3":  0.0005,   // fee-500 = 0.05%
  "SushiSwap":   0.003,    // UniV2 = 0.30%
  "Camelot V3":  0.0005,   // V3-style ≈ 0.05%
  // Avalanche
  "Trader Joe V2.1": 0.002, // LB V2.1 typical bin fee ≈ 0.20%
  "Pangolin":    0.003,    // UniV2 fork = 0.30%
  // Optimism
  "Velodrome V2": 0.002,   // volatile pools = 0.20%
  "Beethoven X":  0.003,   // Balancer-style ≈ 0.30%
  "Curve":        0.0004,  // Curve stable = 0.04%
};

function getDexFeePct(dexName: string): number {
  return DEX_TRADE_FEE_PCT[dexName] ?? 0.003; // default to 0.30% if unknown
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

function estimateGasCostUsd(network: string): number {
  // Flash loan arb involves: approval × 2, swap × 2, loan repay — typically 500-600k gas.
  // Real costs on each network at normal gas prices (not congestion peaks):
  const gasCosts: Record<string, number> = {
    arbitrum: 5.0,  // ~500k gas × ~0.01 gwei × ETH price; Arbitrum L2 fees ~$3-8 in practice
    avalanche: 3.0, // AVAX gas cheaper but still ~$2-4 for complex txs
    optimism: 2.0,  // OP stack: L2 execution cheap, L1 data fee adds ~$1-2
  };
  return gasCosts[network] ?? 5.0;
}

function estimateProfit(
  buyPrice: number,
  sellPrice: number,
  loanAmount: number,
  network: string,
  buyDex: string,
  sellDex: string,
): { net: number; gross: number } {
  const wbtcAmount = loanAmount / buyPrice;
  const grossProceeds = wbtcAmount * sellPrice;

  const aaveFee      = loanAmount * AAVE_FLASH_FEE_PCT;
  const slippageCost = loanAmount * EXPECTED_PRICE_IMPACT_PCT;
  const gasCost      = estimateGasCostUsd(network);

  // DEX trading fees are paid from the swap amounts, not additional charges.
  // Approximate: buyFee reduces effective USDT going into the swap,
  // sellFee reduces effective WBTC going into the sell leg.
  const buyFeeCost  = loanAmount * getDexFeePct(buyDex);
  const sellFeeCost = loanAmount * getDexFeePct(sellDex);

  const net = grossProceeds - loanAmount - aaveFee - slippageCost - gasCost - buyFeeCost - sellFeeCost;
  const gross = grossProceeds - loanAmount;
  return { net, gross };
}

export function detectOpportunities(
  prices: DexPrice[],
  minProfitPct: number,
  networks: string[],
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  const now = new Date().toISOString();

  const filtered = prices.filter((p) => networks.includes(p.network));

  const byNetwork = new Map<string, DexPrice[]>();
  for (const price of filtered) {
    const list = byNetwork.get(price.network) ?? [];
    list.push(price);
    byNetwork.set(price.network, list);
  }

  for (const [network, networkPrices] of byNetwork) {
    if (networkPrices.length < 2) continue;

    for (let i = 0; i < networkPrices.length; i++) {
      for (let j = 0; j < networkPrices.length; j++) {
        if (i === j) continue;
        const buy = networkPrices[i]!;
        const sell = networkPrices[j]!;

        // Skip any pair where either price is simulated — no real pool → trade will revert
        if (buy.isSimulated || sell.isSimulated) continue;

        if (buy.liquidity < 50_000 || sell.liquidity < 50_000) continue;

        const rawSpreadPct = ((sell.price - buy.price) / buy.price) * 100;
        if (rawSpreadPct < minProfitPct) continue;

        const { net, gross } = estimateProfit(
          buy.price,
          sell.price,
          FLASH_LOAN_AMOUNT,
          network,
          buy.dex,
          sell.dex,
        );

        if (net <= 0) continue;

        const netProfitPct = (net / FLASH_LOAN_AMOUNT) * 100;

        opportunities.push({
          id: generateId(),
          buyDex: buy.dex,
          sellDex: sell.dex,
          network,
          buyPrice: buy.price,
          sellPrice: sell.price,
          profitPct: parseFloat(netProfitPct.toFixed(4)),
          estimatedProfit: parseFloat(net.toFixed(4)),
          hops: 1,
          detectedAt: now,
          status: "pending",
        });
      }
    }

    // 2-hop routes: buy → intermediate DEX → sell
    for (let i = 0; i < networkPrices.length; i++) {
      for (let k = 0; k < networkPrices.length; k++) {
        if (i === k) continue;
        for (let j = 0; j < networkPrices.length; j++) {
          if (j === i || j === k) continue;

          const buy = networkPrices[i]!;
          const mid = networkPrices[j]!;
          const sell = networkPrices[k]!;

          // Skip any leg with simulated prices — phantom pools cause on-chain reverts
          if (buy.isSimulated || mid.isSimulated || sell.isSimulated) continue;

          if (
            buy.liquidity < 50_000 ||
            mid.liquidity < 50_000 ||
            sell.liquidity < 50_000
          )
            continue;

          if (sell.price <= buy.price) continue;

          const rawSpreadPct = ((sell.price - buy.price) / buy.price) * 100;
          if (rawSpreadPct < minProfitPct * 1.5) continue;

          const { net } = estimateProfit(
            buy.price,
            sell.price,
            FLASH_LOAN_AMOUNT,
            network,
            buy.dex,
            sell.dex,
          );

          const extraHopCost = 0.3;
          const adjNet = net - extraHopCost;
          if (adjNet <= 0) continue;

          const netProfitPct = (adjNet / FLASH_LOAN_AMOUNT) * 100;

          opportunities.push({
            id: generateId(),
            buyDex: buy.dex,
            sellDex: sell.dex,
            network,
            buyPrice: buy.price,
            sellPrice: sell.price,
            profitPct: parseFloat(netProfitPct.toFixed(4)),
            estimatedProfit: parseFloat(adjNet.toFixed(4)),
            hops: 2,
            detectedAt: now,
            status: "pending",
          });
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.profitPct - a.profitPct).slice(0, 50);
}
