import { d } from "@xtrader/domain";

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const v of values.slice(period)) {
    prev = v * k + prev * (1 - k);
  }
  return prev;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i]! - values[i - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Array<{ high: number; low: number; close: number }>, period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]!.close;
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return sma(trs, period);
}

export function sessionVwap(
  candles: Array<{ high: number; low: number; close: number; volume: number }>,
): number | null {
  let pv = d(0);
  let vol = d(0);
  for (const c of candles) {
    const typical = d(c.high).plus(c.low).plus(c.close).div(3);
    pv = pv.plus(typical.mul(c.volume));
    vol = vol.plus(c.volume);
  }
  if (vol.lte(0)) return null;
  return pv.div(vol).toNumber();
}

export function volumeAverage(volumes: number[], period = 20): number | null {
  return sma(volumes, period);
}

function emaSeries(values: number[], period: number): number[] | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (const value of values.slice(period)) {
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9): { line: number; signal: number; hist: number } | null {
  const fastE = emaSeries(values, fast);
  const slowE = emaSeries(values, slow);
  if (!fastE || !slowE) return null;
  const line = slowE.map((slowVal, i) => fastE[fastE.length - slowE.length + i]! - slowVal);
  const sig = ema(line, signal);
  const last = line[line.length - 1];
  if (last == null || sig == null) return null;
  return { line: last, signal: sig, hist: last - sig };
}

export function supertrend(
  candles: Array<{ high: number; low: number; close: number }>,
  period = 10,
  multiplier = 3,
): { value: number; side: 1 | -1 } | null {
  const atrVal = atr(candles, period);
  if (atrVal == null || candles.length < period + 2) return null;
  const last = candles[candles.length - 1]!;
  const mid = (last.high + last.low) / 2;
  const upper = mid + multiplier * atrVal;
  const lower = mid - multiplier * atrVal;
  if (last.close >= lower && last.close > candles[candles.length - 2]!.close) return { value: lower, side: 1 };
  if (last.close <= upper && last.close < candles[candles.length - 2]!.close) return { value: upper, side: -1 };
  return last.close >= mid ? { value: lower, side: 1 } : { value: upper, side: -1 };
}

export function centralPivotRange(prior: { high: number; low: number; close: number }) {
  const pivot = (prior.high + prior.low + prior.close) / 3;
  const bc = (prior.high + prior.low) / 2;
  const tc = 2 * pivot - bc;
  const top = Math.max(tc, bc);
  const bottom = Math.min(tc, bc);
  return {
    pivot,
    tc: top,
    bc: bottom,
    r1: 2 * pivot - prior.low,
    s1: 2 * pivot - prior.high,
    r2: pivot + (prior.high - prior.low),
    s2: pivot - (prior.high - prior.low),
  };
}

export function adx(
  candles: Array<{ high: number; low: number; close: number }>,
  period = 14,
): { adx: number; plusDi: number; minusDi: number } | null {
  if (candles.length < period * 2 + 1) return null;
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const up = candles[i]!.high - candles[i - 1]!.high;
    const down = candles[i - 1]!.low - candles[i]!.low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = candles[i - 1]!.close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const wilder = (arr: number[], p: number) => {
    let prev = arr.slice(0, p).reduce((a, b) => a + b, 0);
    const out = [prev];
    for (let i = p; i < arr.length; i += 1) {
      prev = prev - prev / p + arr[i]!;
      out.push(prev);
    }
    return out;
  };
  const trS = wilder(tr, period);
  const pS = wilder(plusDm, period);
  const mS = wilder(minusDm, period);
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i += 1) {
    const plusDi = trS[i]! > 0 ? (100 * pS[i]!) / trS[i]! : 0;
    const minusDi = trS[i]! > 0 ? (100 * mS[i]!) / trS[i]! : 0;
    const den = plusDi + minusDi;
    dx.push(den > 0 ? (100 * Math.abs(plusDi - minusDi)) / den : 0);
  }
  const adxVal = sma(dx, period);
  if (adxVal == null) return null;
  const last = trS.length - 1;
  return {
    adx: adxVal,
    plusDi: trS[last]! > 0 ? (100 * pS[last]!) / trS[last]! : 0,
    minusDi: trS[last]! > 0 ? (100 * mS[last]!) / trS[last]! : 0,
  };
}

