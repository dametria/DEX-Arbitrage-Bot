/*
  # Create trades and bot_stats tables for persistence

  1. New Tables
    - `trades`
      - `id` (uuid, primary key)
      - `buy_dex` (text)
      - `sell_dex` (text)
      - `network` (text)
      - `buy_price` (numeric)
      - `sell_price` (numeric)
      - `loan_amount` (numeric)
      - `profit` (numeric)
      - `profit_pct` (numeric)
      - `gas_cost` (numeric)
      - `gas_source` (text)
      - `tx_hash` (text, nullable)
      - `status` (text)
      - `error_message` (text, nullable)
      - `created_at` (timestamptz)
    - `bot_stats`
      - `id` (uuid, primary key)
      - `total_trades` (integer)
      - `successful_trades` (integer)
      - `failed_trades` (integer)
      - `reverted_trades` (integer)
      - `total_profit` (numeric)
      - `total_gas_cost` (numeric)
      - `opportunities_scanned` (integer)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policy for service role full access (server-side only)
*/

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_trade_id text UNIQUE NOT NULL,
  buy_dex text NOT NULL,
  sell_dex text NOT NULL,
  network text NOT NULL,
  buy_price numeric NOT NULL,
  sell_price numeric NOT NULL,
  loan_amount numeric NOT NULL,
  profit numeric NOT NULL DEFAULT 0,
  profit_pct numeric NOT NULL DEFAULT 0,
  gas_cost numeric NOT NULL DEFAULT 0,
  gas_source text NOT NULL,
  tx_hash text,
  status text NOT NULL,
  error_message text,
  error_code text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_network ON trades(network);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

CREATE TABLE IF NOT EXISTS bot_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_trades integer DEFAULT 0,
  successful_trades integer DEFAULT 0,
  failed_trades integer DEFAULT 0,
  reverted_trades integer DEFAULT 0,
  total_profit numeric DEFAULT 0,
  total_gas_cost numeric DEFAULT 0,
  opportunities_scanned integer DEFAULT 0,
  avg_profit_pct numeric DEFAULT 0,
  success_rate numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_stats ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for server-side API)
CREATE POLICY "Service role has full access on trades"
  ON trades
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access on bot_stats"
  ON bot_stats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Initialize bot_stats with one row
INSERT INTO bot_stats (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;
