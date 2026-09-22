import type { ForecastBias } from "@xtrader/domain";
import type { AgentMark } from "./desk.js";

export type SessionClock = {
  cutoff: boolean;
  netFloor: number;
  label: string;
  expiryToday: boolean;
};

export function istMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function sessionClock(now: Date, expiry: string | null): SessionClock {
  const mins = istMinutes(now);
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryToday = Boolean(expiry && expiry <= today);
  const cutoff = expiryToday ? mins >= 13 * 60 + 30 : mins >= 15 * 60;
  const late = mins >= 14 * 60 + 30;
  return {
    cutoff,
    netFloor: cutoff ? 150 : late ? 250 : 150,
    label: cutoff ? "CUTOFF" : expiryToday ? "UNTIL 13:30" : "UNTIL 15:00",
    expiryToday,
  };
}

export function mapInvalidated(bias: ForecastBias, last: number, expectedLow: number, expectedHigh: number): boolean {
  if (!(last > 0)) return false;
  if (bias === "BULLISH" && expectedLow > 0 && last < expectedLow * 0.998) return true;
  if (bias === "BEARISH" && expectedHigh > 0 && last > expectedHigh * 1.002) return true;
  return false;
}

export function liquidEnough(oi?: number | null, volume?: number | null, bid?: number | null, ask?: number | null): boolean {
  if (oi == null && volume == null && bid == null && ask == null) return true;
  const hasTape = (oi != null && oi > 0) || (volume != null && volume > 0);
  if (!hasTape) return false;
  if (bid != null && ask != null && bid > 0 && ask > bid) {
    const mid = (bid + ask) / 2;
    if (mid > 0 && (ask - bid) / mid > 0.25) return false;
  }
  return true;
}

export function putCallRatio(callOi: number, putOi: number): number | null {
  if (!(callOi > 0) && !(putOi > 0)) return null;
  if (!(callOi > 0)) return 99;
  return Number((putOi / callOi).toFixed(2));
}

export function maxPain(rows: Array<{ strike: number; ceOi: number; peOi: number }>): number | null {
  if (rows.length === 0) return null;
  let best = rows[0]!.strike;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const settle of rows) {
    let cost = 0;
    for (const row of rows) {
      cost += row.ceOi * Math.max(settle.strike - row.strike, 0);
      cost += row.peOi * Math.max(row.strike - settle.strike, 0);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = settle.strike;
    }
  }
  return best;
}

export function buyNetFloor(
  clock: SessionClock,
  lossStreak: boolean,
  expectancy?: { samples: number; value: number } | null,
): number {
  return clock.netFloor + (lossStreak ? 100 : 0) + (expectancy && expectancy.samples >= 10 && expectancy.value < 0 ? 80 : 0);
}

export function notableMarkChange(fromMark: string | null | undefined, toMark: AgentMark): boolean {
  const hot = (mark: string) => mark === "BUY" || mark === "SELL";
  if (fromMark == null || fromMark === "IDLE") return hot(toMark);
  return fromMark !== toMark && (hot(fromMark) || hot(toMark));
}
