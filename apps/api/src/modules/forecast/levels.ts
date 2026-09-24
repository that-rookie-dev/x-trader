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
  horizon?: "SWING" | "POSITION" | "INTRADAY";
  rsVsNifty?: number | null;
  atrStop?: string | null;
  rank?: number | null;
};

function inDeliveryWindow(symbol: string, expiry: string | null): boolean {
  if (!expiry || isIndexUnderlying(symbol)) return false;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const days = (new Date(`${expiry}T15:30:00+05:30`).getTime() - new Date(`${today}T12:00:00+05:30`).getTime()) / 86400000;
  return days <= 6;
}

function isoDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
  derivativeExchange?: string | null;
}): Idea[] {
  const fnoExchange = input.derivativeExchange || "NFO";
  const cashExchange = spotRefForUnderlying(input.symbol).exchange;
  const deliveryWeek = inDeliveryWindow(input.symbol, input.expiry);
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
  const above200 = input.sma200 != null && input.last > input.sma200;
  const atrStop = input.stopUnder ?? money(input.last * 0.975, 2);
  const atrTarget = money(input.last + (input.last - Number(atrStop)) * 1.2, 2);
  const blocked = (input.bias === "BEARISH" || news < -0.4) && input.sma200 != null && input.last < input.sma200;

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
  } else if (blocked) {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: input.last < (input.sma200 ?? input.last) ? "SELL" : "AVOID",
      contract: input.symbol,
      exchange: "NSE",
      why: "Strong downtrend / below SMA200. No new cash BUY — see Stocks desk for ranked sells.",
      until: null,
      stop: atrStop,
      atrStop,
      horizon: "SWING",
    });
  } else if (above200 && input.bias === "BULLISH" && input.confidence >= 0.55 && news >= -0.4) {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "BUY",
      contract: input.symbol,
      exchange: "NSE",
      why: `Swing candidate above SMA200. Ranked list with 12-1 / RS vs Nifty lives on Stocks. Stop ${atrStop}, first target ${atrTarget}.`,
      until: isoDays(21),
      primary: !ideas.some((i) => i.primary),
      stop: atrStop,
      target: atrTarget,
      atrStop,
      horizon: "SWING",
      exit: `Invalidation: close through ${atrStop}.`,
    });
  } else if (above200 && input.bias !== "BEARISH") {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "HOLD",
      contract: input.symbol,
      exchange: "NSE",
      why: "Above SMA200. Keep an existing holding; fresh adds go through the Stocks swing ranker.",
      until: isoDays(60),
      stop: atrStop,
      atrStop,
      horizon: "POSITION",
      exit: `Sell if weekly close loses SMA200 or ${atrStop}.`,
    });
  } else {
    ideas.push({
      lane: "CASH",
      kind: "EQ",
      action: "WAIT",
      contract: input.symbol,
      exchange: "NSE",
      why: "No swing edge here yet. Open Stocks for the 12-1 / RS / ATR ranked book.",
      until: null,
      horizon: "SWING",
    });
  }
  return ideas.map((idea) => {
    if (idea.lane === "FNO" && deliveryWeek && idea.action === "BUY") {
      return {
        ...idea,
        exchange: fnoExchange,
        action: "WAIT" as const,
        primary: false,
        why: "Physical delivery week on this stock. Do not open. Square off an existing ITM option or future before expiry.",
      };
    }
    if (idea.lane === "FNO") return { ...idea, exchange: fnoExchange };
    return { ...idea, exchange: cashExchange };
  });
}
