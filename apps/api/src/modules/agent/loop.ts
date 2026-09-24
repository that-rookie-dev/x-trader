import type { Database } from "../../db/client.js";
import type { Logger } from "../../config/logger.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { MarketDataService } from "../market/service.js";
import type { ForecastEngine } from "../forecast/engine.js";
import type { JournalService } from "../journal/service.js";
import type { SignalStore } from "../forecast/signals.js";
import type { PlayStore } from "../forecast/plays.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import type { StrategyEngine } from "../strategy/engine.js";
import type { PaperAutopilot } from "../execution/paper-autopilot.js";
import type { PredictionReconciler } from "../learning/reconcile.js";
import { buildOptionsBoard } from "../forecast/board.js";
import { buildStocksDesk } from "../forecast/equity.js";
import type { FnoUnderlying } from "../forecast/levels.js";
import type { ForecastParamsStore } from "../learning/params-store.js";
import type { PredictionLedger } from "../learning/ledger.js";

import type { TrainingDesk } from "../learning/training-desk.js";
import type { ResearchService } from "../research/service.js";
import { MARKET_CLOSE_MIN, MARKET_OPEN_MIN, istMinutes } from "../forecast/chain-tape.js";

const SCAN_BATCH = 4;

/** Desk loop: refresh, scan F&O boards, paper Autopilot, reconcile Zerodha fills. Never places live orders. */
export class AgentLoop {
  private running = false;
  private cursor = 0;
  private stocksTick = 0;
  private scanCycle = 0;
  private scanDone = 0;
  private scanTotal = 0;

  constructor(
    private readonly db: Database,
    private readonly gate: LiveGate,
    private readonly market: MarketDataService,
    private readonly forecasts: ForecastEngine,
    private readonly journal: JournalService,
    private readonly signals: SignalStore,
    private readonly plays: PlayStore,
    private readonly log: Logger,
    private readonly read?: ZerodhaReadAdapter,
    private readonly autopilot?: PaperAutopilot,
    private readonly strategy?: StrategyEngine,
    private readonly reconciler?: PredictionReconciler,
    private readonly ledger?: PredictionLedger,
    private readonly forecastParams?: ForecastParamsStore,
    private readonly training?: TrainingDesk,
    private readonly research?: ResearchService,
  ) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.gate.snapshot();
      if (settings.haltActive) {
        this.training?.setPhase("halted", "Desk halt active");
        return;
      }
      const mins = istMinutes(new Date());
      const marketOpen = mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN;

      await this.market.refreshQuotes().catch((err) => this.log.warn({ err }, "quote refresh in agent loop failed"));
      await this.forecasts.refreshWatchlist("live").catch((err) => this.log.warn({ err }, "forecast refresh failed"));

      if (marketOpen) {
        this.training?.setPhase("scanning", "Refreshing quotes + whitelist boards");
        await this.scanDesks().catch((err) => this.log.warn({ err }, "desk signal scan failed"));
        this.stocksTick += 1;
        if (this.stocksTick % 3 === 0) {
          await this.scanStocks().catch((err) => this.log.warn({ err }, "stocks autopilot scan failed"));
        }
      }

