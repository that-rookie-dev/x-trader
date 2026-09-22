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
