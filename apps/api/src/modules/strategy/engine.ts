import { desc, eq } from "drizzle-orm";
import type { StrategyDecision, TradeIntent } from "@xtrader/domain";
import { money } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { candles, instruments } from "../../db/schema.js";
import { atr, classifyRegime, ema, rsi, sessionVwap, sma } from "../indicators/index.js";

export class StrategyEngine {
  constructor(private readonly db: Database) {}

  async evaluate(exchange: string, symbol: string): Promise<StrategyDecision & { market?: Record<string, unknown> }> {
    const [inst] = await this.db
      .select()
      .from(instruments)
      .where(eq(instruments.symbol, symbol))
      .limit(1);
    const rows = inst
      ? await this.db
          .select()
          .from(candles)
          .where(eq(candles.instrumentId, inst.id))
          .orderBy(desc(candles.bucketStart))
          .limit(80)
      : [];
    const series = rows
      .filter((c) => c.intervalMinutes === 5)
      .reverse()
      .map((c) => ({
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }));
    const closes = series.map((c) => c.close);
    const vols = series.map((c) => c.volume);
    const emaFast = ema(closes, 9);
    const emaSlow = ema(closes, 21);
    const rsiVal = rsi(closes, 14);
    const atrVal = atr(series, 14);
    const vwap = sessionVwap(series);
    const volAvg = sma(vols, 20);
    const regime = classifyRegime(closes, atrVal);
    const last = series[series.length - 1];
    const market = {
      emaFast,
      emaSlow,
      rsi: rsiVal,
      atr: atrVal,
      vwap,
      volumeAverage: volAvg,
      regime,
      last: last?.close ?? null,
    };

    if (!last || emaFast == null || emaSlow == null || atrVal == null) {
      return {
        decision: "NO_TRADE",
        reasonCode: "INSUFFICIENT_HISTORY",
        explanation: "Not enough closed candles to evaluate the setup.",
        market,
      };
    }
    if (symbol === "NIFTY 50") {
      return {
        decision: "NO_TRADE",
        reasonCode: "INDEX_CONTEXT_ONLY",
        explanation: "NIFTY 50 is monitored for context and is not orderable.",
        market,
      };
    }

    const breakout = last.close > last.high * 0.999 && last.volume > (volAvg ?? 0) * 1.4;
    const trendOk = emaFast > emaSlow && (vwap == null || last.close >= vwap);
    if (trendOk && breakout && (rsiVal == null || rsiVal < 70)) {
      const entry = last.close;
      const stop = entry - atrVal;
      const target = entry + atrVal * 2;
      const intent: TradeIntent = {
        decision: "TRADE",
        instrument: { exchange, symbol, instrumentType: "EQUITY" },
        direction: "LONG",
        entryType: "LIMIT",
        entryPrice: money(entry, 2),
        stopLoss: money(stop, 2),
        targets: [money(target, 2)],
        confidenceScore: 0.62,
        timeHorizon: "INTRADAY",
        strategy: "breakout-volume",
        thesis: "5m close above prior high with volume confirmation and EMA/VWAP trend filter.",
        invalidation: "Close back below the breakout candle low or VWAP.",
        maxRiskRequested: "300.00",
        metadata: { regime },
      };
      return { ...intent, decision: "TRADE" as const, market };
    }

    return {
      decision: "NO_TRADE",
      reasonCode: "NO_SETUP",
      explanation: `No breakout+volume setup. Regime=${regime}.`,
      market,
    };
  }
}
