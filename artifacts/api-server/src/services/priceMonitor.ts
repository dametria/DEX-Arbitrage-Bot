import { logger } from "../lib/logger.js";

export interface DexPrice {
  dex: string;
  network: string;
  /** Human pair label e.g. USDC-USDT, USDC-WETH, WBTC-USDT */
  pair: string;
  price: number;
  liquidity: number;
  updatedAt: string;
  /** true when price came from random simulation (no real GeckoTerminal pool found).
   *  Simulated prices MUST NOT be used to trigger real on-chain trades. */
  isSimulated: boolean;
}

interface DexConfig {
  name: string;
  geckoTerminalDex: string;
  geckoNetwork: string;
  network: "avalanche" | "arbitrum" | "optimism";
}

const DEX_CONFIGS: DexConfig[] = [
  // Avalanche
  { name: "Trader Joe V2.1", geckoTerminalDex: "traderjoe-v2-1", geckoNetwork: "avax", network: "avalanche" },
  { name: "Pangolin", geckoTerminalDex: "pangolin-v2", geckoNetwork: "avax", network: "avalanche" },
  { name: "SushiSwap", geckoTerminalDex: "sushiswap", geckoNetwork: "avax", network: "avalanche" },
  // Arbitrum — MEV volume leaders + Fluid / Pancake
  { name: "Uniswap V3", geckoTerminalDex: "uniswap-v3", geckoNetwork: "arbitrum", network: "arbitrum" },
  { name: "SushiSwap", geckoTerminalDex: "sushiswap-arbitrum", geckoNetwork: "arbitrum", network: "arbitrum" },
  { name: "Camelot V3", geckoTerminalDex: "camelot-v3", geckoNetwork: "arbitrum", network: "arbitrum" },
  { name: "PancakeSwap V3", geckoTerminalDex: "pancakeswap-v3-arbitrum", geckoNetwork: "arbitrum", network: "arbitrum" },
  { name: "Fluid", geckoTerminalDex: "fluid", geckoNetwork: "arbitrum", network: "arbitrum" },
  // Optimism
  { name: "Uniswap V3", geckoTerminalDex: "uniswap-v3-optimism", geckoNetwork: "optimism", network: "optimism" },
  { name: "Velodrome V2", geckoTerminalDex: "velodrome-v2", geckoNetwork: "optimism", network: "optimism" },
  { name: "Beethoven X", geckoTerminalDex: "beethoven-x", geckoNetwork: "optimism", network: "optimism" },
  { name: "Curve", geckoTerminalDex: "curve-optimism", geckoNetwork: "optimism", network: "optimism" },
];

/** Pairs prioritised from Arbitrum MEV volume breakdown */
const TARGET_PAIRS = [
  "USDC-USDT", "USDC-WETH", "USDT-WETH", "USDC-WBTC", "WBTC-USDT",
  "WETH-WBTC", "USDC-DAI", "USDT-DAI",
];

const PAIR_SYMBOLS: Record<string, string[]> = {
  USDC: ["USDC", "usdc", "USD Coin"],
  USDT: ["USDT", "usdt", "Tether"],
  WETH: ["WETH", "weth", "Wrapped Ether", "ETH"],
  WBTC: ["WBTC", "wbtc", "Wrapped Bitcoin"],
  DAI:  ["DAI", "dai"],
};

let priceCache: DexPrice[] = [];
let lastFetch: number = 0;
const CACHE_TTL = 10_000;

function matchPair(name: string): string | null {
  const upper = name.toUpperCase();
  for (const pair of TARGET_PAIRS) {
    const [a, b] = pair.split("-") as [string, string];
    const aSyms = PAIR_SYMBOLS[a] ?? [a];
    const bSyms = PAIR_SYMBOLS[b] ?? [b];
    const hasA = aSyms.some((s) => upper.includes(s.toUpperCase()));
    const hasB = bSyms.some((s) => upper.includes(s.toUpperCase()));
    if (hasA && hasB) return pair;
  }
  return null;
}