export function donchian(
  candles: Array<{ high: number; low: number }>,
  period = 20,
): { high: number; low: number; mid: number } | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  return { high, low, mid: (high + low) / 2 };
}

export function hv(closes: number[], period = 20, periodsPerYear = 252): number | null {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i += 1) {
    if (slice[i - 1]! > 0 && slice[i]! > 0) rets.push(Math.log(slice[i]! / slice[i - 1]!));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(Math.max(variance, 0) * periodsPerYear);
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { mid: number; upper: number; lower: number; pctB: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const last = closes[closes.length - 1]!;
  const width = upper - lower;
  return { mid, upper, lower, pctB: width > 0 ? (last - lower) / width : 0.5 };
}

function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp((-x * x) / 2);
  return 0.5 * (1 + sign * y);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function blackScholesPrice(
  spot: number,
  strike: number,
  tYears: number,
  vol: number,
  kind: "CE" | "PE",
  rate = 0.065,
): number {
  if (!(tYears > 0) || !(vol > 0)) return Math.max(kind === "CE" ? spot - strike : strike - spot, 0);
  const srt = vol * Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * tYears) / srt;
  const d2 = d1 - srt;
  const df = Math.exp(-rate * tYears);
  if (kind === "CE") return spot * normCdf(d1) - strike * df * normCdf(d2);
  return strike * df * normCdf(-d2) - spot * normCdf(-d1);
}

export function blackScholesIv(
  premium: number,
  spot: number,
  strike: number,
  tYears: number,
  kind: "CE" | "PE",
  rate = 0.065,
): number | null {
  if (!(premium > 0) || !(spot > 0) || !(strike > 0) || !(tYears > 0)) return null;
  const intrinsic = Math.max(kind === "CE" ? spot - strike : strike - spot, 0);
  if (premium + 1e-6 < intrinsic * 0.98) return null;
  let sigma = 0.25;
  for (let i = 0; i < 40; i += 1) {
    const price = blackScholesPrice(spot, strike, tYears, sigma, kind, rate);
    const srt = Math.max(sigma * Math.sqrt(tYears), 1e-8);
    const d1 = (Math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * tYears) / srt;
    const vega = spot * normPdf(d1) * Math.sqrt(tYears);
    if (vega < 1e-8) break;
    const next = sigma - (price - premium) / vega;
    if (!Number.isFinite(next)) break;
    if (next <= 0.01) {
      sigma = Math.max(0.02, sigma * 0.5);
      continue;
    }
    if (Math.abs(next - sigma) < 1e-4) return next;
    sigma = Math.min(3, next);
  }
  return Number.isFinite(sigma) && sigma > 0 ? sigma : null;
}

export function ivRank(current: number, history: number[]): number | null {
  if (!history.length || !Number.isFinite(current)) return null;
  const below = history.filter((value) => value <= current).length;
  return below / history.length;
}

export function chandelierStop(
  highs: number[],
  atrValue: number,
  mult = 2,
  side: "long" | "short" = "long",
  lows?: number[],
): number | null {
  if (!highs.length || !(atrValue > 0)) return null;
  if (side === "long") return Math.max(...highs) - mult * atrValue;
  return Math.min(...(lows ?? highs)) + mult * atrValue;
}

export type Regime = "STRONG_BULLISH" | "BULLISH" | "RANGE" | "BEARISH" | "STRONG_BEARISH" | "HIGH_VOLATILITY" | "UNKNOWN";

export function classifyRegime(close: number[], atrValue: number | null): Regime {
  if (close.length < 20) return "UNKNOWN";
  const eFast = ema(close, 9);
  const eSlow = ema(close, 21);
  if (eFast == null || eSlow == null) return "UNKNOWN";
  const last = close[close.length - 1]!;
  const vol = atrValue != null ? atrValue / last : 0;
  if (vol > 0.03) return "HIGH_VOLATILITY";
  const slope = eFast - eSlow;
  if (slope / last > 0.008) return "STRONG_BULLISH";
  if (slope > 0) return "BULLISH";
  if (slope / last < -0.008) return "STRONG_BEARISH";
  if (slope < 0) return "BEARISH";
  return "RANGE";
}
