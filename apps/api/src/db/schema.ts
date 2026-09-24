import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSessions = pgTable("app_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const brokerAccounts = pgTable("broker_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  broker: text("broker").notNull(),
  externalClientId: text("external_client_id").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  exchanges: jsonb("exchanges").$type<string[]>().notNull().default([]),
  products: jsonb("products").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brokerSessions = pgTable("broker_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerAccountId: uuid("broker_account_id")
    .notNull()
    .references(() => brokerAccounts.id),
  status: text("status").notNull().default("DISCONNECTED"),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brokerLoginAttempts = pgTable("broker_login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  nonceHash: text("nonce_hash").notNull(),
  appSessionHint: text("app_session_hint"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemEvents = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  accountId: uuid("account_id"),
  executionMode: text("execution_mode"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broker: text("broker").notNull().default("zerodha"),
    brokerInstrumentToken: text("broker_instrument_token").notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    instrumentType: text("instrument_type").notNull(),
    tickSize: numeric("tick_size", { precision: 18, scale: 6 }).notNull(),
    lotSize: integer("lot_size").notNull().default(1),
    tradable: boolean("tradable").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("instruments_broker_token").on(t.broker, t.brokerInstrumentToken)],
);

export const watchlists = pgTable("watchlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull().default("Default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id),
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    orderable: boolean("orderable").notNull().default(true),
    autoEnabled: boolean("auto_enabled").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("watchlist_symbol").on(t.watchlistId, t.exchange, t.symbol)],
);

export const candles = pgTable(
  "candles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    intervalMinutes: integer("interval_minutes").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }).notNull(),
    high: numeric("high", { precision: 18, scale: 6 }).notNull(),
    low: numeric("low", { precision: 18, scale: 6 }).notNull(),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    volume: numeric("volume", { precision: 20, scale: 4 }).notNull().default("0"),
    closed: boolean("closed").notNull().default(false),
    source: text("source").notNull().default("LIVE"),
    gap: boolean("gap").notNull().default(false),
  },
  (t) => [uniqueIndex("candle_key").on(t.instrumentId, t.intervalMinutes, t.bucketStart)],
);

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  executionMode: text("execution_mode").notNull().default("PAPER"),
  agentMode: text("agent_mode").notNull().default("COPILOT"),
  liveTradingEnabled: boolean("live_trading_enabled").notNull().default(false),
  autonomousTradingEnabled: boolean("autonomous_trading_enabled").notNull().default(false),
  paperAutopilot: boolean("paper_autopilot").notNull().default(false),
  activeOptionsExchange: text("active_options_exchange"),
  activeOptionsSymbol: text("active_options_symbol"),
  newsSlotMinutes: integer("news_slot_minutes").notNull().default(15),
  predictionMode: text("prediction_mode").notNull().default("ALGO"),
  confirmedEgressIp: text("confirmed_egress_ip"),
  confirmedEgressAt: timestamp("confirmed_egress_at", { withTimezone: true }),
  haltActive: boolean("halt_active").notNull().default(false),
  haltPolicy: text("halt_policy").notNull().default("MAINTAIN"),
  haltReason: text("halt_reason"),
  activeAiProfileId: uuid("active_ai_profile_id"),
  kiteApiKeyEnc: jsonb("kite_api_key_enc").$type<Record<string, unknown>>(),
  kiteApiSecretEnc: jsonb("kite_api_secret_enc").$type<Record<string, unknown>>(),
  kiteConfiguredAt: timestamp("kite_configured_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskProfiles = pgTable("risk_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().default(1),
  capital: numeric("capital", { precision: 18, scale: 2 }).notNull(),
  maxDailyLoss: numeric("max_daily_loss", { precision: 18, scale: 2 }).notNull(),
  maxRiskPerTrade: numeric("max_risk_per_trade", { precision: 18, scale: 2 }).notNull(),
  maxOpenPositions: integer("max_open_positions").notNull().default(3),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(5),
  minimumRiskReward: numeric("minimum_risk_reward", { precision: 8, scale: 2 }).notNull(),
  allowEquity: boolean("allow_equity").notNull().default(true),
  allowFutures: boolean("allow_futures").notNull().default(false),
  allowOptions: boolean("allow_options").notNull().default(false),
  allowOvernight: boolean("allow_overnight").notNull().default(false),
  maxConsecutiveLosses: integer("max_consecutive_losses").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paperAccounts = pgTable("paper_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  cash: numeric("cash", { precision: 18, scale: 2 }).notNull(),
  reservedCash: numeric("reserved_cash", { precision: 18, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tradeIntents = pgTable("trade_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  executionMode: text("execution_mode").notNull(),
  source: text("source").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  snapshotId: text("snapshot_id"),
  strategyVersion: text("strategy_version"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskDecisions = pgTable("risk_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id")
    .notNull()
    .references(() => tradeIntents.id),
  approved: boolean("approved").notNull(),
  code: text("code").notNull(),
  reason: text("reason").notNull(),
  quantity: integer("quantity"),
  plannedRisk: numeric("planned_risk", { precision: 18, scale: 2 }),
  rewardRisk: numeric("reward_risk", { precision: 8, scale: 4 }),
  profileVersion: integer("profile_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskReservations = pgTable("risk_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  executionMode: text("execution_mode").notNull(),
  intentId: uuid("intent_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tradeApprovals = pgTable("trade_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id")
    .notNull()
    .references(() => tradeIntents.id),
  riskDecisionId: uuid("risk_decision_id")
    .notNull()
    .references(() => riskDecisions.id),
  quantity: integer("quantity").notNull(),
  executionMode: text("execution_mode").notNull(),
  userApproved: boolean("user_approved"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const executionAttempts = pgTable("execution_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  approvalId: uuid("approval_id")
    .notNull()
    .references(() => tradeApprovals.id),
  executionMode: text("execution_mode").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  brokerOrderId: text("broker_order_id"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionMode: text("execution_mode").notNull(),
  accountId: uuid("account_id").notNull(),
  intentId: uuid("intent_id"),
  brokerOrderId: text("broker_order_id"),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: integer("quantity").notNull(),
  filledQuantity: integer("filled_quantity").notNull().default(0),
  orderType: text("order_type").notNull(),
  product: text("product").notNull().default("MIS"),
  limitPrice: numeric("limit_price", { precision: 18, scale: 4 }),
  stopPrice: numeric("stop_price", { precision: 18, scale: 4 }),
  averagePrice: numeric("average_price", { precision: 18, scale: 4 }),
  status: text("status").notNull(),
  rawBrokerStatus: text("raw_broker_status"),
  fees: numeric("fees", { precision: 18, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const executions = pgTable("executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 18, scale: 4 }).notNull(),
  fees: numeric("fees", { precision: 18, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionMode: text("execution_mode").notNull(),
  accountId: uuid("account_id").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  averageEntry: numeric("average_entry", { precision: 18, scale: 4 }).notNull(),
  currentPrice: numeric("current_price", { precision: 18, scale: 4 }),
  stopLoss: numeric("stop_loss", { precision: 18, scale: 4 }),
  targets: jsonb("targets").$type<string[]>().notNull().default([]),
  unrealisedPnl: numeric("unrealised_pnl", { precision: 18, scale: 4 }),
  realisedPnl: numeric("realised_pnl", { precision: 18, scale: 4 }).notNull().default("0"),
  fees: numeric("fees", { precision: 18, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("OPEN"),
  closeReason: text("close_reason"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const tradeJournal = pgTable("trade_journal", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id"),
  executionMode: text("execution_mode").notNull(),
  instrument: text("instrument").notNull(),
  source: text("source").notNull(),
  thesis: text("thesis"),
  decision: text("decision").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  outcome: jsonb("outcome").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentDecisions = pgTable("agent_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id"),
  provider: text("provider"),
  model: text("model"),
  promptVersion: text("prompt_version").notNull().default("v1"),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull(),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyPerformance = pgTable(
  "daily_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    executionMode: text("execution_mode").notNull(),
    day: text("day").notNull(),
    realisedPnl: numeric("realised_pnl", { precision: 18, scale: 4 }).notNull().default("0"),
    unrealisedPnl: numeric("unrealised_pnl", { precision: 18, scale: 4 }).notNull().default("0"),
    fees: numeric("fees", { precision: 18, scale: 4 }).notNull().default("0"),
    trades: integer("trades").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
  },
  (t) => [uniqueIndex("daily_perf_key").on(t.accountId, t.executionMode, t.day)],
);

export const aiProfiles = pgTable("ai_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  modelId: text("model_id").notNull(),
  baseUrl: text("base_url"),
  ciphertext: text("ciphertext"),
  nonce: text("nonce"),
  authTag: text("auth_tag"),
  keyVersion: integer("key_version"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const setupMemory = pgTable("setup_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategy: text("strategy").notNull(),
  regime: text("regime").notNull(),
  executionMode: text("execution_mode").notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  avgRewardRisk: numeric("avg_reward_risk", { precision: 8, scale: 4 }),
  expectancy: numeric("expectancy", { precision: 18, scale: 4 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotesCache = pgTable(
  "quotes_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    lastPrice: numeric("last_price", { precision: 18, scale: 4 }).notNull(),
    bid: numeric("bid", { precision: 18, scale: 4 }),
    ask: numeric("ask", { precision: 18, scale: 4 }),
    volume: numeric("volume", { precision: 20, scale: 4 }),
    source: text("source").notNull().default("LIVE"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    exchangeTimestamp: timestamp("exchange_timestamp", { withTimezone: true }),
  },
  (t) => [uniqueIndex("quotes_symbol").on(t.exchange, t.symbol)],
);

export const newsDeltas = pgTable(
  "news_deltas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    score: numeric("score", { precision: 6, scale: 4 }).notNull().default("0"),
    points: numeric("points", { precision: 18, scale: 4 }).notNull().default("0"),
    summary: text("summary").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_delta_symbol").on(t.exchange, t.symbol)],
);

export const newsTape = pgTable(
  "news_tape",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    score: numeric("score", { precision: 6, scale: 4 }).notNull().default("0"),
    points: numeric("points", { precision: 18, scale: 4 }).notNull().default("0"),
    summary: text("summary").notNull().default(""),
    headlines: jsonb("headlines").$type<Array<{ title: string; url: string; snippet: string }>>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_tape_slot").on(t.exchange, t.symbol, t.slotStart)],
);

export const researchSnapshots = pgTable("research_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  query: text("query").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const forecasts = pgTable(
  "forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    horizon: text("horizon").notNull().default("SESSION"),
    bias: text("bias").notNull(),
    confidence: numeric("confidence", { precision: 6, scale: 4 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("forecast_key").on(t.exchange, t.symbol, t.horizon)],
);

export const algoMarks = pgTable(
  "algo_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    underlying: text("underlying").notNull(),
    expiry: text("expiry").notNull(),
    contract: text("contract").notNull(),
    kind: text("kind").notNull(),
    strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),
    mark: text("mark").notNull(),
    why: text("why").notNull().default(""),
    spot: numeric("spot", { precision: 18, scale: 4 }),
    premium: numeric("premium", { precision: 18, scale: 4 }),
    net: numeric("net", { precision: 18, scale: 4 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("algo_mark_key").on(t.expiry, t.contract)],
);

export const algoSignals = pgTable("algo_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  underlying: text("underlying").notNull(),
  expiry: text("expiry").notNull(),
  contract: text("contract").notNull(),
  kind: text("kind").notNull(),
  strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),
  fromMark: text("from_mark").notNull(),
  toMark: text("to_mark").notNull(),
  why: text("why").notNull().default(""),
  spot: numeric("spot", { precision: 18, scale: 4 }),
  premium: numeric("premium", { precision: 18, scale: 4 }),
  net: numeric("net", { precision: 18, scale: 4 }),
});

export const plays = pgTable("plays", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  lane: text("lane").notNull(),
  underlying: text("underlying").notNull(),
  expiry: text("expiry").notNull().default(""),
  contract: text("contract").notNull(),
  exchange: text("exchange").notNull().default("NFO"),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("OPEN"),
  holdUntil: timestamp("hold_until", { withTimezone: true }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  brokerOrderId: text("broker_order_id"),
  fillQty: integer("fill_qty"),
  fillPx: numeric("fill_px", { precision: 18, scale: 4 }),
  closedPnl: numeric("closed_pnl", { precision: 18, scale: 4 }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  regime: text("regime").notNull().default("UNKNOWN"),
  horizon: text("horizon").notNull().default("SESSION"),
  setupKey: text("setup_key").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const volHistory = pgTable(
  "vol_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    sessionDate: text("session_date").notNull(),
    ivAtm: numeric("iv_atm", { precision: 10, scale: 6 }),
    hv20: numeric("hv20", { precision: 10, scale: 6 }),
    hv60: numeric("hv60", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vol_history_day").on(t.symbol, t.sessionDate)],
);

export const predictionLedger = pgTable(
  "prediction_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    expiry: text("expiry"),
    sessionDate: text("session_date").notNull(),
    horizon: text("horizon").notNull().default("eod"),
    targetAt: timestamp("target_at", { withTimezone: true }),
    predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull().defaultNow(),
    predictedClose: numeric("predicted_close", { precision: 18, scale: 4 }),
    predictedPremium: numeric("predicted_premium", { precision: 18, scale: 4 }),
    predictedDirection: text("predicted_direction"),
    entryPrice: numeric("entry_price", { precision: 18, scale: 4 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actualAt: timestamp("actual_at", { withTimezone: true }),
    actualClose: numeric("actual_close", { precision: 18, scale: 4 }),
    actualPremium: numeric("actual_premium", { precision: 18, scale: 4 }),
    actualPnl: numeric("actual_pnl", { precision: 18, scale: 4 }),
    errorAbs: numeric("error_abs", { precision: 18, scale: 6 }),
    errorPct: numeric("error_pct", { precision: 12, scale: 6 }),
    directionHit: boolean("direction_hit"),
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("OPEN"),
  },
  (t) => [
    uniqueIndex("prediction_ledger_day_kind").on(t.kind, t.exchange, t.symbol, t.sessionDate, t.horizon),
    index("prediction_ledger_status").on(t.status, t.sessionDate),
  ],
);

export const horizonTape = pgTable(
  "horizon_tape",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    sessionDate: text("session_date").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    spot: numeric("spot", { precision: 18, scale: 4 }).notNull(),
    algo: jsonb("algo").$type<Record<string, number>>().notNull(),
    ai: jsonb("ai").$type<Record<string, number>>().notNull(),
  },
  (t) => [index("horizon_tape_symbol_time").on(t.exchange, t.symbol, t.sampledAt)],
);

export const forecastParams = pgTable(
  "forecast_params",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    version: integer("version").notNull().default(1),
    algoParams: jsonb("algo_params").$type<Record<string, number>>().notNull(),
    algoDelta: jsonb("algo_delta").$type<Record<string, number>>().notNull().default({}),
    algoScoreMae: numeric("algo_score_mae", { precision: 12, scale: 6 }),
    algoScoreHitRate: numeric("algo_score_hit_rate", { precision: 8, scale: 4 }),
    algoHistory: jsonb("algo_history").$type<Array<Record<string, unknown>>>().notNull().default([]),
    algoLastTunedSession: text("algo_last_tuned_session"),
    aiParams: jsonb("ai_params").$type<Record<string, number>>().notNull(),
    aiDelta: jsonb("ai_delta").$type<Record<string, number>>().notNull().default({}),
    aiScoreMae: numeric("ai_score_mae", { precision: 12, scale: 6 }),
    aiScoreHitRate: numeric("ai_score_hit_rate", { precision: 8, scale: 4 }),
    aiHistory: jsonb("ai_history").$type<Array<Record<string, unknown>>>().notNull().default([]),
    aiLastTunedSession: text("ai_last_tuned_session"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("forecast_params_symbol").on(t.exchange, t.symbol)],
);
