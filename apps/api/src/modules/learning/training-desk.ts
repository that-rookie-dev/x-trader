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

export type CycleProgress = {
  /** scan = open-hours board pass; tune = post-close auto-tune; idle = between cycles */
  kind: "scan" | "tune" | "idle";
  cycle: number;
  done: number;
  total: number;
  pct: number;
  label: string;
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
  progress: CycleProgress;
};

/** In-memory batch progress + DB-backed learning KPIs (whitelist-filtered). */
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
    progress: { kind: "idle", cycle: 0, done: 0, total: 0, pct: 0, label: "Idle" },
  };

  constructor(
    private readonly db: Database,
    private readonly params: ForecastParamsStore,
  ) {}

  snapshotLive(): TrainingLiveState {
    const mins = istMinutes(new Date());
    const marketOpen = mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN;
    return { ...this.state, marketOpen, progress: { ...this.state.progress } };
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

  beginCycle(kind: "scan" | "tune", total: number, cycle: number, label?: string) {
    const safeTotal = Math.max(0, total);
    this.state.progress = {
      kind,
      cycle,
      done: 0,
      total: safeTotal,
      pct: safeTotal === 0 ? 100 : 0,
      label:
        label ??
        (kind === "scan"
          ? `Scan cycle #${cycle}`
          : `Tune cycle #${cycle}`),
    };
    this.state.phase = kind === "scan" ? "scanning" : "tuning";
    this.state.lastTickAt = new Date().toISOString();
    this.state.message =
      safeTotal === 0
        ? "No whitelisted F&O symbols — add some in Settings"
        : `${this.state.progress.label} · 0/${safeTotal}`;
  }

  setProgress(done: number, total?: number) {
    const t = total ?? this.state.progress.total;
    const d = Math.min(Math.max(0, done), Math.max(t, 0));
    const pct = t <= 0 ? 100 : Math.round((d / t) * 100);
    this.state.progress = {
      ...this.state.progress,
      done: d,
      total: t,
      pct,
    };
    this.state.message = `${this.state.progress.label} · ${d}/${t} (${pct.toFixed(3)}%)`;
    this.state.lastTickAt = new Date().toISOString();
  }

  completeCycle(message?: string) {
    const t = this.state.progress.total;
    this.state.progress = {
      ...this.state.progress,
      done: t,
      pct: 100,
      kind: "idle",
      label: message ?? `Cycle #${this.state.progress.cycle} complete`,
    };
    this.state.phase = "idle";
    this.state.message = this.state.progress.label;
    this.state.lastTickAt = new Date().toISOString();
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
    const watchRows = await this.db.select().from(watchlistItems);
    const watchKeys = new Set(watchRows.map((w) => `${w.exchange.toUpperCase()}:${w.symbol.toUpperCase()}`));

    const [ledgerKinds, ledgerStatus, bySymbol, candleCount, quoteCount, paramRows] = await Promise.all([
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

    let whitelistPred = 0;
    let whitelistResolved = 0;
    let whitelistOpen = 0;

    for (const row of bySymbolRows) {
      const key = `${String(row.exchange).toUpperCase()}:${String(row.symbol).toUpperCase()}`;
      if (!watchKeys.has(key)) continue; // keep DB rows; hide removed symbols from UI
      const fp = await this.params.get(String(row.exchange), String(row.symbol)).catch(() => null);
      const predictions = Number(row.n) || 0;
      const resolved = Number(row.resolved) || 0;
      const open = Number(row.open) || 0;
      whitelistPred += predictions;
      whitelistResolved += resolved;
      whitelistOpen += open;
      symbols.push({
        exchange: String(row.exchange),
        symbol: String(row.symbol),
        predictions,
        resolved,
        open,
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
    const whitelistParams = paramRows.filter((r) =>
      watchKeys.has(`${r.exchange.toUpperCase()}:${r.symbol.toUpperCase()}`),
    );

    return {
      live: this.snapshotLive(),
      kpis: {
        trackedSymbols: watchRows.length,
        paramModels: whitelistParams.length,
        predictionsTotal: whitelistPred,
        predictionsResolved: whitelistResolved,
        predictionsOpen: whitelistOpen,
        eodAlgo: kindMap.EOD_ALGO ?? 0,
        eodAi: kindMap.EOD_AI ?? 0,
        paperTrades: (kindMap.PAPER_BUY ?? 0) + (kindMap.PAPER_SELL ?? 0),
        candleBars: candleCount[0]?.n ?? 0,
        quoteCacheRows: quoteCount[0]?.n ?? 0,
        estimatedLedgerKb: Math.round(whitelistPred * 0.8),
        /** Full ledger rows kept locally (including removed symbols). */
        archivedSymbols: Math.max(0, bySymbolRows.length - symbols.length),
        archivedPredictions: Math.max(0, (statusMap.RESOLVED ?? 0) + (statusMap.OPEN ?? 0) - whitelistPred),
      },
      symbols,
      paramHistory: whitelistParams.slice(0, 24).map((r) => ({
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
