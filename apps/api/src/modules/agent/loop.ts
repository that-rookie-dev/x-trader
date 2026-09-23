import type { Database } from "../../db/client.js";
import type { Logger } from "../../config/logger.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { MarketDataService } from "../market/service.js";
import type { ForecastEngine } from "../forecast/engine.js";
import type { JournalService } from "../journal/service.js";
import type { SignalStore } from "../forecast/signals.js";
import type { PlayStore } from "../forecast/plays.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import { buildOptionsBoard } from "../forecast/board.js";
import { pickExpiringDesk } from "../forecast/levels.js";

/** Desk loop: refresh, scan signals, reconcile Zerodha fills. Never places orders. */
export class AgentLoop {
  private running = false;

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
  ) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.gate.snapshot();
      if (settings.haltActive) {
        this.log.debug("desk loop paused: halt active");
        return;
      }
      await this.market.refreshQuotes().catch((err) => this.log.warn({ err }, "quote refresh in agent loop failed"));
      await this.forecasts.refreshWatchlist().catch((err) => this.log.warn({ err }, "forecast refresh failed"));
      await this.scanDesk().catch((err) => this.log.warn({ err }, "desk signal scan failed"));
      await this.plays.tick(this.read).catch((err) => this.log.warn({ err }, "play reconcile failed"));
    } catch (err) {
      this.log.warn({ err }, "agent loop tick failed");
    } finally {
      this.running = false;
    }
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
