import { money, type ForecastBias } from "@xtrader/domain";

export function sessionLevels(last: number, atr: number, magnet?: number) {
  const band = Math.max(atr * 0.8, last * 0.004);
  return {
    expectedLow: money(last - band, 2),
    expectedHigh: money(last + band, 2),
    magnet: money(magnet ?? last, 2),
    invalidation: `A close through ${money(last - band * 1.5, 2)} against the bias invalidates the session map.`,
  };
}

export function pathLevels(last: number, atr: number) {
  const step = Math.max(atr, last * 0.008);
  return {
    supports: [money(last - step, 2), money(last - step * 1.7, 2)],
    resistances: [money(last + step, 2), money(last + step * 1.7, 2)],
  };
}

export type StructureMap = {
  supports: string[];
  resistances: string[];
  magnet: number;
  pivot: number | null;
  priorHigh: number | null;
  priorLow: number | null;
  priorClose: number | null;
};

export function structureLevels(input: {
  last: number;
  atr: number;
  candles: Array<{ high: number; low: number; close: number }>;
}): StructureMap {
  const last = input.last || 1;
  const atr = input.atr || last * 0.012;
  const bars = input.candles.filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  const prior = bars.length >= 2 ? bars[bars.length - 2]! : bars[bars.length - 1];
  const raw: number[] = [];
  let pivot: number | null = null;
  let priorHigh: number | null = null;
  let priorLow: number | null = null;
  let priorClose: number | null = null;
  if (prior) {
    priorHigh = prior.high;
    priorLow = prior.low;
    priorClose = prior.close;
    pivot = (prior.high + prior.low + prior.close) / 3;
    raw.push(prior.high, prior.low, prior.close, pivot, 2 * pivot - prior.low, 2 * pivot - prior.high, pivot + (prior.high - prior.low), pivot - (prior.high - prior.low));
  }
  const window = bars.slice(-24);
  for (let i = 1; i < window.length - 1; i += 1) {
    const prev = window[i - 1]!;
    const row = window[i]!;
    const next = window[i + 1]!;
    if (row.high >= prev.high && row.high >= next.high) raw.push(row.high);
    if (row.low <= prev.low && row.low <= next.low) raw.push(row.low);
  }
  const step = last >= 20000 ? 50 : last >= 1000 ? 10 : 1;
  raw.push(Math.round(last / step) * step);
  raw.push(Math.round(last / (step * 2)) * (step * 2));
  const fallback = pathLevels(last, atr);
  for (const value of [...fallback.supports, ...fallback.resistances]) raw.push(Number(value));
  const merged = uniqueLevels(raw, last);
  const supports = merged.filter((n) => n < last).slice(-3).map((n) => money(n, 2));
  const resistances = merged.filter((n) => n > last).slice(0, 3).map((n) => money(n, 2));
  const magnet = nearestLevel(
    [pivot, priorClose, ...merged].filter((n): n is number => n != null && Number.isFinite(n)),
    last,
  );
  return {
    supports,
    resistances,
    magnet,
    pivot,
    priorHigh,
    priorLow,
    priorClose,
  };
}

function uniqueLevels(values: number[], last: number): number[] {
  const tol = Math.max(last * 0.0008, 2);
  const sorted = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const prev = out[out.length - 1];
    if (prev != null && Math.abs(prev - value) <= tol) continue;
    out.push(value);
  }
  return out;
}

function nearestLevel(values: number[], last: number): number {
  if (!values.length) return last;
  return values.reduce((best, value) => (Math.abs(value - last) < Math.abs(best - last) ? value : best), values[0]!);
}

export function biasFromTrend(
  last: number,
  sma20: number | null,
  sma50: number | null,
  rsiVal: number | null,
): ForecastBias {
  if (sma20 == null) return "RANGE";
  if (sma50 != null && last > sma20 && sma20 >= sma50 && (rsiVal == null || rsiVal >= 52)) return "BULLISH";
  if (sma50 != null && last < sma20 && sma20 <= sma50 && (rsiVal == null || rsiVal <= 48)) return "BEARISH";
  if (last > sma20 * 1.008) return "BULLISH";
  if (last < sma20 * 0.992) return "BEARISH";
  return "RANGE";
}

export function confidenceFrom(input: {
  bias: ForecastBias;
  newsScore: number;
  rsi: number | null;
  historyBars: number;
}): number {
  let c = 0.42;
  if (input.historyBars >= 40) c += 0.12;
  else if (input.historyBars >= 20) c += 0.06;
  if (input.bias !== "RANGE") c += 0.12;
  if (input.rsi != null && input.rsi > 35 && input.rsi < 70) c += 0.08;
  const news = input.newsScore;
  if ((input.bias === "BULLISH" && news > 0.15) || (input.bias === "BEARISH" && news < -0.15)) c += 0.12;
  else if ((input.bias === "BULLISH" && news < -0.25) || (input.bias === "BEARISH" && news > 0.25)) c -= 0.1;
  return Math.max(0.2, Math.min(0.86, Number(c.toFixed(2))));
}

