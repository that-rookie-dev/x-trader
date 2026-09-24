/** Tunable forecast equation parameters (self-tuning desk). */

export type ForecastParams = {
  /** Blend weights — renormalized to sum 1 across all w* keys below. */
  wSession: number;
  wMagnet: number;
  wSpot: number;
  wFlow: number;
  wPain: number;
  wVwap: number;
  pullBull: number;
  pullBear: number;
  pullRange: number;
  /** How hard PCR≠1 tilts the session pull (0 = ignore PCR). */
  pcrTilt: number;
  /** When ADX is strong, add this to pull in the bias direction. */
  adxTrendTilt: number;
  /** High IV rank pulls session pull toward mid (mean-revert). */
  ivMeanRevert: number;
  /** Gap % from prior close tilts pull (open drive). */
  gapTilt: number;
  /** Desk vote score (−n…+n) tilts pull. */
  voteTilt: number;
  /** In the last hour, shift this fraction of non-spot weight onto spot. */
  lateSpotBoost: number;
  optionRemainExpiry: number;
  optionRemainLater: number;
  netFloorBase: number;
  netFloorLate: number;
};

export const BLEND_KEYS = ["wSession", "wMagnet", "wSpot", "wFlow", "wPain", "wVwap"] as const;
export type BlendKey = (typeof BLEND_KEYS)[number];

export const DEFAULT_FORECAST_PARAMS: ForecastParams = {
  wSession: 0.38,
  wMagnet: 0.28,
  wSpot: 0.18,
  wFlow: 0.06,
  wPain: 0.05,
  wVwap: 0.05,
  pullBull: 0.68,
  pullBear: 0.32,
  pullRange: 0.5,
  pcrTilt: 0.12,
  adxTrendTilt: 0.08,
  ivMeanRevert: 0.1,
  gapTilt: 0.15,
  voteTilt: 0.04,
  lateSpotBoost: 0.25,
  optionRemainExpiry: 0.08,
  optionRemainLater: 0.55,
  netFloorBase: 150,
  netFloorLate: 250,
};

const BOUNDS: Record<keyof ForecastParams, { min: number; max: number }> = {
  wSession: { min: 0.02, max: 0.7 },
  wMagnet: { min: 0.02, max: 0.7 },
  wSpot: { min: 0.02, max: 0.7 },
  wFlow: { min: 0, max: 0.35 },
  wPain: { min: 0, max: 0.35 },
  wVwap: { min: 0, max: 0.35 },
  pullBull: { min: 0.55, max: 0.85 },
  pullBear: { min: 0.15, max: 0.45 },
  pullRange: { min: 0.35, max: 0.65 },
  pcrTilt: { min: 0, max: 0.35 },
  adxTrendTilt: { min: 0, max: 0.25 },
  ivMeanRevert: { min: 0, max: 0.35 },
  gapTilt: { min: 0, max: 0.4 },
  voteTilt: { min: 0, max: 0.15 },
  lateSpotBoost: { min: 0, max: 0.55 },
  optionRemainExpiry: { min: 0.02, max: 0.25 },
  optionRemainLater: { min: 0.25, max: 0.85 },
  netFloorBase: { min: 50, max: 500 },
  netFloorLate: { min: 100, max: 800 },
};

export function clampParams(input: Partial<ForecastParams> & Record<string, number>): ForecastParams {
  const merged: ForecastParams = { ...DEFAULT_FORECAST_PARAMS };
  for (const key of Object.keys(DEFAULT_FORECAST_PARAMS) as Array<keyof ForecastParams>) {
    const raw = input[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const { min, max } = BOUNDS[key];
    merged[key] = Math.min(max, Math.max(min, raw));
  }
  return renormalizeWeights(merged);
}

export function renormalizeWeights(params: ForecastParams): ForecastParams {
  let sum = 0;
  for (const key of BLEND_KEYS) sum += params[key];
  if (!(sum > 0)) {
    return { ...params, ...pickDefaults(BLEND_KEYS) };
  }
  const next = { ...params };
  for (const key of BLEND_KEYS) next[key] = params[key] / sum;
  return next;
}

function pickDefaults(keys: readonly BlendKey[]): Pick<ForecastParams, BlendKey> {
  const out = {} as Pick<ForecastParams, BlendKey>;
  for (const key of keys) out[key] = DEFAULT_FORECAST_PARAMS[key];
  return out;
}

export function pullForBias(params: ForecastParams, bias: string): number {
  if (bias === "BULLISH") return params.pullBull;
  if (bias === "BEARISH") return params.pullBear;
  return params.pullRange;
}

export type PredictionMode = "ALGO" | "AI";

/** Live / stored tape features that feed the EOD blend. */
export type EodFeatures = {
  pcr?: number | null;
  maxPain?: number | null;
  vwap?: number | null;
  adx?: number | null;
  ivRank?: number | null;
  /** Minutes remaining until 15:30 IST (0 at/after close). */
  minutesToClose?: number | null;
  orbHigh?: number | null;
  orbLow?: number | null;
  /** (last − priorClose) / priorClose */
  gapPct?: number | null;
  /** Sum of desk vote signals */
  voteScore?: number | null;
  /** Shared news shift in index points, added to both Algo and AI closes. */
  newsPoints?: number | null;
};

/** Keys that differ from `base` (absolute values in the delta object). */
export function diffParams(base: ForecastParams, next: ForecastParams): Partial<ForecastParams> {
  const out: Partial<ForecastParams> = {};
  for (const key of Object.keys(DEFAULT_FORECAST_PARAMS) as Array<keyof ForecastParams>) {
    if (Math.abs(next[key] - base[key]) > 1e-9) out[key] = next[key];
  }
  return out;
}

/** Apply absolute overrides (AI/algo deltas) onto a base param set. */
export function applyParamDelta(
  base: ForecastParams,
  delta: Partial<ForecastParams> | null | undefined,
): ForecastParams {
  if (!delta) return base;
  return clampParams({ ...base, ...delta });
}

export function featuresFromPayload(p: Record<string, unknown>): EodFeatures {
  const num = (k: string) => (typeof p[k] === "number" && Number.isFinite(p[k] as number) ? (p[k] as number) : null);
  return {
    pcr: num("pcr"),
    maxPain: num("maxPain"),
    vwap: num("vwap"),
    adx: num("adx"),
    ivRank: num("ivRank"),
    minutesToClose: num("minutesToClose"),
    orbHigh: num("orbHigh"),
    orbLow: num("orbLow"),
    gapPct: num("gapPct"),
    voteScore: num("voteScore"),
  };
}