      await this.plays.tick(this.read).catch((err) => this.log.warn({ err }, "play reconcile failed"));
      if (this.reconciler) {
        const watch = await this.market.listWatchlist();
        await this.reconciler
          .tick(watch.map((w) => ({ exchange: w.exchange, symbol: w.symbol })))
          .catch((err) => this.log.warn({ err }, "prediction reconcile failed"));
      }
      const prog = this.training?.snapshotLive().progress;
      if (prog && prog.kind !== "idle" && prog.pct < 100) {
        /* keep current cycle message */
      } else if (!marketOpen && (prog?.pct ?? 100) >= 100) {
        this.training?.setPhase("idle", prog?.label ?? "Session complete — waiting for next open");
      } else {
        this.training?.setPhase("idle", prog?.label ?? "Waiting for next cycle");
      }
    } catch (err) {
      this.log.warn({ err }, "agent loop tick failed");
      this.training?.setPhase("idle", err instanceof Error ? err.message : "tick failed");
    } finally {
      this.running = false;
    }
  }

  /** Sequential pass over Settings whitelist only (no fallback to all F&O names). */
  private async scanDesks(): Promise<void> {
    if (!this.read) return;
    const names = await this.market.listFnoUnderlyings();
    const watch = await this.market.listWatchlist();
    const byKey = new Map(names.map((n) => [`${n.exchange.toUpperCase()}:${n.symbol.toUpperCase()}`, n]));
    const pool = watch
      .map((w) => byKey.get(`${w.exchange.toUpperCase()}:${w.symbol.toUpperCase()}`))
      .filter((n): n is FnoUnderlying => Boolean(n && n.nextExpiry));

    if (!pool.length) {
      this.training?.setTracked(0, 0);
      this.training?.beginCycle("scan", 0, this.scanCycle, "No whitelist symbols");
      this.training?.completeCycle("Add F&O symbols in Settings to start scanning");
      return;
    }

    if (this.scanTotal !== pool.length || this.scanDone >= this.scanTotal) {
      this.scanCycle += 1;
      this.scanDone = 0;
      this.scanTotal = pool.length;
      this.cursor = 0;
      this.training?.beginCycle("scan", pool.length, this.scanCycle);
    }

    const remaining = Math.max(0, pool.length - this.scanDone);
    const batch = Math.min(SCAN_BATCH, remaining);
    this.training?.setTracked(pool.length, this.scanDone);
    const focus = this.autopilot ? await this.autopilot.readFocus() : null;
    const deps = {
      db: this.db,
      market: this.market,
      forecasts: this.forecasts,
      gate: this.gate,
      read: this.read,
      journal: this.journal,
      signals: this.signals,
      plays: this.plays,
      ledger: this.ledger,
      forecastParams: this.forecastParams,
      research: this.research,
    };
    for (let i = 0; i < batch; i += 1) {
      const desk = pool[this.scanDone];
      if (!desk?.exchange || !desk.symbol) {
        this.scanDone += 1;
        this.training?.setProgress(this.scanDone, this.scanTotal);
        continue;
      }
      try {
        const board = await buildOptionsBoard(deps, {
          exchange: desk.exchange,
          symbol: desk.symbol,
          expiry: desk.nextExpiry ?? null,
        });
        this.training?.noteScan({
          exchange: desk.exchange,
          symbol: desk.symbol,
          ok: true,
          detail: `EOD ${board.eod?.close ?? "—"} · mode ${board.predictionMode ?? "ALGO"}`,
        });
        if (this.autopilot && focus && desk.exchange.toUpperCase() === focus.exchange.toUpperCase() && desk.symbol.toUpperCase() === focus.symbol.toUpperCase()) {
          await this.autopilot.onOptionsBoard(board, true).catch((err) =>
            this.log.debug({ err, symbol: desk.symbol }, "paper autopilot options failed"),
          );
        }
      } catch (err) {
        this.training?.noteScan({
          exchange: desk.exchange,
          symbol: desk.symbol,
          ok: false,
          detail: err instanceof Error ? err.message : "scan failed",
        });
        this.log.warn({ err, symbol: desk.symbol }, "desk board scan failed");
      }
      this.scanDone += 1;
      this.training?.setProgress(this.scanDone, this.scanTotal);
    }
    this.cursor = this.scanDone % pool.length;
    this.training?.setTracked(pool.length, this.cursor);
    if (this.scanDone >= this.scanTotal) {
      this.training?.completeCycle(`Scan cycle #${this.scanCycle} complete — next pass starts on the next tick`);
    }
  }

  private async scanStocks(): Promise<void> {
    if (!this.read || !this.strategy || !this.autopilot) return;
    try {
      const desk = await buildStocksDesk({
        db: this.db,
        market: this.market,
        forecasts: this.forecasts,
        strategy: this.strategy,
        gate: this.gate,
        journal: this.journal,
        read: this.read,
        plays: this.plays,
        research: this.research,
      });
      await this.autopilot.onStocksDesk(desk);
    } catch (err) {
      this.log.debug({ err }, "stocks desk for autopilot failed");
    }
  }
}

export function deskScanPool(names: FnoUnderlying[]): FnoUnderlying[] {
  const indexes = names.filter((n) => n.kind === "INDEX" && n.nextExpiry);
  if (indexes.length) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return [...indexes].sort((a, b) => {
      const ae = a.nextExpiry === today ? 0 : 1;
      const be = b.nextExpiry === today ? 0 : 1;
      if (ae !== be) return ae - be;
      return (a.nextExpiry ?? "").localeCompare(b.nextExpiry ?? "");
    });
  }
  return names.filter((n) => n.nextExpiry);
}