export type FnoKind = "INDEX" | "EQ";

export type FnoUnderlying = {
  fno: string;
  exchange: string;
  symbol: string;
  label: string;
  kind: FnoKind;
  nextExpiry?: string | null;
};

const INDEX_SPOT: Record<string, { exchange: string; symbol: string; label: string; aliases: string[] }> = {
  NIFTY: { exchange: "NSE", symbol: "NIFTY 50", label: "NIFTY 50", aliases: ["NIFTY 50"] },
  BANKNIFTY: { exchange: "NSE", symbol: "NIFTY BANK", label: "BANK NIFTY", aliases: ["NIFTY BANK"] },
  FINNIFTY: { exchange: "NSE", symbol: "NIFTY FIN SERVICE", label: "FIN NIFTY", aliases: ["NIFTY FIN SERVICE"] },
  MIDCPNIFTY: { exchange: "NSE", symbol: "NIFTY MID SELECT", label: "MIDCAP NIFTY", aliases: ["NIFTY MID SELECT"] },
  NIFTYNXT50: {
    exchange: "NSE",
    symbol: "NIFTY NXT 50",
    label: "NIFTY NEXT 50",
    aliases: ["NIFTY NXT 50", "NIFTY NEXT 50"],
  },
  SENSEX: { exchange: "BSE", symbol: "SENSEX", label: "SENSEX", aliases: ["SENSEX"] },
  BANKEX: { exchange: "BSE", symbol: "BANKEX", label: "BANKEX", aliases: ["BANKEX"] },
};

export const INDEX_FNO_ORDER = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"] as const;

export function underlyingFnoName(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s === "NIFTY 50" || s === "NIFTY50" || s === "NIFTY") return "NIFTY";
  if (s.includes("BANKNIFTY") || s === "NIFTY BANK") return "BANKNIFTY";
  if (s.includes("FINNIFTY") || s === "NIFTY FIN SERVICE") return "FINNIFTY";
  if (s.includes("MIDCPNIFTY") || s === "NIFTY MID SELECT") return "MIDCPNIFTY";
  if (s.includes("NIFTYNXT") || s === "NIFTY NXT 50" || s === "NIFTY NEXT 50") return "NIFTYNXT50";
  if (s === "SENSEX") return "SENSEX";
  if (s === "BANKEX") return "BANKEX";
  return s.replace(/\s+/g, "");
}

export function spotRefForUnderlying(symbol: string): FnoUnderlying {
  const fno = underlyingFnoName(symbol);
  const index = INDEX_SPOT[fno];
  if (index) return { fno, exchange: index.exchange, symbol: index.symbol, label: index.label, kind: "INDEX" };
  return { fno, exchange: "NSE", symbol: fno, label: fno, kind: "EQ" };
}

export function isIndexUnderlying(symbol: string): boolean {
  return spotRefForUnderlying(symbol).kind === "INDEX";
}

export function collectFnoNames(
  rows: Array<{ name: string; instrumentType: string; expiry: string | null }>,
  today: string,
  cashKeys?: Set<string>,
): FnoUnderlying[] {
  const live = new Set<string>();
  const soonest = new Map<string, string>();
  for (const row of rows) {
    if (!row.name || !row.expiry || row.expiry < today) continue;
    if (row.instrumentType !== "CE" && row.instrumentType !== "PE") continue;
    live.add(row.name);
    const prev = soonest.get(row.name);
    if (!prev || row.expiry < prev) soonest.set(row.name, row.expiry);
  }
  const names = [...live].map((fno) => {
    const ref = spotRefForUnderlying(fno);
    const nextExpiry = soonest.get(fno) ?? null;
    if (ref.kind === "INDEX") {
      const aliases = INDEX_SPOT[fno]?.aliases ?? [ref.symbol];
      const hit = cashKeys ? aliases.find((alias) => cashKeys.has(`${ref.exchange}:${alias}`)) : undefined;
      if (hit) return { ...ref, symbol: hit, nextExpiry };
    }
    return { ...ref, nextExpiry };
  });
  names.sort((a, b) => {
    const ai = INDEX_FNO_ORDER.indexOf(a.fno as (typeof INDEX_FNO_ORDER)[number]);
    const bi = INDEX_FNO_ORDER.indexOf(b.fno as (typeof INDEX_FNO_ORDER)[number]);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.label.localeCompare(b.label);
  });
  return names;
}

