import { logger, createModuleLogger, logPerformance, logTradeEvent } from "../lib/logger.js";
import { fetchAllPrices, getPriceStats } from "./priceMonitor.js";
import {
  detectOpportunities,
  type ArbitrageOpportunity,
} from "./arbitrageDetector.js";
import { executeFlashLoan, type TradeRecord } from "./flashLoanExecutor.js";
import { saveTrade, updateBotStats, getTradeHistory, getBotStats } from "./db.js";

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
  revertedTrades: number;
  totalProfit: number;
  totalGasCost: number;
  opportunitiesScanned: number;
  avgProfitPct: number;
  successRate: number;
}

interface BotState {
  running: boolean;
  config: BotConfig | null;
  stats: BotStats;
  startedAt: string | null;
  error: string | null;
  currentOpportunities: ArbitrageOpportunity[];
  tradeHistory: TradeRecord[];
  lastScanTime: number | null;
  scanCount: number;
  executionCount: number;
}

const log = createModuleLogger("bot-engine");

const state: BotState = {
  running: false,
  config: null,
  stats: {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    revertedTrades: 0,
    totalProfit: 0,
    totalGasCost: 0,
    opportunitiesScanned: 0,
    avgProfitPct: 0,
    successRate: 0,
  },
  startedAt: null,
  error: null,
  currentOpportunities: [],
  tradeHistory: [],
  lastScanTime: null,
  scanCount: 0,
  executionCount: 0,
};

const SCAN_INTERVAL_MS = 8_000;
const MAX_CONCURRENT_EXECUTIONS = 1;
const MAX_TRADE_HISTORY = 100;
const OPPORTUNITY_TTL_MS = 30_000;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let activeExecutions = 0;

function updateStats() {
  const { stats } = state;
  const { successfulTrades, totalTrades } = stats;

  stats.successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;

  if (state.tradeHistory.length > 0) {
    const profits = state.tradeHistory
      .filter((t) => t.status === "success")
      .map((t) => t.profitPct);
    stats.avgProfitPct = profits.length > 0
      ? profits.reduce((a, b) => a + b, 0) / profits.length
      : 0;
  }
}

