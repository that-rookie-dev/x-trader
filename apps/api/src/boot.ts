import { resolve } from "node:path";
import { parseEnv, type Env } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDb } from "./db/client.js";
import { applySchema } from "./db/migrate.js";
import { createHttpApp } from "./http/app.js";
import { PostgresSupervisor } from "./postgres/supervisor.js";
import { CryptoService } from "./security/crypto.js";
import { SessionService } from "./modules/auth/session.js";
import { ZerodhaAuthService } from "./modules/brokers/zerodha/auth-service.js";
import { LiveKiteGateway } from "./modules/brokers/zerodha/live-kite-gateway.js";
import { ZerodhaReadAdapter } from "./modules/brokers/zerodha/read-adapter.js";
import { KiteCredentialsVault } from "./modules/brokers/zerodha/credentials-vault.js";
import { MarketDataService } from "./modules/market/service.js";
import { RiskService } from "./modules/risk/service.js";
import { PaperExecutionAdapter } from "./modules/execution/paper-adapter.js";
import { PaperTrainer } from "./modules/execution/paper-trainer.js";
import { PaperAutopilot } from "./modules/execution/paper-autopilot.js";
import { ZerodhaOrderAdapter } from "./modules/execution/zerodha-order-adapter.js";
import { ExecutionCoordinator } from "./modules/execution/coordinator.js";
import { LiveGate } from "./modules/settings/live-gate.js";
import { AiService } from "./modules/ai/service.js";
import { JournalService } from "./modules/journal/service.js";
import { StrategyEngine } from "./modules/strategy/engine.js";
import { ResearchService } from "./modules/research/service.js";
import { ForecastEngine } from "./modules/forecast/engine.js";
import { AgentLoop } from "./modules/agent/loop.js";
import { SignalStore } from "./modules/forecast/signals.js";
import { PlayStore } from "./modules/forecast/plays.js";
import { ForecastParamsStore } from "./modules/learning/params-store.js";
import { PredictionLedger } from "./modules/learning/ledger.js";
import { AutoTuner } from "./modules/learning/tuner.js";
import { PredictionReconciler } from "./modules/learning/reconcile.js";
import { TrainingDesk } from "./modules/learning/training-desk.js";
import type { AppServices } from "./app/context.js";
import { appSettings } from "./db/schema.js";

export async function boot(env: Env) {
  const log = createLogger(env);
  const dataDir = env.DATA_DIR ?? resolve(process.cwd(), "var");
  const postgres = new PostgresSupervisor(env, log, dataDir);
  const databaseUrl = await postgres.start();
  const { db, client } = createDb(databaseUrl);
  await applySchema(client);

  const [settings] = await db.select().from(appSettings).limit(1);
  if (!settings) {
    await db.insert(appSettings).values({
      id: 1,
      executionMode: "PAPER",
      agentMode: "COPILOT",
      liveTradingEnabled: false,
      autonomousTradingEnabled: false,
    });
  }

  const crypto = new CryptoService(env);
  const sessionService = new SessionService(db, crypto, env.APP_ORIGIN.startsWith("https://"));
  const vault = new KiteCredentialsVault(db, crypto, env);
  await vault.ensureRow();
  const kite = new LiveKiteGateway(vault);
  const auth = new ZerodhaAuthService(db, env, crypto, sessionService, kite, log, vault);
  const read = new ZerodhaReadAdapter(auth, kite);
  const market = new MarketDataService(db, env, auth, kite, log, vault);
  const risk = new RiskService(db);
  const paper = new PaperExecutionAdapter(db);
  await paper.ensureAccount();
  const gate = new LiveGate(db, paper);
  await gate.ensureRow();
  await gate.patch({});
  const live = new ZerodhaOrderAdapter();
  const journal = new JournalService(db);
  const strategy = new StrategyEngine(db);
  const forecastParams = new ForecastParamsStore(db);
  const ledger = new PredictionLedger(db);
  const tuner = new AutoTuner(forecastParams, ledger);
  const training = new TrainingDesk(db, forecastParams);
  const trainer = new PaperTrainer(db, paper, journal, ledger);
  const execution = new ExecutionCoordinator(db, risk, paper, live, gate, journal, market, trainer);
  const ai = new AiService(db, crypto, ledger, forecastParams);
  const research = new ResearchService(db);
  const forecasts = new ForecastEngine(db, market, research, ai, risk, forecastParams, ledger, tuner);
  const signals = new SignalStore(db, market);
  const plays = new PlayStore(db, market, journal);
  const autopilot = new PaperAutopilot(db, paper, trainer, log);
  const reconciler = new PredictionReconciler(market, ledger, tuner, forecastParams, log, training);
  const agent = new AgentLoop(
    db,
    gate,
    market,
    forecasts,
    journal,
    signals,
    plays,
    log,
    read,
    autopilot,
    strategy,
    reconciler,
    ledger,
    forecastParams,
    training,
  );

  const services: AppServices = {
    env,
    log,
    db,
    sql: client,
    crypto,
    sessions: sessionService,
    kite,
    auth,
    read,
    market,
    risk,
    paper,
    live,
    execution,
    gate,
    ai,
    journal,
    strategy,
    research,
    forecasts,
    agent,
    signals,
    plays,
    vault,
    ledger,
    forecastParams,
    tuner,
    reconciler,
    training,
  };

  const app = createHttpApp(services);

  const quoteLoop = setInterval(() => {
    void market.refreshQuotes().catch((err) => log.warn({ err }, "quote refresh failed"));
  }, 3000);

  const liveLoop = setInterval(() => {
    void forecasts.refreshWatchlist("live").catch((err) => log.warn({ err }, "live forecast refresh failed"));
  }, 20_000);

  const studyLoop = setInterval(() => {
    void agent.tick().catch((err) => log.warn({ err }, "agent tick failed"));
  }, 60_000);
  const playLoop = setInterval(() => {
    void plays.tick(read).catch((err) => log.warn({ err }, "play reconcile failed"));
  }, 18_000);
  const learnLoop = setInterval(() => {
    void market.listWatchlist().then((watch) =>
      reconciler.tick(watch.map((w) => ({ exchange: w.exchange, symbol: w.symbol }))),
    ).catch((err) => log.warn({ err }, "prediction reconcile failed"));
  }, 120_000);
  void agent.tick().catch((err) => log.warn({ err }, "initial agent tick failed"));
  void plays.tick(read).catch((err) => log.warn({ err }, "initial play reconcile failed"));
  void market.listWatchlist().then((watch) =>
    reconciler.tick(watch.map((w) => ({ exchange: w.exchange, symbol: w.symbol }))),
  ).catch((err) => log.warn({ err }, "initial prediction reconcile failed"));

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    log.info({ url: `http://${env.API_HOST}:${env.API_PORT}` }, "xTrader API listening");
  });

  void market.connectStream().catch((err) => log.warn({ err }, "ticker start failed"));

  const shutdown = async () => {
    clearInterval(quoteLoop);
    clearInterval(liveLoop);
    clearInterval(studyLoop);
    clearInterval(playLoop);
    clearInterval(learnLoop);
    await market.disconnectStream();
    server.close();
    await client.end({ timeout: 5 });
    await postgres.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  return { services, server, postgres };
}

export async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: resolve(process.cwd(), "../../.env") });
  config();
  const env = parseEnv(process.env);
  await boot(env);
}