export function pickExpiringDesk(names: FnoUnderlying[], today: string): FnoUnderlying | undefined {
  const indexes = names.filter((n) => n.kind === "INDEX");
  const pool = indexes.length ? indexes : names;
  const todayHit = pool.find((n) => n.nextExpiry === today);
  if (todayHit) return todayHit;
  let soonest: FnoUnderlying | undefined;
  for (const name of pool) {
    if (!name.nextExpiry) continue;
    if (!soonest?.nextExpiry || name.nextExpiry < soonest.nextExpiry) soonest = name;
  }
  return soonest ?? pool[0] ?? names[0];
}

export function periodReturn(closes: number[], bars: number): number | null {
  if (closes.length < bars + 1) return null;
  const prev = closes[closes.length - 1 - bars]!;
  const last = closes[closes.length - 1]!;
  if (prev <= 0) return null;
  return (last - prev) / prev;
}

export type Idea = {
  lane: "FNO" | "CASH";
  kind: "CE" | "PE" | "FUT" | "EQ";
  action: "BUY" | "SELL" | "HOLD" | "SKIP" | "WAIT" | "AVOID";
  contract: string;
  exchange: string;
  why: string;
  until: string | null;
  premium?: string | null;
  primary?: boolean;
  exit?: string | null;
  stop?: string | null;
  target?: string | null;
};

function isoDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function optionExits(premium: string | null | undefined, kind: "CE" | "PE", symbol: string, stopUnder: string) {
  const px = Number(premium);
  const has = Number.isFinite(px) && px > 0;
  const target = has ? money(px * 1.4, 2) : null;
  const stop = has ? money(px * 0.65, 2) : null;
  const exit = `Sell the ${kind} if ${symbol} closes below ${stopUnder}, or premium hits ${target ?? "+40%"} / ${stop ?? "−35%"}, or by 15:15 IST / expiry.`;
  return { exit, stop, target };
}

