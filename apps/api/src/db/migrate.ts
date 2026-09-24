import type { SqlClient } from "./client.js";

export async function applySchema(client: SqlClient): Promise<void> {
  await client.unsafe(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS broker_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      broker text NOT NULL,
      external_client_id text NOT NULL,
      display_name text,
      email text,
      exchanges jsonb NOT NULL DEFAULT '[]'::jsonb,
      products jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS broker_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      broker_account_id uuid NOT NULL REFERENCES broker_accounts(id),
      status text NOT NULL DEFAULT 'DISCONNECTED',
      ciphertext text NOT NULL,
      nonce text NOT NULL,
      auth_tag text NOT NULL,
      key_version integer NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      last_validated_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS broker_login_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nonce_hash text NOT NULL,
      app_session_hint text,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS system_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      account_id uuid,
      execution_mode text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS instruments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      broker text NOT NULL DEFAULT 'zerodha',
      broker_instrument_token text NOT NULL,
      exchange text NOT NULL,
      symbol text NOT NULL,
      name text NOT NULL,
      instrument_type text NOT NULL,
      tick_size numeric(18,6) NOT NULL,
      lot_size integer NOT NULL DEFAULT 1,
      tradable boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS instruments_broker_token ON instruments(broker, broker_instrument_token);
    CREATE TABLE IF NOT EXISTS watchlists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      name text NOT NULL DEFAULT 'Default',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      watchlist_id uuid NOT NULL REFERENCES watchlists(id),
      instrument_id uuid REFERENCES instruments(id),
      exchange text NOT NULL,
      symbol text NOT NULL,
      orderable boolean NOT NULL DEFAULT true,
      auto_enabled boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS watchlist_symbol ON watchlist_items(watchlist_id, exchange, symbol);
    CREATE TABLE IF NOT EXISTS candles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      instrument_id uuid NOT NULL REFERENCES instruments(id),
      interval_minutes integer NOT NULL,
      bucket_start timestamptz NOT NULL,
      open numeric(18,6) NOT NULL,
      high numeric(18,6) NOT NULL,
      low numeric(18,6) NOT NULL,
      close numeric(18,6) NOT NULL,
      volume numeric(20,4) NOT NULL DEFAULT 0,
      closed boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'LIVE',
      gap boolean NOT NULL DEFAULT false
    );
    CREATE UNIQUE INDEX IF NOT EXISTS candle_key ON candles(instrument_id, interval_minutes, bucket_start);
    CREATE TABLE IF NOT EXISTS app_settings (
      id integer PRIMARY KEY DEFAULT 1,
      execution_mode text NOT NULL DEFAULT 'PAPER',
      agent_mode text NOT NULL DEFAULT 'COPILOT',
      live_trading_enabled boolean NOT NULL DEFAULT false,
      autonomous_trading_enabled boolean NOT NULL DEFAULT false,
      confirmed_egress_ip text,
      confirmed_egress_at timestamptz,
      halt_active boolean NOT NULL DEFAULT false,
      halt_policy text NOT NULL DEFAULT 'MAINTAIN',
      halt_reason text,
      active_ai_profile_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS risk_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version integer NOT NULL DEFAULT 1,
      capital numeric(18,2) NOT NULL,
      max_daily_loss numeric(18,2) NOT NULL,
      max_risk_per_trade numeric(18,2) NOT NULL,
      max_open_positions integer NOT NULL DEFAULT 3,
      max_trades_per_day integer NOT NULL DEFAULT 5,
      minimum_risk_reward numeric(8,2) NOT NULL,
      allow_equity boolean NOT NULL DEFAULT true,
      allow_futures boolean NOT NULL DEFAULT false,
      allow_options boolean NOT NULL DEFAULT false,
      allow_overnight boolean NOT NULL DEFAULT false,
      max_consecutive_losses integer NOT NULL DEFAULT 5,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paper_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      cash numeric(18,2) NOT NULL,
      reserved_cash numeric(18,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS trade_intents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      execution_mode text NOT NULL,
      source text NOT NULL,
      payload jsonb NOT NULL,
      snapshot_id text,
      strategy_version text,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS risk_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intent_id uuid NOT NULL REFERENCES trade_intents(id),
      approved boolean NOT NULL,
      code text NOT NULL,
      reason text NOT NULL,
      quantity integer,
      planned_risk numeric(18,2),
      reward_risk numeric(8,4),
      profile_version integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS risk_reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      execution_mode text NOT NULL,
      intent_id uuid NOT NULL,
      amount numeric(18,2) NOT NULL,
      released_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS trade_approvals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intent_id uuid NOT NULL REFERENCES trade_intents(id),
      risk_decision_id uuid NOT NULL REFERENCES risk_decisions(id),
      quantity integer NOT NULL,
      execution_mode text NOT NULL,
      user_approved boolean,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS execution_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      approval_id uuid NOT NULL REFERENCES trade_approvals(id),
      execution_mode text NOT NULL,
      status text NOT NULL,
      idempotency_key text NOT NULL,
      broker_order_id text,
      message text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_mode text NOT NULL,
      account_id uuid NOT NULL,
      intent_id uuid,
      broker_order_id text,
      exchange text NOT NULL,
      symbol text NOT NULL,
      side text NOT NULL,
      quantity integer NOT NULL,
      filled_quantity integer NOT NULL DEFAULT 0,
      order_type text NOT NULL,
      product text NOT NULL DEFAULT 'MIS',
      limit_price numeric(18,4),
      stop_price numeric(18,4),
      average_price numeric(18,4),
      status text NOT NULL,
      raw_broker_status text,
      fees numeric(18,4) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS executions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id),
      quantity integer NOT NULL,
      price numeric(18,4) NOT NULL,
      fees numeric(18,4) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS positions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_mode text NOT NULL,
      account_id uuid NOT NULL,
      exchange text NOT NULL,
      symbol text NOT NULL,
      direction text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      average_entry numeric(18,4) NOT NULL,
      current_price numeric(18,4),
      stop_loss numeric(18,4),
      targets jsonb NOT NULL DEFAULT '[]'::jsonb,
      unrealised_pnl numeric(18,4),
      realised_pnl numeric(18,4) NOT NULL DEFAULT 0,
      fees numeric(18,4) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'OPEN',
      close_reason text,
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS trade_journal (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intent_id uuid,
      execution_mode text NOT NULL,
      instrument text NOT NULL,
      source text NOT NULL,
      thesis text,
      decision text NOT NULL,
      snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      outcome jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS agent_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid,
      provider text,
      model text,
      prompt_version text NOT NULL DEFAULT 'v1',
      input_snapshot jsonb NOT NULL,
      output jsonb NOT NULL,
      latency_ms integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS daily_performance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      execution_mode text NOT NULL,
      day text NOT NULL,
      realised_pnl numeric(18,4) NOT NULL DEFAULT 0,
      unrealised_pnl numeric(18,4) NOT NULL DEFAULT 0,
      fees numeric(18,4) NOT NULL DEFAULT 0,
      trades integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS daily_perf_key ON daily_performance(account_id, execution_mode, day);
    CREATE TABLE IF NOT EXISTS ai_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      kind text NOT NULL,
      model_id text NOT NULL,
      base_url text,
      ciphertext text,
      nonce text,
      auth_tag text,
      key_version integer,
      is_active boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS setup_memory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      strategy text NOT NULL,
      regime text NOT NULL,
      execution_mode text NOT NULL,
      sample_count integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
      avg_reward_risk numeric(8,4),
      expectancy numeric(18,4),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS quotes_cache (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange text NOT NULL,
      symbol text NOT NULL,
      last_price numeric(18,4) NOT NULL,
      bid numeric(18,4),
      ask numeric(18,4),
      volume numeric(20,4),
      source text NOT NULL DEFAULT 'LIVE',
      received_at timestamptz NOT NULL,
      exchange_timestamp timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS quotes_symbol ON quotes_cache(exchange, symbol);
    CREATE TABLE IF NOT EXISTS research_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      query text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS forecasts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange text NOT NULL,
      symbol text NOT NULL,
      horizon text NOT NULL DEFAULT 'SESSION',
      bias text NOT NULL,
      confidence numeric(6,4) NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS forecast_key ON forecasts(exchange, symbol, horizon);
    CREATE TABLE IF NOT EXISTS algo_marks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      underlying text NOT NULL,
      expiry text NOT NULL,
      contract text NOT NULL,
      kind text NOT NULL,
      strike numeric(18,4) NOT NULL,
      mark text NOT NULL,
      why text NOT NULL DEFAULT '',
      spot numeric(18,4),
      premium numeric(18,4),
      net numeric(18,4),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS algo_mark_key ON algo_marks(expiry, contract);
    CREATE TABLE IF NOT EXISTS algo_signals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      at timestamptz NOT NULL DEFAULT now(),
      underlying text NOT NULL,
      expiry text NOT NULL,
      contract text NOT NULL,
      kind text NOT NULL,
      strike numeric(18,4) NOT NULL,
      from_mark text NOT NULL,
      to_mark text NOT NULL,
      why text NOT NULL DEFAULT '',
      spot numeric(18,4),
      premium numeric(18,4),
      net numeric(18,4)
    );
    CREATE INDEX IF NOT EXISTS algo_signals_und ON algo_signals(underlying, expiry, at DESC);
    CREATE TABLE IF NOT EXISTS plays (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      at timestamptz NOT NULL DEFAULT now(),
      lane text NOT NULL,
      underlying text NOT NULL,
      expiry text NOT NULL DEFAULT '',
      contract text NOT NULL,
      exchange text NOT NULL DEFAULT 'NFO',
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'OPEN',
      hold_until timestamptz NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      dismissed_at timestamptz,
      broker_order_id text,
      fill_qty integer,
      fill_px numeric(18,4),
      closed_pnl numeric(18,4),
      closed_at timestamptz,
      regime text NOT NULL DEFAULT 'UNKNOWN',
      horizon text NOT NULL DEFAULT 'SESSION',
      setup_key text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS plays_open ON plays(status, hold_until);
    CREATE INDEX IF NOT EXISTS plays_und ON plays(underlying, expiry, at DESC);
    CREATE TABLE IF NOT EXISTS vol_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol text NOT NULL,
      session_date text NOT NULL,
      iv_atm numeric(10,6),
      hv20 numeric(10,6),
      hv60 numeric(10,6),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vol_history_day ON vol_history(symbol, session_date);
    CREATE TABLE IF NOT EXISTS prediction_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      exchange text NOT NULL,
      symbol text NOT NULL,
      expiry text,
      session_date text NOT NULL,
      predicted_at timestamptz NOT NULL DEFAULT now(),
      predicted_close numeric(18,4),
      predicted_premium numeric(18,4),
      predicted_direction text,
      entry_price numeric(18,4),
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      actual_at timestamptz,
      actual_close numeric(18,4),
      actual_premium numeric(18,4),
      actual_pnl numeric(18,4),
      error_abs numeric(18,6),
      error_pct numeric(12,6),
      direction_hit boolean,
      source_ref text,
      status text NOT NULL DEFAULT 'OPEN'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prediction_ledger_day_kind
      ON prediction_ledger(kind, exchange, symbol, session_date);
    CREATE INDEX IF NOT EXISTS prediction_ledger_status ON prediction_ledger(status, session_date);
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'forecast_params' AND column_name = 'params'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'forecast_params' AND column_name = 'algo_params'
      ) THEN
        ALTER TABLE forecast_params RENAME TO forecast_params_legacy;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS forecast_params (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange text NOT NULL,
      symbol text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      algo_params jsonb NOT NULL,
      algo_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
      algo_score_mae numeric(12,6),
      algo_score_hit_rate numeric(8,4),
      algo_history jsonb NOT NULL DEFAULT '[]'::jsonb,
      algo_last_tuned_session text,
      ai_params jsonb NOT NULL,
      ai_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ai_score_mae numeric(12,6),
      ai_score_hit_rate numeric(8,4),
      ai_history jsonb NOT NULL DEFAULT '[]'::jsonb,
      ai_last_tuned_session text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS forecast_params_symbol ON forecast_params(exchange, symbol);
    ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS auto_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS kite_api_key_enc jsonb;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS kite_api_secret_enc jsonb;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS kite_configured_at timestamptz;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS paper_autopilot boolean NOT NULL DEFAULT false;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS prediction_mode text NOT NULL DEFAULT 'ALGO';
    ALTER TABLE positions ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
    UPDATE app_settings SET agent_mode = 'COPILOT' WHERE agent_mode IN ('MANUAL', 'COPILOT');
    UPDATE app_settings SET agent_mode = 'AUTO' WHERE agent_mode IN ('AUTONOMOUS', 'AUTO');
    UPDATE app_settings SET prediction_mode = 'ALGO' WHERE prediction_mode IS NULL OR prediction_mode NOT IN ('ALGO', 'AI');
    ALTER TABLE prediction_ledger ADD COLUMN IF NOT EXISTS horizon text NOT NULL DEFAULT 'eod';
    ALTER TABLE prediction_ledger ADD COLUMN IF NOT EXISTS target_at timestamptz;
    DROP INDEX IF EXISTS prediction_ledger_day_kind;
    CREATE UNIQUE INDEX IF NOT EXISTS prediction_ledger_day_kind ON prediction_ledger(kind, exchange, symbol, session_date, horizon);
    CREATE TABLE IF NOT EXISTS news_deltas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange text NOT NULL,
      symbol text NOT NULL,
      score numeric(6,4) NOT NULL DEFAULT 0,
      points numeric(18,4) NOT NULL DEFAULT 0,
      summary text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS news_delta_symbol ON news_deltas(exchange, symbol);
    CREATE TABLE IF NOT EXISTS news_tape (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange text NOT NULL,
      symbol text NOT NULL,
      slot_start timestamptz NOT NULL,
      score numeric(6,4) NOT NULL DEFAULT 0,
      points numeric(18,4) NOT NULL DEFAULT 0,
      summary text NOT NULL DEFAULT '',
      headlines jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS news_tape_slot ON news_tape(exchange, symbol, slot_start);
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_options_exchange text;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_options_symbol text;
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS news_slot_minutes integer NOT NULL DEFAULT 15;
  `);
}
