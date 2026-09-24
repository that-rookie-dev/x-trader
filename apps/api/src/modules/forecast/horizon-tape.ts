import { buildHorizons } from "./horizons.js";
import type { PredictionLedger } from "../learning/ledger.js";

type Model = {
  vwap: number | null;
  veto: boolean;
  algo: { close: number; low: number; high: number };
  ai: { close: number; low: number; high: number };
};

type Print = {
  exchange: string;
  symbol: string;
  sessionDate: string;
  sampledAt: Date;
  spot: number;
  algo: Record<string, number>;
  ai: Record<string, number>;
};

function keyOf(exchange: string, symbol: string): string {
  return `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
}

function pack(rows: Array<{ id: string; close: string }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.id, Number(row.close)]));
}

/** Holds every quote's horizon forecast, then writes the whole buffer once a minute. */
export class HorizonTapeCollector {
  private models = new Map<string, Model>();
  private buffer: Print[] = [];
  private lastSpot = new Map<string, { at: number; spot: number }>();
  private flushing = false;

  remember(input: { exchange: string; symbol: string } & Model): void {
    this.models.set(keyOf(input.exchange, input.symbol), {
      vwap: input.vwap,
      veto: input.veto,
      algo: input.algo,
      ai: input.ai,
    });
  }

  onTick(exchange: string, symbol: string, last: number, at = new Date()): void {
    if (!(last > 0)) return;
    const model = this.models.get(keyOf(exchange, symbol));
    if (!model) return;
    const stamp = at.getTime();
    const prev = this.lastSpot.get(keyOf(exchange, symbol));
    if (prev && prev.spot === last && stamp - prev.at < 1000) return;
    this.lastSpot.set(keyOf(exchange, symbol), { at: stamp, spot: last });
    const shared = { last, vwap: model.vwap, veto: model.veto, now: at };
    const algo = buildHorizons({ ...shared, eodClose: model.algo.close, eodLow: model.algo.low, eodHigh: model.algo.high });
    const ai = buildHorizons({ ...shared, eodClose: model.ai.close, eodLow: model.ai.low, eodHigh: model.ai.high });
    this.buffer.push({
      exchange: exchange.toUpperCase(),
      symbol: symbol.toUpperCase(),
      sessionDate: at.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      sampledAt: at,
      spot: last,
      algo: pack(algo),
      ai: pack(ai),
    });
  }

  async flush(ledger: PredictionLedger): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.flushing = true;
    try {
      await ledger.appendPrints(batch);
    } catch {
      this.buffer = batch.concat(this.buffer);
    } finally {
      this.flushing = false;
    }
  }
}

export const horizonTape = new HorizonTapeCollector();
