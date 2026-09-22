import { money, type ForecastBias, type MarketRegime } from "@xtrader/domain";
import { adx, atr, centralPivotRange, classifyRegime, ema, macd, rsi, sessionVwap, sma, supertrend, volumeAverage } from "../indicators/index.js";
import { sessionLevels, structureLevels } from "./levels.js";

export type Bar = { time?: number; open?: number; high: number; low: number; close: number; volume?: number };

export type DeskSignal = { name: string; vote: -1 | 0 | 1; weight: number; detail: string };

export type DeskModel = {
  bias: ForecastBias;
  regime: MarketRegime;
  score: number;
  confidence: number;
  pull: number;
  atr: number;
  vwap: number | null;
  cpr: ReturnType<typeof centralPivotRange> | null;
  orb: { high: number; low: number } | null;
  adx: { adx: number; plusDi: number; minusDi: number } | null;
  volumeOrb: boolean;
  supports: string[];
  resistances: string[];
  magnet: number;
  session: ReturnType<typeof sessionLevels>;
  signals: DeskSignal[];
  summary: string;
};

const WEIGHTS = {
  cpr: 0.18,
  dailyTrend: 0.16,
  intraTrend: 0.12,
  supertrend: 0.12,
  rsi: 0.08,
  macd: 0.08,
  orb: 0.1,
  vwap: 0.1,
  news: 0.06,
} as const;

export function buildDeskModel(input: {
  last: number;
  daily: Bar[];
  fifteen?: Bar[];
  five?: Bar[];
  newsScore?: number;
}): DeskModel {
  const last = input.last || input.daily.at(-1)?.close || 1;
  const daily = input.daily;
  const fifteen = input.fifteen ?? [];
  const five = input.five ?? [];
  const newsScore = input.newsScore ?? 0;
  const dailyCloses = daily.map((b) => b.close);
  const atrVal = atr(daily, 14) ?? atr(five, 14) ?? last * 0.012;
  const structure = structureLevels({ last, atr: atrVal, candles: daily.length >= 8 ? daily : five });
  const prior = daily.length >= 2 ? daily[daily.length - 2]! : daily[daily.length - 1];
  const cpr = prior ? centralPivotRange(prior) : null;
  const vwap = sessionMean(five, last);
  const orb = openingRange(five);
  const sma20 = sma(dailyCloses, 20);
  const sma50 = sma(dailyCloses, Math.min(50, dailyCloses.length));
  const ema9d = ema(dailyCloses, 9);
  const ema21d = ema(dailyCloses, 21);
  const intraCloses = (fifteen.length >= 20 ? fifteen : five).map((b) => b.close);
  const ema9i = ema(intraCloses, 9);
  const ema21i = ema(intraCloses, 21);
  const rsiD = rsi(dailyCloses, 14);
  const rsiI = rsi(intraCloses, 14) ?? rsiD;
  const macdD = macd(dailyCloses);
  const trend = supertrend(daily.length >= 12 ? daily : five);
  const adxVal = adx(daily.length >= 30 ? daily : five, 14);
  const regime = classifyRegime(dailyCloses, atrVal) as MarketRegime;

  const signals: DeskSignal[] = [];
  if (cpr) {
    const vote: -1 | 0 | 1 = last > cpr.tc ? 1 : last < cpr.bc ? -1 : 0;
    signals.push({
      name: "CPR",
      vote,
      weight: WEIGHTS.cpr,
      detail: vote > 0 ? "above TC" : vote < 0 ? "below BC" : "inside CPR",
    });
  }
  if (ema9d != null && ema21d != null) {
    const stacked = sma20 != null && sma50 != null && sma20 >= sma50;
    const vote: -1 | 0 | 1 = last > ema9d && ema9d >= ema21d ? 1 : last < ema9d && ema9d <= ema21d ? -1 : 0;
    signals.push({
      name: "DAILY EMA",
      vote: vote === 1 && stacked ? 1 : vote,
      weight: WEIGHTS.dailyTrend,
      detail: `9/21 ${ema9d >= ema21d ? "up" : "down"}`,
    });
  }
  if (ema9i != null && ema21i != null) {
    const vote: -1 | 0 | 1 = last > ema9i && ema9i >= ema21i ? 1 : last < ema9i && ema9i <= ema21i ? -1 : 0;
    signals.push({ name: "INTRADAY EMA", vote, weight: WEIGHTS.intraTrend, detail: "9/21 tape" });
  }
  if (trend) {
    signals.push({
      name: "SUPERTREND",
      vote: trend.side,
      weight: WEIGHTS.supertrend,
      detail: trend.side > 0 ? "green" : "red",
    });
  }
  if (rsiI != null) {
    const vote: -1 | 0 | 1 = rsiI >= 58 ? 1 : rsiI <= 42 ? -1 : 0;
    signals.push({ name: "RSI", vote, weight: WEIGHTS.rsi, detail: rsiI.toFixed(1) });
  }
  if (macdD) {
    const vote: -1 | 0 | 1 = macdD.hist > 0 && macdD.line > 0 ? 1 : macdD.hist < 0 && macdD.line < 0 ? -1 : 0;
    signals.push({ name: "MACD", vote, weight: WEIGHTS.macd, detail: macdD.hist > 0 ? "hist+" : "hist-" });
  }
  const lastBar = five.at(-1) ?? daily.at(-1);
  const sessionVols = five.filter((b) => (b.volume ?? 0) > 0).map((b) => b.volume ?? 0);
  const volMean = volumeAverage(sessionVols, Math.min(20, sessionVols.length));
  const volumeOrb = Boolean(lastBar && volMean && (lastBar.volume ?? 0) > volMean * 1.2);
  if (orb) {
    const broke = last > orb.high || last < orb.low;
    const vote: -1 | 0 | 1 = !broke ? 0 : !volumeOrb ? 0 : last > orb.high ? 1 : -1;
    signals.push({
      name: "ORB",
      vote,
      weight: WEIGHTS.orb,
      detail: !broke ? "inside 9:15-9:30" : volumeOrb ? "broke range on volume" : "broke but thin volume",
    });
  }
  if (adxVal) {
    const vote: -1 | 0 | 1 = adxVal.adx < 20 ? 0 : adxVal.plusDi > adxVal.minusDi ? 1 : -1;
    signals.push({ name: "ADX", vote, weight: 0.08, detail: `ADX ${adxVal.adx.toFixed(0)}` });
  }
  if (vwap != null) {
    const band = Math.max(atrVal * 0.08, last * 0.0006);
    const vote: -1 | 0 | 1 = last > vwap + band ? 1 : last < vwap - band ? -1 : 0;
    signals.push({ name: "VWAP", vote, weight: WEIGHTS.vwap, detail: last >= vwap ? "above" : "below" });
  }
  if (newsScore !== 0) {
    const vote: -1 | 0 | 1 = newsScore > 0.2 ? 1 : newsScore < -0.2 ? -1 : 0;
    signals.push({ name: "NEWS", vote, weight: WEIGHTS.news, detail: newsScore.toFixed(2) });
  }

  const used = signals.reduce((sum, s) => sum + s.weight, 0) || 1;
  const score = signals.reduce((sum, s) => sum + s.vote * s.weight, 0) / used;
  const bias: ForecastBias = score > 0.16 ? "BULLISH" : score < -0.16 ? "BEARISH" : "RANGE";
  const historyBonus = daily.length >= 40 ? 0.08 : daily.length >= 20 ? 0.04 : 0;
  const alignBonus = Math.abs(score) > 0.35 ? 0.06 : 0;
  const confidence = Math.max(0.22, Math.min(0.88, 0.38 + Math.abs(score) * 0.42 + historyBonus + alignBonus));
  const pull = Math.max(0.22, Math.min(0.78, 0.5 + score * 0.24));

  const extra = [
    cpr?.s2,
    cpr?.s1,
    cpr?.bc,
    cpr?.pivot,
    cpr?.tc,
    cpr?.r1,
    cpr?.r2,
    vwap,
    orb?.low,
    orb?.high,
    prior ? prior.low + (prior.high - prior.low) * 0.382 : null,
    prior ? prior.low + (prior.high - prior.low) * 0.618 : null,
  ].filter((n): n is number => n != null && Number.isFinite(n));
  const supports = uniqueSorted(
    [...structure.supports.map(Number), ...extra.filter((n) => n < last)],
    last,
    "below",
  ).slice(-4);
  const resistances = uniqueSorted(
    [...structure.resistances.map(Number), ...extra.filter((n) => n > last)],
    last,
    "above",
  ).slice(0, 4);
  const magnet =
    (bias === "BULLISH" ? resistances[0] : bias === "BEARISH" ? supports[supports.length - 1] : null) ??
    vwap ??
    cpr?.pivot ??
    structure.magnet;
  const session = sessionLevels(prior?.close || last, atrVal, magnet);
  const summary = `${bias} ${regime.replaceAll("_", " ")} · score ${(score * 100).toFixed(0)} · ${signals
    .filter((s) => s.vote !== 0)
    .map((s) => `${s.name} ${s.vote > 0 ? "+" : "-"}`)
    .join(" ") || "flat tape"}`;

  return {
    bias,
    regime,
    score,
    confidence,
    pull,
    atr: atrVal,
    vwap,
    cpr,
    orb,
    adx: adxVal,
    volumeOrb,
    supports: supports.map((n) => money(n, 2)),
    resistances: resistances.map((n) => money(n, 2)),
    magnet,
    session,
    signals,
    summary,
  };
}