async function scanAndExecute(): Promise<void> {
  const scanStartTime = Date.now();
  state.scanCount++;

  if (!state.running || !state.config) {
    log.trace("Scan skipped: bot not running");
    return;
  }

  const scanId = `scan-${state.scanCount}`;
  log.debug({ scanId }, "Starting scan cycle");

  try {
    // Fetch prices
    log.trace({ scanId }, "Fetching prices");
    const priceFetchStart = Date.now();

    let prices;
    try {
      prices = await fetchAllPrices();
      logPerformance("bot-engine", "price_fetch", priceFetchStart, {
        scanId,
        priceCount: prices.length,
      });
    } catch (priceError) {
      log.error({ scanId, error: String(priceError) }, "Price fetch failed");
      state.error = `Price fetch failed: ${priceError}`;
      return;
    }

    const priceStats = getPriceStats();
    log.debug({
      scanId,
      totalPrices: priceStats.totalDexs,
      onchain: priceStats.bySource.onchain ?? 0,
      fallback: priceStats.bySource.fallback ?? 0,
    }, "Prices retrieved");

    // Detect opportunities
    log.trace({ scanId }, "Detecting opportunities");
    const detectionStart = Date.now();

    const opportunities = detectOpportunities(
      prices,
      state.config.minProfitPct,
      state.config.networks,
    );

    logPerformance("bot-engine", "opportunity_detection", detectionStart, {
      scanId,
      opportunityCount: opportunities.length,
    });

    state.stats.opportunitiesScanned += opportunities.length;
    state.currentOpportunities = opportunities;
    state.lastScanTime = Date.now();

    if (opportunities.length > 0) {
      log.debug({
        scanId,
        total: opportunities.length,
        pending: opportunities.filter((o) => o.status === "pending").length,
        networks: [...new Set(opportunities.map((o) => o.network))],
      }, "Opportunities detected");

      // Log top opportunities
      const top = opportunities.slice(0, 3);
      top.forEach((opp, idx) => {
        log.info({
          scanId,
          rank: idx + 1,
          id: opp.id,
          profitPct: opp.profitPct,
          buyDex: opp.buyDex,
          sellDex: opp.sellDex,
          network: opp.network,
          hops: opp.hops,
        }, `Opportunity #${idx + 1}`);
      });
    } else {
      log.debug({ scanId }, "No opportunities found");
    }

    // Expire old opportunities
    const now = Date.now();
    state.currentOpportunities = state.currentOpportunities
      .filter((o) => o.status !== "pending" || now - new Date(o.detectedAt).getTime() < OPPORTUNITY_TTL_MS)
      .map((o) => {
        if (o.status === "pending" && now - new Date(o.detectedAt).getTime() >= OPPORTUNITY_TTL_MS) {
          log.debug({ oppId: o.id }, "Opportunity expired");
          return { ...o, status: "expired" as const };
        }
        return o;
      });

    // Select best opportunity for execution
    const pending = opportunities.filter((o) => o.status === "pending");
    if (pending.length === 0) {
      log.trace({ scanId }, "No pending opportunities");
      return;
    }

    const DEPLOYED_NETWORKS = new Set(["arbitrum"]);
    const executable = pending.filter((o) => DEPLOYED_NETWORKS.has(o.network));

    if (executable.length === 0) {
      log.debug({
        scanId,
        pendingCount: pending.length,
        networks: [...new Set(pending.map((o) => o.network))],
        deployed: [...DEPLOYED_NETWORKS],
      }, "No opportunities on deployed networks");
      return;
    }

    const best = executable[0];
    if (!best) {
      log.trace({ scanId }, "No best opportunity selected");
      return;
    }

    if (activeExecutions >= MAX_CONCURRENT_EXECUTIONS) {
      log.debug({
        scanId,
        activeExecutions,
        maxConcurrent: MAX_CONCURRENT_EXECUTIONS,
        bestProfitPct: best.profitPct,
      }, "Max concurrent executions reached");
      return;
    }

    activeExecutions++;
    best.status = "executing";

    state.executionCount++;
    const execId = `exec-${state.executionCount}`;

    log.info({
      scanId,
      execId,
      oppId: best.id,
      profitPct: best.profitPct,
      estimatedProfit: best.estimatedProfit,
      buyDex: best.buyDex,
      sellDex: best.sellDex,
      network: best.network,
      hops: best.hops,
    }, "Executing best opportunity");

    logTradeEvent("opportunity_detected", {
      oppId: best.id,
      profitPct: best.profitPct,
      buyDex: best.buyDex,
      sellDex: best.sellDex,
      network: best.network,
    });

    const executionStart = Date.now();

    const record = await executeFlashLoan(best, {
      gasSource: state.config.gasSource,
      slippageTolerance: state.config.slippageTolerance,
      walletAddress: state.config.walletAddress,
      privateKey: state.config.privateKey,
    });

    logPerformance("bot-engine", "execution", executionStart, {
      execId,
      oppId: best.id,
      status: record.status,
    });

    // Update opportunity status
    best.status = record.status === "success" ? "executed" : "failed";

    // Update stats
    state.stats.totalTrades++;
    if (record.status === "success") {
      state.stats.successfulTrades++;
      state.stats.totalProfit += record.profit;
      state.stats.totalGasCost += record.gasCost;

      log.info({
        scanId,
        execId,
        oppId: best.id,
        txHash: record.txHash,
        profit: record.profit,
        profitPct: record.profitPct,
        gasCost: record.gasCost,
        durationMs: Date.now() - executionStart,
      }, "Trade executed successfully");
    } else {
      if (record.status === "reverted") {
        state.stats.revertedTrades++;
      } else {
        state.stats.failedTrades++;
      }
      state.stats.totalGasCost += record.gasCost;

      log.warn({
        scanId,
        execId,
        oppId: best.id,
        status: record.status,
        error: record.errorMessage,
        gasCost: record.gasCost,
      }, "Trade execution failed");
    }

    updateStats();

    // Add to history
    state.tradeHistory.unshift(record);
    if (state.tradeHistory.length > MAX_TRADE_HISTORY) {
      state.tradeHistory.pop();
    }

    // Persist to database asynchronously (don't await)
    saveTrade(record).catch((err) => {
      log.warn({ trade: record.id, error: String(err) }, "Failed to persist trade");
    });

    updateBotStats({
      ...state.stats,
    }).catch((err) => {
      log.warn({ error: String(err) }, "Failed to persist bot stats");
    });

    state.error = null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ scanId, error: msg }, "Scan/execute cycle failed");
    state.error = msg;
  } finally {
    activeExecutions = Math.max(0, activeExecutions - 1);

    const scanDuration = Date.now() - scanStartTime;
    log.debug({ scanId, durationMs: scanDuration }, "Scan cycle complete");
  }
}

