import type { ForecastBias } from "@xtrader/domain";
import {
  applyParamDelta,
  clampParams,
  DEFAULT_FORECAST_PARAMS,
  featuresFromPayload,
  type EodFeatures,
  type ForecastParams,
} from "./params.js";
import { predictEodSpot } from "../forecast/eod.js";
import type { ForecastParamsStore } from "./params-store.js";
import type { PredictionLedger } from "./ledger.js";

const WEIGHT_KEYS = ["wSession", "wMagnet", "wSpot", "wFlow", "wPain", "wVwap"] as const;
const PULL_KEYS = ["pullBull", "pullBear", "pullRange"] as const;
const FEATURE_KEYS = ["pcrTilt", "adxTrendTilt", "ivMeanRevert", "gapTilt", "voteTilt", "lateSpotBoost"] as const;
const OPTION_KEYS = ["optionRemainExpiry", "optionRemainLater"] as const;
const STEP = 0.04;
const MIN_IMPROVE = 0.02; // absolute MAE percentage points

export type TuneSample = {
  last: number;
  bias: ForecastBias;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  supports?: number[];
  resistances?: number[];
  actualClose: number;
  pull?: number;
  features?: EodFeatures;
};

function maeForParams(samples: TuneSample[], params: ForecastParams): { mae: number; hitRate: number } {
  if (!samples.length) return { mae: Number.POSITIVE_INFINITY, hitRate: 0 };
  let abs = 0;
  let hits = 0;
  for (const s of samples) {
    const pred = predictEodSpot({
      last: s.last,
      bias: s.bias,
      expectedLow: s.expectedLow,
      expectedHigh: s.expectedHigh,
      magnet: s.magnet,
      supports: s.supports,
      resistances: s.resistances,
      pull: s.pull,
      params,
      features: s.features,
    });
    const close = Number(pred.close);
    const err = Math.abs(s.actualClose - close) / Math.max(Math.abs(close), 1e-6);
    abs += err * 100;
    const predUp = close >= s.last;
    const actualUp = s.actualClose >= s.last;
    if (predUp === actualUp) hits += 1;
  }
  return { mae: abs / samples.length, hitRate: hits / samples.length };
}

function neighbor(params: ForecastParams, key: keyof ForecastParams, delta: number): ForecastParams {
  return clampParams({ ...params, [key]: params[key] + delta });
}

/** Coordinate descent over weights/pulls; accept only if MAE improves. */
export function searchParams(samples: TuneSample[], start: ForecastParams): {
  params: ForecastParams;
  maeBefore: number;
  maeAfter: number;
  hitBefore: number;
  hitAfter: number;
  improved: boolean;
} {
  const before = maeForParams(samples, start);
  let best = start;
  let bestMae = before.mae;
  let bestHit = before.hitRate;

  const keys: Array<keyof ForecastParams> = [...WEIGHT_KEYS, ...PULL_KEYS, ...FEATURE_KEYS, ...OPTION_KEYS];
  for (const key of keys) {
    for (const delta of [-STEP, STEP, -STEP / 2, STEP / 2]) {
      const cand = neighbor(best, key, delta);
      const score = maeForParams(samples, cand);
      if (score.mae < bestMae - 1e-9 && score.hitRate >= bestHit - 0.08) {
        best = cand;
        bestMae = score.mae;
        bestHit = score.hitRate;
      }
    }
  }

  const improved = bestMae <= before.mae - MIN_IMPROVE;
  return {
    params: improved ? best : start,
    maeBefore: before.mae,
    maeAfter: improved ? bestMae : before.mae,
    hitBefore: before.hitRate,
    hitAfter: improved ? bestHit : before.hitRate,
    improved,
  };
}

export function applyAiParamDelta(
  current: ForecastParams,
  delta: Partial<ForecastParams> | null | undefined,
): ForecastParams {
  return applyParamDelta(current, delta);
}

export function sampleFromLedgerRow(row: {
  predictedClose: number;
  actualClose: number;
  entryPrice: number | null;
  predictedDirection: string | null;
  payload: Record<string, unknown>;
}): TuneSample | null {
  const p = row.payload;
  const last = typeof p.last === "number" ? p.last : row.entryPrice;
  const expectedLow = typeof p.expectedLow === "number" ? p.expectedLow : null;
  const expectedHigh = typeof p.expectedHigh === "number" ? p.expectedHigh : null;
  const magnet = typeof p.magnet === "number" ? p.magnet : last;
  if (last == null || expectedLow == null || expectedHigh == null) return null;
  const bias = (row.predictedDirection as ForecastBias) || "RANGE";
  return {
    last,
    bias,
    expectedLow,
    expectedHigh,
    magnet: magnet ?? last,
    supports: Array.isArray(p.supports) ? (p.supports as number[]) : undefined,
    resistances: Array.isArray(p.resistances) ? (p.resistances as number[]) : undefined,
    actualClose: row.actualClose,
    pull: typeof p.pull === "number" ? p.pull : undefined,
    features: featuresFromPayload(p),
  };
}

export class AutoTuner {
  constructor(
    private readonly params: ForecastParamsStore,
    private readonly ledger: PredictionLedger,
  ) {}

