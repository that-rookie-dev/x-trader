import {
  boolean,
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
  confirmedEgressIp: text("confirmed_egress_ip"),
  confirmedEgressAt: timestamp("confirmed_egress_at", { withTimezone: true }),
  haltActive: boolean("halt_active").notNull().default(false),
  haltPolicy: text("halt_policy").notNull().default("MAINTAIN"),
  haltReason: text("halt_reason"),
  activeAiProfileId: uuid("active_ai_profile_id"),
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