export function startBot(config: BotConfig): void {
  if (state.running) {
    log.info("Bot already running, stopping previous instance");
    stopBot();
  }

  log.info({
    networks: config.networks,
    gasSource: config.gasSource,
    minProfitPct: config.minProfitPct,
    wallet: `${config.walletAddress.slice(0, 6)}...${config.walletAddress.slice(-4)}`,
  }, "Starting bot");

  state.running = true;
  state.config = config;
  state.startedAt = new Date().toISOString();
  state.error = null;
  state.currentOpportunities = [];
  state.scanCount = 0;
  state.executionCount = 0;

  scanAndExecute().catch((err) => {
    log.error({ error: String(err) }, "Initial scan failed");
  });

  scanTimer = setInterval(scanAndExecute, SCAN_INTERVAL_MS);

  log.info({ scanIntervalMs: SCAN_INTERVAL_MS }, "Bot started with periodic scanning");
}

export function stopBot(): void {
  if (!state.running) {
    log.debug("Bot not running");
    return;
  }

  log.info("Stopping bot");

  state.running = false;

  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  state.currentOpportunities = state.currentOpportunities.map((o) =>
    o.status === "pending" ? { ...o, status: "expired" as const } : o,
  );

  log.info({
    totalTrades: state.stats.totalTrades,
    successfulTrades: state.stats.successfulTrades,
    totalProfit: state.stats.totalProfit,
    uptime: state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : 0,
  }, "Bot stopped");
}

export function getBotStatus() {
  const { running, config, stats, startedAt, error, lastScanTime, scanCount, executionCount } = state;

  return {
    running,
    config: config ? {
      ...config,
      privateKey: "[REDACTED]",
    } : null,
    stats,
    startedAt,
    error,
    lastScanTime: lastScanTime ? new Date(lastScanTime).toISOString() : null,
    scanCount,
    executionCount,
    activeExecutions,
    opportunities: state.currentOpportunities.length,
    pendingOpportunities: state.currentOpportunities.filter((o) => o.status === "pending").length,
  };
}

export function getCurrentOpportunities(): ArbitrageOpportunity[] {
  return state.currentOpportunities;
}

export function getTradeHistory(): TradeRecord[] {
  return state.tradeHistory;
}

export async function loadTradeHistoryFromDb(): Promise<TradeRecord[]> {
  const history = await getTradeHistory(50);
  if (history.length > 0) {
    state.tradeHistory = history;
    log.info({ count: history.length }, "Trade history loaded from database");
  }
  return history;
}

export async function loadBotStatsFromDb(): Promise<void> {
  const dbStats = await getBotStats();
  if (dbStats) {
    state.stats = {
      totalTrades: dbStats.total_trades,
      successfulTrades: dbStats.successful_trades,
      failedTrades: dbStats.failed_trades,
      revertedTrades: dbStats.reverted_trades,
      totalProfit: Number(dbStats.total_profit),
      totalGasCost: Number(dbStats.total_gas_cost),
      opportunitiesScanned: dbStats.opportunities_scanned,
      avgProfitPct: Number(dbStats.avg_profit_pct),
      successRate: Number(dbStats.success_rate),
    };
    log.info({
      totalTrades: state.stats.totalTrades,
      totalProfit: state.stats.totalProfit,
    }, "Bot stats loaded from database");
  }
}

export function getRecentTrades(count: number = 20): TradeRecord[] {
  return state.tradeHistory.slice(0, count);
}

export function getTradeStats() {
  const { stats, tradeHistory } = state;

  if (tradeHistory.length === 0) {
    return {
      ...stats,
      lastTradeAt: null,
      bestTrade: null,
      worstTrade: null,
    };
  }

  const successfulTrades = tradeHistory.filter((t) => t.status === "success");
  const failedTrades = tradeHistory.filter((t) => t.status !== "success");

  const bestTrade = successfulTrades.length > 0
    ? successfulTrades.reduce((a, b) => a.profit > b.profit ? a : b)
    : null;

  const worstTrade = failedTrades.length > 0
    ? failedTrades.reduce((a, b) => a.gasCost > b.gasCost ? a : b)
    : null;

  return {
    ...stats,
    lastTradeAt: tradeHistory[0]?.executedAt ?? null,
    bestTrade: bestTrade ? {
      profit: bestTrade.profit,
      profitPct: bestTrade.profitPct,
      buyDex: bestTrade.buyDex,
      sellDex: bestTrade.sellDex,
      txHash: bestTrade.txHash,
    } : null,
    worstTrade: worstTrade ? {
      gasCost: worstTrade.gasCost,
      error: worstTrade.errorMessage,
      txHash: worstTrade.txHash,
    } : null,
  };
}