function sessionMean(five: Bar[], last: number): number | null {
  const today = istDate(Date.now() / 1000);
  const session = five.filter((b) => (b.time ? istDate(b.time) === today : true) && (b.volume ?? 0) >= 0);
  const withVol = session.filter((b) => (b.volume ?? 0) > 0);
  if (withVol.length >= 3) return sessionVwap(withVol.map((b) => ({ high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })));
  if (session.length < 3) return null;
  const typical = session.reduce((sum, b) => sum + (b.high + b.low + b.close) / 3, 0) / session.length;
  return Number.isFinite(typical) && typical > 0 ? typical : last;
}

export function openingRange(five: Bar[]): { high: number; low: number } | null {
  const today = istDate(Date.now() / 1000);
  const bars = five.filter((b) => {
    if (b.time == null) return false;
    if (istDate(b.time) !== today) return false;
    const mins = istMinutes(b.time);
    return mins >= 9 * 60 + 15 && mins < 9 * 60 + 30;
  });
  if (bars.length < 2) return null;
  return {
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
  };
}

function uniqueSorted(values: number[], last: number, side: "below" | "above"): number[] {
  const tol = Math.max(last * 0.0007, 2);
  const sorted = [...values].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (side === "below" && value >= last) continue;
    if (side === "above" && value <= last) continue;
    if (out.some((n) => Math.abs(n - value) <= tol)) continue;
    out.push(value);
  }
  return out;
}

export function istDate(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(unixSec * 1000),
  );
}

export function istMinutes(unixSec: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(unixSec * 1000));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
