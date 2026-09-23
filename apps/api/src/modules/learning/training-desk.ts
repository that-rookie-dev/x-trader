import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { candles, forecastParams, predictionLedger, quotesCache, watchlistItems } from "../../db/schema.js";
import { MARKET_CLOSE_MIN, MARKET_OPEN_MIN, istMinutes } from "../forecast/chain-tape.js";
import type { ForecastParamsStore } from "./params-store.js";

export type ScanEvent = {
  at: string;
  exchange: string;
  symbol: string;
  ok: boolean;
  detail?: string;
};

export type TuneEvent = {
  at: string;
  exchange: string;
  symbol: string;
  tuned: boolean;
  reason: string;
  mae?: number | null;
};

export type TrainingLiveState = {
  phase: "idle" | "scanning" | "resolving" | "tuning" | "halted";
  marketOpen: boolean;
  lastTickAt: string | null;
  cursor: number;
  trackedCount: number;
  recentScans: ScanEvent[];
  recentTunes: TuneEvent[];
  message: string | null;
};

/** In-memory batch progress + DB-backed learning KPIs. */
export class TrainingDesk {
  private state: TrainingLiveState = {
    phase: "idle",
    marketOpen: false,
    lastTickAt: null,
    cursor: 0,
    trackedCount: 0,
    recentScans: [],
    recentTunes: [],
    message: null,
  };

  constructor(
    private readonly db: Database,
    private readonly params: ForecastParamsStore,
  ) {}

  snapshotLive(): TrainingLiveState {
    const mins = istMinutes(new Date());
    const marketOpen = mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN;
    return { ...this.state, marketOpen };
  }

  setPhase(phase: TrainingLiveState["phase"], message?: string | null) {
    this.state.phase = phase;
    this.state.lastTickAt = new Date().toISOString();
    if (message !== undefined) this.state.message = message;
  }

  setTracked(count: number, cursor: number) {
    this.state.trackedCount = count;
    this.state.cursor = cursor;
  }

  noteScan(ev: Omit<ScanEvent, "at">) {
    this.state.recentScans.unshift({ ...ev, at: new Date().toISOString() });
    while (this.state.recentScans.length > 40) this.state.recentScans.pop();
    this.state.lastTickAt = new Date().toISOString();
  }

  noteTune(ev: Omit<TuneEvent, "at">) {
    this.state.recentTunes.unshift({ ...ev, at: new Date().toISOString() });
    while (this.state.recentTunes.length > 40) this.state.recentTunes.pop();
    this.state.lastTickAt = new Date().toISOString();
  }

  async metrics() {
    const [ledgerKinds, ledgerStatus, bySymbol, candleCount, quoteCount, watchCount, paramRows] =
      await Promise.all([
        this.db
          .select({
            kind: predictionLedger.kind,
            n: sql<number>`count(*)::int`,
          })
          .from(predictionLedger)
          .groupBy(predictionLedger.kind),
        this.db
          .select({
            status: predictionLedger.status,
            n: sql<number>`count(*)::int`,
          })
          .from(predictionLedger)
          .groupBy(predictionLedger.status),
        this.db.execute(sql`
          select exchange, symbol,
            count(*)::int as n,
            count(*) filter (where status = 'RESOLVED')::int as resolved,
            count(*) filter (where status = 'OPEN')::int as open,
            avg(abs(error_pct::float)) filter (where status = 'RESOLVED' and error_pct is not null) as mae
          from prediction_ledger
          group by exchange, symbol
        `),
        this.db.select({ n: sql<number>`count(*)::int` }).from(candles),
        this.db.select({ n: sql<number>`count(*)::int` }).from(quotesCache),
        this.db.select({ n: sql<number>`count(*)::int` }).from(watchlistItems),
        this.db.select().from(forecastParams),
      ]);

    type SymAgg = {
      exchange: string;
      symbol: string;
      n: number;
      resolved: number;
      open: number;
      mae: number | null;
    };
    const bySymbolRows = (
      Array.isArray(bySymbol) ? bySymbol : ((bySymbol as { rows?: SymAgg[] }).rows ?? [])
    ) as SymAgg[];

    const symbols: Array<{
      exchange: string;
      symbol: string;
      predictions: number;
      resolved: number;
      open: number;
      mae: number | null;
      algoMae: number | null;
      aiMae: number | null;
      algoLastTuned: string | null;
      aiLastTuned: string | null;
      paramsVersion: number | null;
      algoDeltaKeys: number;
      aiDeltaKeys: number;
    }> = [];
    for (const row of bySymbolRows) {
      const fp = await this.params.get(String(row.exchange), String(row.symbol)).catch(() => null);
      symbols.push({
        exchange: String(row.exchange),
        symbol: String(row.symbol),
        predictions: Number(row.n) || 0,
        resolved: Number(row.resolved) || 0,
        open: Number(row.open) || 0,
        mae: row.mae != null ? Number(row.mae) : null,
        algoMae: fp?.algo.scoreMae ?? null,
        aiMae: fp?.ai.scoreMae ?? null,
        algoLastTuned: fp?.algo.lastTunedSession ?? null,
        aiLastTuned: fp?.ai.lastTunedSession ?? null,
        paramsVersion: fp?.version ?? null,
        algoDeltaKeys: fp ? Object.keys(fp.algo.delta).length : 0,
        aiDeltaKeys: fp ? Object.keys(fp.ai.delta).length : 0,
      });
    }
    symbols.sort((a, b) => b.predictions - a.predictions);

    const kindMap = Object.fromEntries(ledgerKinds.map((r) => [r.kind, r.n]));
    const statusMap = Object.fromEntries(ledgerStatus.map((r) => [r.status, r.n]));
    const totalPred = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const resolved = statusMap.RESOLVED ?? 0;

    return {
      live: this.snapshotLive(),
      kpis: {
        trackedSymbols: watchCount[0]?.n ?? 0,
        paramModels: paramRows.length,
        predictionsTotal: totalPred,
        predictionsResolved: resolved,
        predictionsOpen: statusMap.OPEN ?? 0,
        eodAlgo: kindMap.EOD_ALGO ?? 0,
        eodAi: kindMap.EOD_AI ?? 0,
        paperTrades: (kindMap.PAPER_BUY ?? 0) + (kindMap.PAPER_SELL ?? 0),
        candleBars: candleCount[0]?.n ?? 0,
        quoteCacheRows: quoteCount[0]?.n ?? 0,
        /** Rough payload footprint estimate (ledger rows × ~0.8 KB). */
        estimatedLedgerKb: Math.round(totalPred * 0.8),
      },
      symbols,
      paramHistory: paramRows.slice(0, 24).map((r) => ({
        exchange: r.exchange,
        symbol: r.symbol,
        version: r.version,
        algoLastTuned: r.algoLastTunedSession,
        aiLastTuned: r.aiLastTunedSession,
        algoMae: r.algoScoreMae != null ? Number(r.algoScoreMae) : null,
        aiMae: r.aiScoreMae != null ? Number(r.aiScoreMae) : null,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }
}
