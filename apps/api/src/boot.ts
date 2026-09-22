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
import { MarketDataService } from "./modules/market/service.js";
import { RiskService } from "./modules/risk/service.js";
import { PaperExecutionAdapter } from "./modules/execution/paper-adapter.js";
import { ZerodhaOrderAdapter } from "./modules/execution/zerodha-order-adapter.js";
import { ExecutionCoordinator } from "./modules/execution/coordinator.js";
import { LiveGate } from "./modules/settings/live-gate.js";
import { AiService } from "./modules/ai/service.js";
import { JournalService } from "./modules/journal/service.js";
import { StrategyEngine } from "./modules/strategy/engine.js";
import { ResearchService } from "./modules/research/service.js";
import { ForecastEngine } from "./modules/forecast/engine.js";
import { AgentLoop } from "./modules/agent/loop.js";
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
      executionMode: env.EXECUTION_MODE,
      agentMode: env.AGENT_MODE,
      liveTradingEnabled: false,
      autonomousTradingEnabled: false,
    });
  }

  const crypto = new CryptoService(env);
  const sessionService = new SessionService(db, crypto, env.APP_ORIGIN.startsWith("https://"));
  const kite = new LiveKiteGateway(env);
  const auth = new ZerodhaAuthService(db, env, crypto, sessionService, kite, log);
  const read = new ZerodhaReadAdapter(auth, kite);
  const market = new MarketDataService(db, env, auth, kite, log);
  const risk = new RiskService(db);
  const paper = new PaperExecutionAdapter(db);
  const gate = new LiveGate(db);
  await gate.ensureRow();
  const live = new ZerodhaOrderAdapter(auth, kite, gate);
  const journal = new JournalService(db);
  const strategy = new StrategyEngine(db);
  const execution = new ExecutionCoordinator(db, risk, paper, live, gate, journal, market);
  const ai = new AiService(db, crypto);
  const research = new ResearchService(db);
  const forecasts = new ForecastEngine(db, market, research, ai, risk);
  const agent = new AgentLoop(db, gate, market, forecasts, execution, log);

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
  };

  const app = createHttpApp(services);

  const quoteLoop = setInterval(() => {
    void market.refreshQuotes().catch((err) => log.warn({ err }, "quote refresh failed"));
    void paper.markToMarket().catch(() => undefined);
  }, 3000);

  const liveLoop = setInterval(() => {
    void forecasts.refreshWatchlist("live").catch((err) => log.warn({ err }, "live forecast refresh failed"));
  }, 20_000);

  const studyLoop = setInterval(() => {
    void agent.tick().catch((err) => log.warn({ err }, "agent tick failed"));
  }, 180_000);
  void agent.tick().catch((err) => log.warn({ err }, "initial agent tick failed"));

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    log.info({ url: `http://${env.API_HOST}:${env.API_PORT}` }, "xTrader API listening");
  });

  void market.connectStream().catch((err) => log.warn({ err }, "ticker start failed"));

  const shutdown = async () => {
    clearInterval(quoteLoop);
    clearInterval(liveLoop);
    clearInterval(studyLoop);
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