async function fetchNetworkPrices(
  geckoNetwork: string,
): Promise<Record<string, { price: number; liquidity: number; pair: string }>> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/pools?page=1&sort=h24_volume_usd_desc&include=base_token,quote_token,dex`;

  const res = await fetch(url, {
    headers: { Accept: "application/json;version=20230302" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`GeckoTerminal ${geckoNetwork} status ${res.status}`);
  }

  const json = (await res.json()) as {
    data: Array<{
      attributes: {
        name: string;
        base_token_price_usd: string;
        quote_token_price_usd: string;
        reserve_in_usd: string;
      };
      relationships: {
        dex: { data: { id: string } };
        base_token: { data: { id: string } };
      };
    }>;
    included?: Array<{ id: string; type: string; attributes: { symbol: string; name: string } }>;
  };

  const includedTokens = new Map<string, { symbol: string; name: string }>();
  if (json.included) {
    for (const inc of json.included) {
      if (inc.type === "token") {
        includedTokens.set(inc.id, {
          symbol: inc.attributes.symbol,
          name: inc.attributes.name,
        });
      }
    }
  }

  const result: Record<string, { price: number; liquidity: number; pair: string }> = {};

  for (const pool of json.data) {
    const name = pool.attributes.name ?? "";
    const pair = matchPair(name);
    if (!pair) continue;

    const baseTokenId = pool.relationships.base_token?.data?.id;
    const baseToken = baseTokenId ? includedTokens.get(baseTokenId) : null;

    let price = parseFloat(pool.attributes.base_token_price_usd) || 0;
    if (pair.includes("USDC") || pair.includes("USDT") || pair.includes("DAI")) {
      const isStablePair = (pair.match(/USDC|USDT|DAI/g) || []).length === 2;
      if (!isStablePair) {
        const baseIsStable = baseToken && ["USDC", "USDT", "DAI"].includes(baseToken.symbol.toUpperCase());
        if (baseIsStable) {
          price = parseFloat(pool.attributes.quote_token_price_usd) || price;
        }
      }
    }

    if (price <= 0) continue;

    const liquidity = parseFloat(pool.attributes.reserve_in_usd) || 0;
    const dexId = pool.relationships.dex?.data?.id ?? "";
    const key = `${dexId}:${pair}`;
    if (!result[key] || result[key]!.liquidity < liquidity) {
      result[key] = { price, liquidity, pair };
    }
  }

  return result;
}

function simulateFallbackPrices(): DexPrice[] {
  const now = new Date().toISOString();
  return DEX_CONFIGS.flatMap((cfg) =>
    TARGET_PAIRS.slice(0, 3).map((pair) => ({
      dex: cfg.name,
      network: cfg.network,
      pair,
      price: pair.includes("WETH") || pair.includes("WBTC") ? (pair.includes("WBTC") ? 65000 : 2500) : 1.0,
      liquidity: 500_000 + Math.random() * 2_000_000,
      updatedAt: now,
      isSimulated: true,
    })),
  );
}

export async function fetchAllPrices(): Promise<DexPrice[]> {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && priceCache.length > 0) {
    return priceCache;
  }

  try {
    const [avaxPrices, arbitrumPrices, optimismPrices] = await Promise.allSettled([
      fetchNetworkPrices("avax"),
      fetchNetworkPrices("arbitrum"),
      fetchNetworkPrices("optimism"),
    ]);

    const networkResults: Record<string, Record<string, { price: number; liquidity: number; pair: string }>> = {
      avax: avaxPrices.status === "fulfilled" ? avaxPrices.value : {},
      arbitrum: arbitrumPrices.status === "fulfilled" ? arbitrumPrices.value : {},
      optimism: optimismPrices.status === "fulfilled" ? optimismPrices.value : {},
    };

    const timestamp = new Date().toISOString();
    const prices: DexPrice[] = [];

    for (const cfg of DEX_CONFIGS) {
      const networkData = networkResults[cfg.geckoNetwork] ?? {};
      const matched = Object.entries(networkData).filter(([id]) =>
        id.toLowerCase().includes(cfg.geckoTerminalDex.toLowerCase().split("-")[0]!),
      );

      if (matched.length > 0) {
        for (const [, data] of matched) {
          prices.push({
            dex: cfg.name,
            network: cfg.network,
            pair: data.pair,
            price: data.price,
            liquidity: data.liquidity,
            updatedAt: timestamp,
            isSimulated: false,
          });
        }
      } else {
        for (const pair of TARGET_PAIRS.slice(0, 2)) {
          prices.push({
            dex: cfg.name,
            network: cfg.network,
            pair,
            price: pair.includes("WBTC") ? 65000 : pair.includes("WETH") ? 2500 : 1.0,
            liquidity: 100_000,
            updatedAt: timestamp,
            isSimulated: true,
          });
        }
      }
    }

    priceCache = prices;
    lastFetch = now;
    logger.info({ count: prices.length, real: prices.filter((p) => !p.isSimulated).length }, "Prices refreshed");
    return prices;
  } catch (err) {
    logger.warn({ err }, "Price fetch failed, using simulated prices");
    priceCache = simulateFallbackPrices();
    lastFetch = now;
    return priceCache;
  }
}

export function getCachedPrices(): DexPrice[] {
  return priceCache;
}
