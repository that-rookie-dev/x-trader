import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { horizonTape, predictionLedger } from "../../db/schema.js";
import type { ForecastParams } from "./params.js";

export type LedgerKind = "EOD_ALGO" | "EOD_AI" | "PAPER_BUY" | "PAPER_SELL";
export type LedgerStatus = "OPEN" | "RESOLVED" | "EXPIRED";

export type RecordPredictionInput = {
  kind: LedgerKind;
  exchange: string;
  symbol: string;
  expiry?: string | null;
  sessionDate: string;
  horizon?: string | null;
  targetAt?: string | null;
  predictedClose?: number | null;
  predictedPremium?: number | null;
  predictedDirection?: string | null;
  entryPrice?: number | null;
  payload?: Record<string, unknown>;
  sourceRef?: string | null;
  paramsSnapshot?: ForecastParams;
  paramsVersion?: number;
};

export type ResolveActualInput = {
  kind: LedgerKind;
  exchange: string;
  symbol: string;
  sessionDate: string;
  horizon?: string | null;
  actualClose?: number | null;
  actualPremium?: number | null;
  actualPnl?: number | null;
  entrySpot?: number | null;
};

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function scorePrediction(input: {
  predictedClose: number | null;
  actualClose: number | null;
  predictedDirection?: string | null;
  entrySpot?: number | null;
}): { errorAbs: number | null; errorPct: number | null; directionHit: boolean | null } {
  const pred = input.predictedClose;
  const actual = input.actualClose;
  if (pred == null || actual == null || !(Math.abs(pred) > 0)) {
    return { errorAbs: null, errorPct: null, directionHit: null };
  }
  const errorAbs = Math.abs(actual - pred);
  const errorPct = (errorAbs / Math.abs(pred)) * 100;
  let directionHit: boolean | null = null;
  const entry = input.entrySpot;
  if (entry != null && Number.isFinite(entry) && input.predictedDirection) {
    const predUp = input.predictedDirection === "BULLISH" || pred >= entry;
    const predDown = input.predictedDirection === "BEARISH" || pred < entry;
    const actualUp = actual >= entry;
    if (input.predictedDirection === "RANGE") {
      directionHit = Math.abs(actual - entry) / Math.max(Math.abs(entry), 1) < 0.002;
    } else if (predUp && !predDown) {
      directionHit = actualUp;
    } else if (predDown) {
      directionHit = !actualUp;
    }
  } else if (entry != null && Number.isFinite(entry)) {
    directionHit = pred >= entry === actual >= entry;
  }
  return { errorAbs, errorPct, directionHit };
}

export function predictionErrorPct(predicted: number, actual: number): number {
  if (!(Math.abs(predicted) > 0)) return 0;
  return ((actual - predicted) / predicted) * 100;
}

export class PredictionLedger {
  constructor(private readonly db: Database) {}

  async record(input: RecordPredictionInput): Promise<void> {
    const payload = {
      ...(input.payload ?? {}),
      ...(input.paramsSnapshot ? { params: input.paramsSnapshot } : {}),
      ...(input.paramsVersion != null ? { paramsVersion: input.paramsVersion } : {}),
    };
    const existing = await this.db
      .select()
      .from(predictionLedger)
      .where(
        and(
          eq(predictionLedger.kind, input.kind),
          eq(predictionLedger.exchange, input.exchange.toUpperCase()),
          eq(predictionLedger.symbol, input.symbol.toUpperCase()),
          eq(predictionLedger.sessionDate, input.sessionDate),
          eq(predictionLedger.horizon, input.horizon || "eod"),
        ),
      )
      .limit(1);
    const values = {
      kind: input.kind,
      exchange: input.exchange.toUpperCase(),
      symbol: input.symbol.toUpperCase(),
      expiry: input.expiry ?? null,
      sessionDate: input.sessionDate,
      horizon: input.horizon || "eod",
      targetAt: input.targetAt ? new Date(input.targetAt) : null,
      predictedAt: new Date(),
      predictedClose: input.predictedClose != null ? String(input.predictedClose) : null,
      predictedPremium: input.predictedPremium != null ? String(input.predictedPremium) : null,
      predictedDirection: input.predictedDirection ?? null,
      entryPrice: input.entryPrice != null ? String(input.entryPrice) : null,
      payload,
      sourceRef: input.sourceRef ?? null,
      status: "OPEN" as const,
    };
    if (existing[0]) {
      if (existing[0].status === "RESOLVED") return;
      await this.db
        .update(predictionLedger)
        .set({
          predictedAt: values.predictedAt,
          targetAt: values.targetAt ?? existing[0].targetAt,
          predictedClose: values.predictedClose,
          predictedPremium: values.predictedPremium,
          predictedDirection: values.predictedDirection,
          entryPrice: values.entryPrice ?? existing[0].entryPrice,
          payload: values.payload,
          expiry: values.expiry,
          sourceRef: values.sourceRef ?? existing[0].sourceRef,
        })
        .where(eq(predictionLedger.id, existing[0].id));
      return;
    }
    await this.db.insert(predictionLedger).values(values);
  }