  /** Per-symbol ALGO tune after close. AI branch rebased on algo ⊕ aiDelta. */
  async tuneIfNeeded(
    exchange: string,
    symbol: string,
    sessionDate: string,
  ): Promise<{ tuned: boolean; reason: string }> {
    const row = await this.params.get(exchange, symbol);
    if (row.algo.lastTunedSession === sessionDate) {
      return { tuned: false, reason: "already tuned for session" };
    }
    const resolved = await this.ledger.listResolvedAlgo(60, { exchange, symbol });
    const samples = resolved.map(sampleFromLedgerRow).filter((s): s is TuneSample => s != null);
    if (samples.length < 5) {
      await this.adjustFloorsFromPaper(exchange, symbol, sessionDate);
      return { tuned: false, reason: `need >=5 samples (have ${samples.length})` };
    }

    const result = searchParams(samples, row.algo.params);
    let next = result.params;
    let maeAfter = result.maeAfter;
    let hitAfter = result.hitAfter;
    let improved = result.improved;

    next = await this.nudgeFloors(next);
    const floorsOnly =
      next.netFloorBase !== row.algo.params.netFloorBase || next.netFloorLate !== row.algo.params.netFloorLate;

    if (!improved && !floorsOnly) {
      await this.params.saveAlgo(exchange, symbol, {
        params: row.algo.params,
        lastTunedSession: sessionDate,
        scoreMae: result.maeBefore,
        scoreHitRate: result.hitBefore,
      });
      // Still refresh AI scores from AI ledger if possible
      await this.refreshAiScores(exchange, symbol, sessionDate);
      return { tuned: false, reason: "no MAE improvement" };
    }

    await this.params.saveAlgo(exchange, symbol, {
      params: next,
      scoreMae: maeAfter,
      scoreHitRate: hitAfter,
      lastTunedSession: sessionDate,
      historyEntry: {
        at: new Date().toISOString(),
        sessionDate,
        branch: "ALGO",
        params: next,
        maeBefore: result.maeBefore,
        maeAfter,
        hitBefore: result.hitBefore,
        hitAfter,
      },
    });
    await this.refreshAiScores(exchange, symbol, sessionDate);
    return { tuned: true, reason: improved ? "MAE improved" : "floors adjusted" };
  }

  /**
   * AI delta: merge onto algo params only if replay MAE beats current AI branch.
   * Stores both aiParams and aiDelta (absolute overrides vs algo).
   */
  async considerAiDelta(
    exchange: string,
    symbol: string,
    sessionDate: string,
    delta: Partial<ForecastParams> | null,
  ): Promise<boolean> {
    if (!delta) return false;
    const row = await this.params.get(exchange, symbol);
    const resolved = await this.ledger.listResolvedAlgo(60, { exchange, symbol });
    const samples = resolved.map(sampleFromLedgerRow).filter((s): s is TuneSample => s != null);
    if (samples.length < 5) {
      // Accept tentatively so Study can seed AI delta before enough days exist
      const candidate = applyAiParamDelta(row.algo.params, delta);
      await this.params.saveAi(exchange, symbol, {
        params: candidate,
        delta,
        lastTunedSession: sessionDate,
        historyEntry: {
          at: new Date().toISOString(),
          sessionDate,
          source: "ai-delta-seed",
          delta,
          params: candidate,
        },
      });
      return true;
    }
    const candidate = applyAiParamDelta(row.algo.params, delta);
    const base = maeForParams(samples, row.ai.params);
    const score = maeForParams(samples, candidate);
    if (!(score.mae <= base.mae - MIN_IMPROVE) || score.hitRate < base.hitRate - 0.08) return false;
    await this.params.saveAi(exchange, symbol, {
      params: candidate,
      delta,
      scoreMae: score.mae,
      scoreHitRate: score.hitRate,
      lastTunedSession: sessionDate,
      historyEntry: {
        at: new Date().toISOString(),
        sessionDate,
        source: "ai-delta",
        delta,
        params: candidate,
        maeBefore: base.mae,
        maeAfter: score.mae,
      },
    });
    return true;
  }

  private async refreshAiScores(exchange: string, symbol: string, sessionDate: string): Promise<void> {
    const row = await this.params.get(exchange, symbol);
    const resolved = await this.ledger.listResolvedAlgo(60, { exchange, symbol });
    const samples = resolved.map(sampleFromLedgerRow).filter((s): s is TuneSample => s != null);
    if (samples.length < 3) return;
    // Rebase AI = algo ⊕ aiDelta and score
    const rebased = applyParamDelta(row.algo.params, row.ai.delta);
    const score = maeForParams(samples, rebased);
    await this.params.saveAi(exchange, symbol, {
      params: rebased,
      delta: row.ai.delta,
      scoreMae: score.mae,
      scoreHitRate: score.hitRate,
      lastTunedSession: sessionDate,
    });
  }

  private async nudgeFloors(params: ForecastParams): Promise<ForecastParams> {
    const exp = await this.ledger.recentPaperExpectancy(20);
    if (exp.samples < 5) return params;
    if (exp.value < 0) {
      return clampParams({
        ...params,
        netFloorBase: params.netFloorBase + 25,
        netFloorLate: params.netFloorLate + 25,
      });
    }
    if (exp.value > 200) {
      return clampParams({
        ...params,
        netFloorBase: params.netFloorBase - 10,
        netFloorLate: params.netFloorLate - 10,
      });
    }
    return params;
  }

  private async adjustFloorsFromPaper(
    exchange: string,
    symbol: string,
    sessionDate: string,
  ): Promise<void> {
    const row = await this.params.get(exchange, symbol);
    const next = await this.nudgeFloors(row.algo.params);
    if (next.netFloorBase === row.algo.params.netFloorBase && next.netFloorLate === row.algo.params.netFloorLate) {
      await this.params.saveAlgo(exchange, symbol, { params: row.algo.params, lastTunedSession: sessionDate });
      return;
    }
    await this.params.saveAlgo(exchange, symbol, {
      params: next,
      lastTunedSession: sessionDate,
      historyEntry: {
        at: new Date().toISOString(),
        sessionDate,
        source: "paper-floors",
        params: next,
        maeBefore: row.algo.scoreMae,
        maeAfter: row.algo.scoreMae,
      },
    });
  }
}

export { DEFAULT_FORECAST_PARAMS };