export function buildSuggestions(input: {
  symbol: string;
  instrumentType: "EQUITY" | "INDEX" | "FUTURE" | "OPTION";
  bias: ForecastBias;
  confidence: number;
  last: number;
  sma20: number | null;
  sma50: number | null;
  sma200?: number | null;
  rsi?: number | null;
  newsScore?: number;
  ret6m?: number | null;
  ret12m?: number | null;
  liveBreak?: "UP" | "DOWN" | null;
  stopUnder?: string | null;
  future: string | null;
  call: string | null;
  put: string | null;
  expiry: string | null;
  callPx?: string | null;
  putPx?: string | null;
}): Idea[] {
  const ideas: Idea[] = [];
  const expiry = input.expiry;
  const rsiVal = input.rsi ?? null;
  const stopUnder = input.stopUnder ?? money(input.last * 0.988, 2);
  const takeProfitCe = rsiVal != null && rsiVal >= 72;
  const takeProfitPe = rsiVal != null && rsiVal <= 28;
  const sellCe = input.bias !== "BULLISH" || takeProfitCe || input.liveBreak === "DOWN";
  const sellPe = input.bias !== "BEARISH" || takeProfitPe || input.liveBreak === "UP";

  if (input.bias === "BULLISH") {
    if (input.call) {
      const exits = optionExits(input.callPx, "CE", input.symbol, stopUnder);
      ideas.push({
        lane: "FNO",
        kind: "CE",
        action: sellCe && (takeProfitCe || input.liveBreak === "DOWN") ? "SELL" : "BUY",
        contract: input.call,
        exchange: "NFO",
        why:
          takeProfitCe || input.liveBreak === "DOWN"
            ? takeProfitCe
              ? `Live tape is extended (RSI ${rsiVal?.toFixed(0)}). Book the call — do not add.`
              : `Live price broke the session low. Exit the call.`
            : `Bullish live + daily map. Buy the ATM call. ${exits.exit}`,
        until: expiry,
        premium: input.callPx ?? null,
        primary: !(takeProfitCe || input.liveBreak === "DOWN"),
        ...exits,
      });
    }
    if (input.put) {
      ideas.push({
        lane: "FNO",
        kind: "PE",
        action: "SKIP",
        contract: input.put,
        exchange: "NFO",
        why: "Do not buy puts against a bullish map.",
        until: expiry,
        premium: input.putPx ?? null,
      });
    }
    if (input.future) {
      ideas.push({
        lane: "FNO",
        kind: "FUT",
        action: input.confidence >= 0.7 && !takeProfitCe ? "BUY" : "WAIT",
        contract: input.future,
        exchange: "NFO",
        why: input.confidence >= 0.7 ? "High-confidence future long as an alternative to the call." : "Future is optional until confidence is higher.",
        until: expiry,
      });
    }
  } else if (input.bias === "BEARISH") {
    if (input.put) {
      const exits = optionExits(input.putPx, "PE", input.symbol, stopUnder);
      ideas.push({
        lane: "FNO",
        kind: "PE",
        action: sellPe && (takeProfitPe || input.liveBreak === "UP") ? "SELL" : "BUY",
        contract: input.put,
        exchange: "NFO",
        why:
          takeProfitPe || input.liveBreak === "UP"
            ? takeProfitPe
              ? `Live tape is washed out (RSI ${rsiVal?.toFixed(0)}). Book the put — do not add.`
              : `Live price broke the session high. Exit the put.`
            : `Bearish live + daily map. Buy the ATM put. ${exits.exit}`,
        until: expiry,
        premium: input.putPx ?? null,
        primary: !(takeProfitPe || input.liveBreak === "UP"),
        ...exits,
      });
    }
    if (input.call) {
      ideas.push({
        lane: "FNO",
        kind: "CE",
        action: "SKIP",
        contract: input.call,
        exchange: "NFO",
        why: "Do not buy calls against a bearish map.",
        until: expiry,
        premium: input.callPx ?? null,
      });
    }
    if (input.future) {
      ideas.push({
        lane: "FNO",
        kind: "FUT",
        action: "SKIP",
        contract: input.future,
        exchange: "NFO",
        why: "No short futures in this build. Use the put instead.",
        until: expiry,
      });
    }
  } else {
    const wait = input.call ?? input.put ?? input.future;
    if (wait) {
      ideas.push({
        lane: "FNO",
        kind: input.call ? "CE" : input.put ? "PE" : "FUT",
        action: "WAIT",
        contract: wait,
        exchange: "NFO",
        why: "Range. Wait for a live break of the session band before picking CE or PE.",
        until: expiry,
      });
    }
  }

  const news = input.newsScore ?? 0;
  const above50 = input.sma50 != null && input.last > input.sma50;
  const above200 = input.sma200 != null && input.last > input.sma200;
  const stacked =
    input.sma50 != null && input.sma200 != null && input.sma50 >= input.sma200 * 0.98 && above50 && above200;
  const growth = (input.ret6m != null && input.ret6m > 0.04) || (input.ret12m != null && input.ret12m > 0.08);
  const retNote = [
    input.ret6m != null ? `6m ${pct(input.ret6m)}` : null,
    input.ret12m != null ? `1y ${pct(input.ret12m)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (input.instrumentType === "INDEX") {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "WAIT",
      contract: input.symbol,
      exchange: "NSE",
      why: "Index is context. Trade the future/options above, not the cash index.",
      until: null,
    });
  } else if (stacked && news > -0.25 && (growth || input.ret6m == null)) {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "BUY",
      contract: input.symbol,
      exchange: "NSE",
      why: `Long-term growth: price holds SMA50/200${retNote ? ` (${retNote})` : ""}. Add as a core holding, not a day trade.`,
      until: isoDays(365),
      primary: !ideas.some((i) => i.primary),
      exit: `Trim if weekly close loses SMA200. Re-check on the next study.`,
    });
  } else if (input.bias === "BULLISH" && input.sma20 != null && input.last > input.sma20 && input.confidence >= 0.58) {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "BUY",
      contract: input.symbol,
      exchange: "NSE",
      why: above200
        ? `Daily trend is up and price is above SMA200${retNote ? ` (${retNote})` : ""}. Candidate for a long-term add.`
        : "History is still building a 200-day base. Treat as a long-term watch that is working, not a positional core yet.",
      until: isoDays(above200 ? 280 : 120),
      primary: !ideas.some((i) => i.primary),
      exit: "Sell only if the daily map flips bearish and price loses SMA50.",
    });
  } else if (above200 && input.bias !== "BEARISH") {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "HOLD",
      contract: input.symbol,
      exchange: "NSE",
      why: `Above SMA200. Keep an existing long-term holding; do not chase a fresh add this cycle.`,
      until: isoDays(180),
      exit: "Sell if price closes below SMA200 on a weekly bar.",
    });
  } else if (input.bias === "BEARISH") {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: input.sma200 != null && input.last < input.sma200 ? "SELL" : "AVOID",
      contract: input.symbol,
      exchange: "NSE",
      why:
        input.sma200 != null && input.last < input.sma200
          ? "Below SMA200 on a weak daily map. Do not hold a long-term cash position here."
          : "Weak daily map. Do not add a long-term cash holding here.",
      until: null,
    });
  } else {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "WAIT",
      contract: input.symbol,
      exchange: "NSE",
      why: "No long-term growth edge yet. Wait for price to reclaim SMA50 with history confirmation.",
      until: null,
    });
  }
  return ideas;
}
