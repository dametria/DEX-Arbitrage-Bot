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

const FLASH_LOAN_AMOUNT = 10_000;
const AAVE_FLASH_FEE_PCT = 0.0005;
// Realistic price impact for a $1,000 swap against multi-million-dollar DEX liquidity
// is typically <0.05% per leg. SLIPPAGE_TOLERANCE (1%) is a max safety parameter,
// not the expected execution cost. We model 0.1% total impact across both legs.
const EXPECTED_PRICE_IMPACT_PCT = 0.001;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

function estimateGasCostUsd(network: string): number {
  const gasCosts: Record<string, number> = {
    avalanche: 0.8,
    arbitrum: 0.5,
    optimism: 0.4,
  };
  return gasCosts[network] ?? 1.0;
}

function estimateProfit(
  buyPrice: number,
  sellPrice: number,
  loanAmount: number,
  network: string,
): { net: number; gross: number } {
  const wbtcAmount = loanAmount / buyPrice;
  const grossProceeds = wbtcAmount * sellPrice;
  const aaveFee = loanAmount * AAVE_FLASH_FEE_PCT;
  const slippageCost = loanAmount * EXPECTED_PRICE_IMPACT_PCT;
  const gasCost = estimateGasCostUsd(network);
  const net = grossProceeds - loanAmount - aaveFee - slippageCost - gasCost;
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

        if (buy.liquidity < 50_000 || sell.liquidity < 50_000) continue;

        const rawSpreadPct = ((sell.price - buy.price) / buy.price) * 100;
        if (rawSpreadPct < minProfitPct) continue;

        const { net, gross } = estimateProfit(
          buy.price,
          sell.price,
          FLASH_LOAN_AMOUNT,
          network,
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
