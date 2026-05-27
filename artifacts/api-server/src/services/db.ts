import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger, createModuleLogger } from "../lib/logger.js";
import type { TradeRecord } from "./flashLoanExecutor.js";

const log = createModuleLogger("database");

interface DbTrade {
  id: string;
  bot_trade_id: string;
  buy_dex: string;
  sell_dex: string;
  network: string;
  buy_price: number;
  sell_price: number;
  loan_amount: number;
  profit: number;
  profit_pct: number;
  gas_cost: number;
  gas_source: string;
  tx_hash: string | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
}

interface DbBotStats {
  id: string;
  total_trades: number;
  successful_trades: number;
  failed_trades: number;
  reverted_trades: number;
  total_profit: number;
  total_gas_cost: number;
  opportunities_scanned: number;
  avg_profit_pct: number;
  success_rate: number;
  updated_at: string;
}

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error("Supabase URL and key not configured");
    }

    supabase = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });

    log.info("Supabase client initialized");
  }

  return supabase;
}

export async function saveTrade(trade: TradeRecord): Promise<void> {
  const client = getClient();

  try {
    const dbTrade: Omit<DbTrade, "id" | "created_at"> = {
      bot_trade_id: trade.id,
      buy_dex: trade.buyDex,
      sell_dex: trade.sellDex,
      network: trade.network,
      buy_price: trade.buyPrice,
      sell_price: trade.sellPrice,
      loan_amount: trade.loanAmount,
      profit: trade.profit,
      profit_pct: trade.profitPct,
      gas_cost: trade.gasCost,
      gas_source: trade.gasSource,
      tx_hash: trade.txHash ?? null,
      status: trade.status,
      error_message: trade.errorMessage ?? null,
      error_code: trade.errorDetails?.code ?? null,
    };

    const { error } = await client
      .from("trades")
      .insert(dbTrade);

    if (error) {
      log.error({ error: error.message, trade: trade.id }, "Failed to save trade");
      throw error;
    }

    log.debug({
      tradeId: trade.id,
      status: trade.status,
      profit: trade.profit,
      txHash: trade.txHash,
    }, "Trade saved to database");
  } catch (err) {
    log.error({ error: String(err), trade: trade.id }, "Exception saving trade");
    // Don't throw - we don't want to break execution if DB is down
  }
}

export async function updateBotStats(stats: {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  revertedTrades: number;
  totalProfit: number;
  totalGasCost: number;
  opportunitiesScanned: number;
  avgProfitPct: number;
  successRate: number;
}): Promise<void> {
  const client = getClient();

  try {
    const { error } = await client
      .from("bot_stats")
      .update({
        total_trades: stats.totalTrades,
        successful_trades: stats.successfulTrades,
        failed_trades: stats.failedTrades,
        reverted_trades: stats.revertedTrades,
        total_profit: stats.totalProfit,
        total_gas_cost: stats.totalGasCost,
        opportunities_scanned: stats.opportunitiesScanned,
        avg_profit_pct: stats.avgProfitPct,
        success_rate: stats.successRate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    if (error) {
      // If update fails (row doesn't exist), try insert
      if (error.code === "PGRST116") {
        await client.from("bot_stats").insert({
          id: "00000000-0000-0000-0000-000000000001",
          ...stats,
        });
      } else {
        log.error({ error: error.message }, "Failed to update bot stats");
      }
      return;
    }

    log.debug({ stats }, "Bot stats updated");
  } catch (err) {
    log.error({ error: String(err) }, "Exception updating bot stats");
  }
}

export async function getTradeHistory(limit: number = 100): Promise<TradeRecord[]> {
  const client = getClient();

  try {
    const { data, error } = await client
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      log.error({ error: error.message }, "Failed to fetch trade history");
      return [];
    }

    return (data as DbTrade[]).map(mapDbTradeToRecord);
  } catch (err) {
    log.error({ error: String(err) }, "Exception fetching trade history");
    return [];
  }
}

export async function getBotStats(): Promise<DbBotStats | null> {
  const client = getClient();

  try {
    const { data, error } = await client
      .from("bot_stats")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error) {
      log.error({ error: error.message }, "Failed to fetch bot stats");
      return null;
    }

    return data as DbBotStats | null;
  } catch (err) {
    log.error({ error: String(err) }, "Exception fetching bot stats");
    return null;
  }
}

function mapDbTradeToRecord(db: DbTrade): TradeRecord {
  return {
    id: db.bot_trade_id,
    buyDex: db.buy_dex,
    sellDex: db.sell_dex,
    network: db.network,
    buyPrice: Number(db.buy_price),
    sellPrice: Number(db.sell_price),
    loanAmount: Number(db.loan_amount),
    profit: Number(db.profit),
    profitPct: Number(db.profit_pct),
    gasCost: Number(db.gas_cost),
    gasSource: db.gas_source,
    txHash: db.tx_hash ?? undefined,
    status: db.status as "success" | "reverted" | "failed",
    executedAt: db.created_at,
    errorMessage: db.error_message ?? undefined,
    errorDetails: db.error_code ? { code: db.error_code } : undefined,
  };
}
