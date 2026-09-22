import { normalizeAgentMode, money, type Forecast, type TradeIntent } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { Logger } from "../../config/logger.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { MarketDataService } from "../market/service.js";
import type { ForecastEngine } from "../forecast/engine.js";
import type { ExecutionCoordinator } from "../execution/coordinator.js";
import type { JournalService } from "../journal/service.js";
import type { SignalStore } from "../forecast/signals.js";
import type { PlayStore } from "../forecast/plays.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import { buildOptionsBoard } from "../forecast/board.js";
import { pickExpiringDesk } from "../forecast/levels.js";

export class AgentLoop {
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly gate: LiveGate,
    private readonly market: MarketDataService,
    private readonly forecasts: ForecastEngine,
    private readonly execution: ExecutionCoordinator,
    private readonly journal: JournalService,
    private readonly signals: SignalStore,
    private readonly plays: PlayStore,
    private readonly log: Logger,
    private readonly read?: ZerodhaReadAdapter,
  ) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.gate.snapshot();
      const mode = normalizeAgentMode(settings.agentMode);
      await this.market.refreshQuotes().catch((err) => this.log.warn({ err }, "quote refresh in agent loop failed"));
      const pack = await this.forecasts.refreshWatchlist();
      await this.scanDesk().catch((err) => this.log.warn({ err }, "desk signal scan failed"));
      await this.plays.tick(this.read).catch((err) => this.log.warn({ err }, "play reconcile failed"));
      if (mode !== "AUTO") return;
      if (settings.haltActive) return;
      if (settings.executionMode === "LIVE" && !settings.liveReady) {
        this.log.warn("AUTO skipped execution: LIVE is not gated ready");
        return;
      }
      const [user] = await this.db.select().from(users).limit(1);
      if (!user) return;
      const watch = await this.market.listWatchlist();
      for (const forecast of pack) {
        const item = watch.find((w) => w.exchange === forecast.instrument.exchange && w.symbol === forecast.instrument.symbol);
        if (!item?.autoEnabled) continue;
        const intent = await this.toIntent(forecast);
        if (!intent) continue;
        try {
          const result = await this.execution.autoExecute({
            accountId: user.id,
            intent,
            source: "auto",
            executionMode: settings.executionMode,
          });
          this.log.info(
            { symbol: intent.instrument.symbol, approved: result.proposed.decision.approved, code: result.proposed.decision.code },
            "AUTO cycle",
          );
        } catch (err) {
          this.log.warn({ err, symbol: forecast.instrument.symbol }, "AUTO execute failed");
        }
      }
    } catch (err) {
      this.log.warn({ err }, "agent loop tick failed");
    } finally {
      this.running = false;
    }
  }

  private async toIntent(forecast: Forecast): Promise<TradeIntent | null> {
    if (!forecast.autoEligible || forecast.bias === "RANGE" || forecast.confidence < 0.62) return null;
    const last = Number(forecast.lastPrice);
    if (!Number.isFinite(last) || last <= 0) return null;
    const stop = Number(forecast.session.expectedLow);
    const target = Number(forecast.path.resistances[0] ?? forecast.session.expectedHigh);
    if (!(stop > 0 && target > 0)) return null;

    if (forecast.bias === "BULLISH") {
      const useFuture = forecast.instrument.instrumentType === "INDEX" && forecast.derivatives?.future;
      const instrument = useFuture
        ? { exchange: "NFO", symbol: forecast.derivatives!.future!, instrumentType: "FUTURE" as const }
        : { exchange: forecast.instrument.exchange, symbol: forecast.instrument.symbol, instrumentType: "EQUITY" as const };
      if (instrument.instrumentType === "EQUITY" && forecast.instrument.instrumentType === "INDEX") return null;
      const px = (await this.market.freshLtp(instrument.exchange, instrument.symbol)) ?? money(last, 2);
      const entry = Number(px);
      const sl = instrument.instrumentType === "FUTURE" ? entry * 0.992 : Math.min(stop, entry * 0.992);
      const tp = instrument.instrumentType === "FUTURE" ? entry * 1.016 : Math.max(target, entry * 1.016);
      return {
        decision: "TRADE",
        instrument,
        direction: "LONG",
        entryType: "LIMIT",
        entryPrice: money(entry, 2),
        stopLoss: money(sl, 2),
        targets: [money(tp, 2)],
        confidenceScore: forecast.confidence,
        timeHorizon: "INTRADAY",
        strategy: "forecast-auto",
        thesis: forecast.copilotAction,
        invalidation: forecast.session.invalidation,
        maxRiskRequested: "300.00",
        metadata: { bias: forecast.bias, horizon: forecast.horizon },
      };
    }

    if (forecast.bias === "BEARISH" && forecast.derivatives?.put) {
      const px = await this.market.freshLtp("NFO", forecast.derivatives.put);
      if (!px) return null;
      const entry = Number(px);
      return {
        decision: "TRADE",
        instrument: { exchange: "NFO", symbol: forecast.derivatives.put, instrumentType: "OPTION" },
        direction: "LONG",
        entryType: "LIMIT",
        entryPrice: money(entry, 2),
        stopLoss: money(entry * 0.7, 2),
        targets: [money(entry * 1.45, 2)],
        confidenceScore: forecast.confidence,
        timeHorizon: "INTRADAY",
        strategy: "forecast-auto-put",
        thesis: forecast.copilotAction,
        invalidation: forecast.session.invalidation,
        maxRiskRequested: "300.00",
        metadata: { bias: forecast.bias, underlying: forecast.instrument.symbol },
      };
    }
    return null;
  }

  private async scanDesk(): Promise<void> {
    if (!this.read) return;
    const names = await this.market.listFnoUnderlyings();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const desk = pickExpiringDesk(names, today);
    if (!desk) return;
    await buildOptionsBoard(
      {
        db: this.db,
        market: this.market,
        forecasts: this.forecasts,
        gate: this.gate,
        read: this.read,
        journal: this.journal,
        signals: this.signals,
        plays: this.plays,
      },
      { exchange: desk.exchange, symbol: desk.symbol, expiry: desk.nextExpiry ?? null },
    );
  }
}