  async resolve(input: ResolveActualInput): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(predictionLedger)
      .where(
        and(
          eq(predictionLedger.kind, input.kind),
          eq(predictionLedger.exchange, input.exchange.toUpperCase()),
          eq(predictionLedger.symbol, input.symbol.toUpperCase()),
          eq(predictionLedger.sessionDate, input.sessionDate),
          eq(predictionLedger.horizon, input.horizon || "eod"),
        ),
      )
      .limit(1);
    if (!row || row.status === "RESOLVED") return false;
    const predictedClose = num(row.predictedClose);
    const actualClose = input.actualClose ?? null;
    const scored = scorePrediction({
      predictedClose,
      actualClose,
      predictedDirection: row.predictedDirection,
      entrySpot: input.entrySpot ?? num(row.entryPrice),
    });
    await this.db
      .update(predictionLedger)
      .set({
        actualAt: new Date(),
        actualClose: actualClose != null ? String(actualClose) : row.actualClose,
        actualPremium: input.actualPremium != null ? String(input.actualPremium) : row.actualPremium,
        actualPnl: input.actualPnl != null ? String(input.actualPnl) : row.actualPnl,
        errorAbs: scored.errorAbs != null ? String(scored.errorAbs) : null,
        errorPct: scored.errorPct != null ? String(scored.errorPct) : null,
        directionHit: scored.directionHit,
        status: "RESOLVED",
      })
      .where(eq(predictionLedger.id, row.id));
    return true;
  }

  async dueHorizons(now = new Date(), limit = 20) {
    return this.db
      .select()
      .from(predictionLedger)
      .where(and(eq(predictionLedger.status, "OPEN"), lte(predictionLedger.targetAt, now)))
      .orderBy(asc(predictionLedger.targetAt))
      .limit(limit);
  }

  async resolveOpenEod(input: {
    exchange: string;
    symbol: string;
    sessionDate: string;
    actualClose: number;
    preferAi?: boolean;
  }): Promise<number> {
    let n = 0;
    if (await this.resolve({ kind: "EOD_ALGO", ...input })) n += 1;
    if (await this.resolve({ kind: "EOD_AI", ...input })) n += 1;
    return n;
  }

  async getDayPrediction(input: {
    exchange: string;
    symbol: string;
    sessionDate: string;
    prefer?: "ALGO" | "AI";
  }): Promise<{ predicted: number; actual: number | null; errorPct: number | null; kind: LedgerKind; status: string } | null> {
    const rows = await this.db
      .select()
      .from(predictionLedger)
      .where(
        and(
          eq(predictionLedger.exchange, input.exchange.toUpperCase()),
          eq(predictionLedger.symbol, input.symbol.toUpperCase()),
          eq(predictionLedger.sessionDate, input.sessionDate),
          inArray(predictionLedger.kind, ["EOD_AI", "EOD_ALGO"]),
        ),
      );
    const ai = rows.find((r) => r.kind === "EOD_AI" && r.horizon === "eod") ?? rows.find((r) => r.kind === "EOD_AI");
    const algo = rows.find((r) => r.kind === "EOD_ALGO" && r.horizon === "eod") ?? rows.find((r) => r.kind === "EOD_ALGO");
    const preferAi = input.prefer !== "ALGO";
    const pick = preferAi
      ? ai?.predictedClose != null
        ? ai
        : algo
      : algo?.predictedClose != null
        ? algo
        : ai;
    if (!pick?.predictedClose) return null;
    const predicted = Number(pick.predictedClose);
    const actual = pick.actualClose != null ? Number(pick.actualClose) : null;
    const signed = actual != null && Math.abs(predicted) > 0 ? predictionErrorPct(predicted, actual) : null;
    return {
      predicted,
      actual,
      errorPct: signed,
      kind: pick.kind as LedgerKind,
      status: pick.status,
    };
  }

  async summary(limit = 40): Promise<{
    mae: number | null;
    hitRate: number | null;
    samples: number;
    recent: Array<{
      kind: string;
      symbol: string;
      sessionDate: string;
      predictedClose: number | null;
      actualClose: number | null;
      errorPct: number | null;
      directionHit: boolean | null;
      status: string;
    }>;
  }> {
    const recent = await this.db
      .select()
      .from(predictionLedger)
      .where(inArray(predictionLedger.kind, ["EOD_ALGO", "EOD_AI"]))
      .orderBy(desc(predictionLedger.sessionDate), desc(predictionLedger.predictedAt))
      .limit(limit);
    const resolved = recent.filter((r) => r.status === "RESOLVED" && r.errorPct != null);
    const mae =
      resolved.length > 0
        ? resolved.reduce((sum, r) => sum + Math.abs(Number(r.errorPct)), 0) / resolved.length
        : null;
    const withHit = resolved.filter((r) => r.directionHit != null);
    const hitRate =
      withHit.length > 0 ? withHit.filter((r) => r.directionHit).length / withHit.length : null;
    return {
      mae,
      hitRate,
      samples: resolved.length,
      recent: recent.map((r) => ({
        kind: r.kind,
        symbol: r.symbol,
        sessionDate: r.sessionDate,
        predictedClose: num(r.predictedClose),
        actualClose: num(r.actualClose),
        errorPct: num(r.errorPct),
        directionHit: r.directionHit,
        status: r.status,
      })),
    };
  }

  async studyMemory(symbol: string, limit = 8): Promise<string> {
    const rows = await this.db
      .select()
      .from(predictionLedger)
      .where(
        and(
          eq(predictionLedger.symbol, symbol.toUpperCase()),
          inArray(predictionLedger.kind, ["EOD_ALGO", "EOD_AI"]),
          eq(predictionLedger.status, "RESOLVED"),
        ),
      )
      .orderBy(desc(predictionLedger.sessionDate))
      .limit(limit);
    if (!rows.length) return "No resolved prediction history yet.";
    return rows
      .map((r) => {
        const err = r.errorPct != null ? `${Number(r.errorPct).toFixed(2)}%` : "?";
        const hit = r.directionHit == null ? "n/a" : r.directionHit ? "hit" : "miss";
        return `${r.sessionDate} ${r.kind}: pred ${r.predictedClose} actual ${r.actualClose} err ${err} dir ${hit}`;
      })
      .join("\n");
  }

  async horizonCalibration(input: { exchange: string; symbol: string; sessionDate: string }): Promise<Record<string, { samples: number; within: number | null }>> {
    const rows = await this.db
      .select()
      .from(predictionLedger)
      .where(
        and(
          eq(predictionLedger.kind, "EOD_ALGO"),
          eq(predictionLedger.status, "RESOLVED"),
          eq(predictionLedger.exchange, input.exchange.toUpperCase()),
          eq(predictionLedger.symbol, input.symbol.toUpperCase()),
          eq(predictionLedger.sessionDate, input.sessionDate),
        ),
      );
    const buckets = new Map<string, number[]>();
    for (const row of rows) {
      const predicted = num(row.predictedClose);
      const actual = num(row.actualClose);
      if (predicted == null || actual == null) continue;
      const list = buckets.get(row.horizon) ?? [];
      list.push(Math.abs(actual - predicted));
      buckets.set(row.horizon, list);
    }
    const out: Record<string, { samples: number; within: number | null }> = {};
    for (const [horizon, errors] of buckets) {
      const sorted = [...errors].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)] ?? null;
      out[horizon] = { samples: errors.length, within: mid };
    }
    return out;
  }

  async listResolvedAlgo(
    limit = 60,
    filter?: { exchange: string; symbol: string },
  ): Promise<
    Array<{
      sessionDate: string;
      symbol: string;
      predictedClose: number;
      actualClose: number;
      entryPrice: number | null;
      predictedDirection: string | null;
      payload: Record<string, unknown>;
      errorPct: number;
    }>
  > {
    const cond = [
      eq(predictionLedger.kind, "EOD_ALGO"),
      eq(predictionLedger.status, "RESOLVED"),
      eq(predictionLedger.horizon, "eod"),
    ];
    if (filter) {
      cond.push(eq(predictionLedger.exchange, filter.exchange.toUpperCase()));
      cond.push(eq(predictionLedger.symbol, filter.symbol.toUpperCase()));
    }
    const rows = await this.db
      .select()
      .from(predictionLedger)
      .where(and(...cond))
      .orderBy(desc(predictionLedger.sessionDate))
      .limit(limit);
    return rows
      .map((r) => {
        const predictedClose = num(r.predictedClose);
        const actualClose = num(r.actualClose);
        const errorPct = num(r.errorPct);
        if (predictedClose == null || actualClose == null || errorPct == null) return null;
        return {
          sessionDate: r.sessionDate,
          symbol: r.symbol,
          predictedClose,
          actualClose,
          entryPrice: num(r.entryPrice),
          predictedDirection: r.predictedDirection,
          payload: (r.payload ?? {}) as Record<string, unknown>,
          errorPct: Math.abs(errorPct),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
  }

  async recentPaperExpectancy(limit = 20): Promise<{ samples: number; value: number }> {
    const rows = await this.db
      .select()
      .from(predictionLedger)
      .where(and(inArray(predictionLedger.kind, ["PAPER_BUY", "PAPER_SELL"]), eq(predictionLedger.status, "RESOLVED")))
      .orderBy(desc(predictionLedger.actualAt))
      .limit(limit);
    const pnls = rows.map((r) => num(r.actualPnl)).filter((n): n is number => n != null);
    if (!pnls.length) return { samples: 0, value: 0 };
    return { samples: pnls.length, value: pnls.reduce((a, b) => a + b, 0) / pnls.length };
  }

  sessionDateIst(now = new Date()): string {
    return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  /** Write a minute of tick forecasts. Nothing in the batch is dropped. */
  async appendPrints(
    rows: Array<{
      exchange: string;
      symbol: string;
      sessionDate: string;
      sampledAt: Date;
      spot: number;
      algo: Record<string, number>;
      ai: Record<string, number>;
    }>,
  ): Promise<void> {
    const values = rows
      .filter((row) => row.spot > 0)
      .map((row) => ({
        exchange: row.exchange.toUpperCase(),
        symbol: row.symbol.toUpperCase(),
        sessionDate: row.sessionDate,
        sampledAt: row.sampledAt,
        spot: String(row.spot),
        algo: row.algo,
        ai: row.ai,
      }));
    if (!values.length) return;
    await this.db.insert(horizonTape).values(values);
    const keep = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await this.db.delete(horizonTape).where(lt(horizonTape.sampledAt, keep));
  }

  async readTape(input: { exchange: string; symbol: string; sessionDate: string; horizon: string }): Promise<
    Array<{ at: string; spot: number; algo: number | null; ai: number | null }>
  > {
    const rows = await this.db
      .select()
      .from(horizonTape)
      .where(
        and(
          eq(horizonTape.exchange, input.exchange.toUpperCase()),
          eq(horizonTape.symbol, input.symbol.toUpperCase()),
          eq(horizonTape.sessionDate, input.sessionDate),
        ),
      )
      .orderBy(asc(horizonTape.sampledAt))
      .limit(20000);
    return rows.map((row) => ({
      at: row.sampledAt.toISOString(),
      spot: Number(row.spot),
      algo: row.algo[input.horizon] ?? null,
      ai: row.ai[input.horizon] ?? null,
    }));
  }
}
