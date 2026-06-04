import { logger } from "../lib/logger.js";
import { fetchAllPrices } from "./priceMonitor.js";
import {
  detectOpportunities,
  type ArbitrageOpportunity,
} from "./arbitrageDetector.js";
import { executeFlashLoan, type TradeRecord } from "./flashLoanExecutor.js";

export interface BotConfig {
  gasSource: "flashloan" | "contract";
  networks: string[];
  minProfitPct: number;
  slippageTolerance: number;
  walletAddress: string;
  privateKey: string;
}

export interface BotStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  opportunitiesScanned: number;
}

interface BotState {
  running: boolean;
  config: BotConfig | null;
  stats: BotStats;
  startedAt: string | null;
  error: string | null;
  currentOpportunities: ArbitrageOpportunity[];
  tradeHistory: TradeRecord[];
}

const state: BotState = {
  running: false,
  config: null,
  stats: {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0,
    opportunitiesScanned: 0,
  },
  startedAt: null,
  error: null,
  currentOpportunities: [],
  tradeHistory: [],
};

const SCAN_INTERVAL_MS = 8000;
const MAX_CONCURRENT_EXECUTIONS = 1;
const MAX_TRADE_HISTORY = 100;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let activeExecutions = 0;

async function scanAndExecute(): Promise<void> {
  if (!state.running || !state.config) return;

  try {
    const prices = await fetchAllPrices();
    const opportunities = detectOpportunities(
      prices,
      state.config.minProfitPct,
      state.config.networks,
    );
    state.stats.opportunitiesScanned += opportunities.length;
    state.currentOpportunities = opportunities;

    const pending = opportunities.filter((o) => o.status === "pending");
    if (pending.length === 0) return;

    // Only execute on networks where a contract is deployed
    const DEPLOYED_NETWORKS = new Set(["arbitrum"]);
    const executable = pending.filter((o) => DEPLOYED_NETWORKS.has(o.network));
    if (executable.length === 0) {
      logger.debug("Opportunities found but none on a network with a deployed contract");
      return;
    }

    const best = executable[0];
    if (!best) return;

    if (activeExecutions >= MAX_CONCURRENT_EXECUTIONS) {
      logger.debug("Max concurrent executions reached, skipping");
      return;
    }

    activeExecutions++;
    best.status = "executing";

    logger.info(
      {
        opp: best.id,
        profitPct: best.profitPct,
        buyDex: best.buyDex,
        sellDex: best.sellDex,
        network: best.network,
      },
      "Executing best opportunity",
    );

    const record = await executeFlashLoan(best, {
      gasSource: state.config.gasSource,
      slippageTolerance: state.config.slippageTolerance,
      walletAddress: state.config.walletAddress,
      privateKey: state.config.privateKey,
    });

    best.status = record.status === "success" ? "executed" : "failed";
    state.stats.totalTrades++;

    if (record.status === "success") {
      state.stats.successfulTrades++;
      state.stats.totalProfit += record.profit;
    } else {
      state.stats.failedTrades++;
    }

    state.tradeHistory.unshift(record);
    if (state.tradeHistory.length > MAX_TRADE_HISTORY) {
      state.tradeHistory.pop();
    }

    // Expire non-pending opportunities older than 30 seconds
    const cutoff = Date.now() - 30_000;
    state.currentOpportunities = state.currentOpportunities
      .filter((o) => o.status !== "pending" || new Date(o.detectedAt).getTime() > cutoff)
      .map((o) => {
        if (o.status === "pending" && new Date(o.detectedAt).getTime() <= cutoff) {
          return { ...o, status: "expired" as const };
        }
        return o;
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Bot scan/execute cycle failed");
    state.error = msg;
    if (msg.includes("Stuck nonce detected")) {
      logger.warn(
        "ACTION REQUIRED: A stuck transaction is blocking all execution. " +
        "Send a 0-ETH self-transfer to your own address at the stuck nonce " +
        "with a higher maxFeePerGas to clear it (use Arbiscan or MetaMask activity).",
      );
    }
  } finally {
    activeExecutions = Math.max(0, activeExecutions - 1);
  }
}

export function startBot(config: BotConfig): void {
  if (state.running) {
    stopBot();
  }

  state.running = true;
  state.config = config;
  state.startedAt = new Date().toISOString();
  state.error = null;
  state.currentOpportunities = [];

  logger.info(
    { networks: config.networks, gasSource: config.gasSource, minProfitPct: config.minProfitPct },
    "Bot started",
  );

  scanAndExecute();
  scanTimer = setInterval(scanAndExecute, SCAN_INTERVAL_MS);
}

export function stopBot(): void {
  state.running = false;
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  state.currentOpportunities = state.currentOpportunities.map((o) =>
    o.status === "pending" ? { ...o, status: "expired" as const } : o,
  );
  logger.info("Bot stopped");
}

export function getBotStatus() {
  return {
    running: state.running,
    config: state.config,
    stats: state.stats,
    startedAt: state.startedAt,
    error: state.error,
  };
}

export function getCurrentOpportunities(): ArbitrageOpportunity[] {
  return state.currentOpportunities;
}

export function getTradeHistory(): TradeRecord[] {
  return state.tradeHistory;
}
