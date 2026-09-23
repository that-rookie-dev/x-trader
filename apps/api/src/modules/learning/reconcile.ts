import type { Logger } from "../../config/logger.js";
import type { MarketDataService } from "../market/service.js";
import { MARKET_CLOSE_MIN, istMinutes } from "../forecast/chain-tape.js";
import type { PredictionLedger } from "./ledger.js";
import type { AutoTuner } from "./tuner.js";
import type { ForecastParamsStore } from "./params-store.js";
import type { TrainingDesk } from "./training-desk.js";

/** After 15:30 IST, stamp open EOD predictions with actual LTP / daily close, then tune per symbol. */
export class PredictionReconciler {
  private tuned = new Set<string>();

  constructor(
    private readonly market: MarketDataService,
    private readonly ledger: PredictionLedger,
    private readonly tuner: AutoTuner,
    private readonly params: ForecastParamsStore,
    private readonly log: Logger,
    private readonly training?: TrainingDesk,
  ) {}

  async tick(watch: Array<{ exchange: string; symbol: string }> = []): Promise<void> {
    const now = new Date();
    if (istMinutes(now) < MARKET_CLOSE_MIN) return;
    const sessionDate = this.ledger.sessionDateIst(now);
    this.training?.setPhase("resolving", `Resolving ${watch.length} symbols for ${sessionDate}`);

    for (const item of watch) {
      try {
        await this.params.ensure(item.exchange, item.symbol);
        await this.resolveOne(item.exchange, item.symbol, sessionDate);
      } catch (err) {
        this.log.warn({ err, symbol: item.symbol }, "prediction resolve failed");
      }
    }

    this.training?.setPhase("tuning", `Auto-tuning ${watch.length} symbols`);
    for (const item of watch) {
      const key = `${sessionDate}:${item.exchange.toUpperCase()}:${item.symbol.toUpperCase()}`;
      if (this.tuned.has(key)) continue;
      try {
        const result = await this.tuner.tuneIfNeeded(item.exchange, item.symbol, sessionDate);
        this.tuned.add(key);
        const row = await this.params.get(item.exchange, item.symbol);
        this.training?.noteTune({
          exchange: item.exchange,
          symbol: item.symbol,
          tuned: result.tuned,
          reason: result.reason,
          mae: row.algo.scoreMae,
        });
        this.log.info({ sessionDate, symbol: item.symbol, ...result }, "forecast auto-tune");
      } catch (err) {
        this.training?.noteTune({
          exchange: item.exchange,
          symbol: item.symbol,
          tuned: false,
          reason: err instanceof Error ? err.message : "tune failed",
        });
        this.log.warn({ err, symbol: item.symbol }, "forecast auto-tune failed");
      }
    }
  }

  async resolveOne(exchange: string, symbol: string, sessionDate: string): Promise<void> {
    const quotes = await this.market.quoteMany([{ exchange, symbol }]);
    const ltp = quotes[0]?.lastPrice != null ? Number(quotes[0].lastPrice) : null;
    let actual = ltp;
    try {
      const daily = await this.market.listCandles(exchange, symbol, 1440, 5);
      const today = daily.find((c) => {
        const d = new Date(c.time * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        return d === sessionDate;
      });
      if (today?.close != null) actual = today.close;
      else if (daily[daily.length - 1]?.close != null && ltp == null) actual = daily[daily.length - 1]!.close;
    } catch {
      /* LTP only */
    }
    if (actual == null || !Number.isFinite(actual)) return;
    await this.ledger.resolveOpenEod({ exchange, symbol, sessionDate, actualClose: actual });
  }
}
