import { money, type MarketRegime, type Play } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import type { MarketDataService } from "../market/service.js";
import type { ForecastEngine } from "./engine.js";
import type { StrategyEngine } from "../strategy/engine.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { JournalService } from "../journal/service.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import { atr, donchian, sma } from "../indicators/index.js";
import { loadHeldKeys, paperHeldSymbols, visibleIdeas, type PlainIdea } from "./desk.js";
import type { Idea } from "./levels.js";
import { holdUntilAt, type PlayDraft, type PlayStore } from "./plays.js";
import type { ExpectancySnap } from "../journal/service.js";

export type EquityScore = {
  symbol: string;
  exchange: string;
  last: number;
  action: "BUY" | "SELL" | "HOLD" | "WAIT" | "AVOID";
  horizon: "SWING" | "POSITION" | "INTRADAY";
  score: number;
  rank: number;
  momentum: number | null;
  rs20: number | null;
  rs60: number | null;
  rsVsNifty: number | null;
  above50: boolean;
  above200: boolean;
  donchianBreak: boolean;
  atr: number | null;
  stop: string | null;
  target: string | null;
  why: string;
  until: string | null;
};

export function momentum12_1(closes: number[]): number | null {
  if (closes.length < 253) return null;
  const now = closes[closes.length - 1]!;
  const y = closes[closes.length - 253]!;
  const m1 = closes[closes.length - 22]!;
  const m2 = closes[closes.length - 43]!;
  if (!(y > 0) || !(m2 > 0)) return null;
  return now / y - m1 / m2;
}

export function periodRet(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - days]!;
  if (!(then > 0)) return null;
  return now / then - 1;
}

export function relativeStrength(stock: number[], bench: number[], days: number): number | null {
  const a = periodRet(stock, days);
  const b = periodRet(bench, days);
  if (a == null || b == null) return null;
  return a - b;
}

export function scoreEquity(input: {
  symbol: string;
  exchange: string;
  last: number;
  daily: Array<{ high: number; low: number; close: number }>;
  niftyCloses: number[];
  newsScore?: number;
  regime?: MarketRegime;
  expectancy?: ExpectancySnap | null;
}): EquityScore {
  const closes = input.daily.map((c) => c.close);
  const last = input.last || closes[closes.length - 1] || 0;
  const sma50 = sma(closes, Math.min(50, closes.length));
  const sma200 = sma(closes, 200);
  const atrVal = atr(input.daily, 14);
  const don = donchian(input.daily, 20);
  const mom = momentum12_1(closes);
  const rs20 = relativeStrength(closes, input.niftyCloses, 20);
  const rs60 = relativeStrength(closes, input.niftyCloses, 60);
  const rs = rs20 != null && rs60 != null ? (rs20 + rs60) / 2 : (rs20 ?? rs60);
  const above50 = sma50 != null && last > sma50;
  const above200 = sma200 != null && last > sma200;
  const donchianBreak = Boolean(don && last >= don.high);
  const news = input.newsScore ?? 0;
  const regime = input.regime ?? "UNKNOWN";
  const factors = [
    mom != null ? Math.max(-1, Math.min(1, mom * 2)) : 0,
    rs != null ? Math.max(-1, Math.min(1, rs * 4)) : 0,
    above200 ? 0.8 : above50 ? 0.35 : -0.4,
    donchianBreak ? 0.35 : 0,
  ];
  if (news !== 0) factors.push(news < -0.4 ? -0.8 : news * 0.4);
  let score = factors.reduce((a, b) => a + b, 0) / factors.length;
  if (regime === "STRONG_BEARISH" || regime === "BEARISH") score -= 0.12;
  if (regime === "STRONG_BULLISH") score += 0.08;
  if (input.expectancy && input.expectancy.samples >= 10 && input.expectancy.value < 0) score -= 0.15;
  const stop = atrVal != null && last > 0 ? money(last - 2.5 * atrVal, 2) : null;
  const target = atrVal != null && last > 0 ? money(last + 3 * atrVal, 2) : null;
  const blockedDowntrend = (regime === "STRONG_BEARISH" || regime === "BEARISH") && sma200 != null && last < sma200;
  let action: EquityScore["action"] = "WAIT";
  let horizon: EquityScore["horizon"] = above200 ? "POSITION" : "SWING";
  if (blockedDowntrend) {
    action = "AVOID";
  } else if (score >= 0.18 && news >= -0.4 && (above50 || donchianBreak)) {
    action = "BUY";
  } else if (sma200 != null && last < sma200 && (regime === "BEARISH" || regime === "STRONG_BEARISH" || score < -0.15)) {
    action = "SELL";
  } else if (above200) {
    action = "HOLD";
  }
  const whyBits = [
    mom != null ? `12-1 ${(mom * 100).toFixed(1)}` : null,
    rs != null ? `RS vs Nifty ${(rs * 100).toFixed(3)}%` : null,
    above200 ? "above SMA200" : above50 ? "above SMA50" : "below SMAs",
    donchianBreak ? "Donchian 20 break" : null,
    stop && target ? `stop ${stop} / tgt ${target}` : null,
    input.expectancy && input.expectancy.samples >= 5
      ? `setup ${input.expectancy.wins}/${input.expectancy.samples}`
      : null,
  ].filter(Boolean);
  return {
    symbol: input.symbol,
    exchange: input.exchange,
    last,
    action,
    horizon,
    score,
    rank: 0,
    momentum: mom,
    rs20,
    rs60,
    rsVsNifty: rs,
    above50,
    above200,
    donchianBreak,
    atr: atrVal,
    stop,
    target,
    why: whyBits.join(" · ") || "Not enough history to rank.",
    until: action === "BUY" ? holdUntilAt(horizon === "POSITION" ? "position" : "swing").toISOString().slice(0, 10) : null,
  };
}

export function rankEquities(rows: EquityScore[]): EquityScore[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function equityToIdea(row: EquityScore): Idea {
  return {
    lane: "CASH",
    kind: "EQ",
    action: row.action,
    contract: row.symbol,
    exchange: row.exchange,
    why: row.why,
    until: row.until,
    stop: row.stop,
    target: row.target,
    primary: row.action === "BUY",
    horizon: row.horizon,
    rsVsNifty: row.rsVsNifty,
    atrStop: row.stop,
    rank: row.rank,
  };
}

export type StocksDesk = {
  buys: PlainIdea[];
  sells: PlainIdea[];
  today: PlainIdea[];
  plays: Play[];
};

export async function buildStocksDesk(s: {
  db: Database;
  market: MarketDataService;
  forecasts: ForecastEngine;
  strategy: StrategyEngine;
  gate: LiveGate;
  journal: JournalService;
  read: ZerodhaReadAdapter;
  plays?: PlayStore;
  research?: { read(exchange: string, symbol: string): Promise<{ score: number } | null> };
}): Promise<StocksDesk> {
  const watch = await s.market.listWatchlist();
  const nifty = await s.market.listCandles("NSE", "NIFTY 50", 1440, 260);
  const niftyCloses = nifty.map((c) => c.close);
  const held = await loadHeldKeys(s.db, s.read);
  const paperHeld = await paperHeldSymbols(s.db);
  const memory = await s.journal.expectancyMap();
  const regimes = new Map<string, MarketRegime>();
  const scored: EquityScore[] = [];
  for (const item of watch) {
    if (!item.orderable || item.symbol === "NIFTY 50") continue;
    const daily = await s.market.listCandles(item.exchange, item.symbol, 1440, 260);
    const stored = await s.forecasts.getStored(item.exchange, item.symbol);
    const last = Number(item.lastPrice ?? stored?.lastPrice ?? daily.at(-1)?.close ?? 0);
    const regime = stored?.regime ?? "UNKNOWN";
    regimes.set(item.symbol, regime);
    const key = `CASH:EQ:${regime}`;
    scored.push(
      scoreEquity({
        symbol: item.symbol,
        exchange: item.exchange,
        last,
        daily,
        niftyCloses,
        newsScore: s.research ? ((await s.research.read(item.exchange, item.symbol))?.score ?? 0) : 0,
        regime,
        expectancy: memory.get(key) ?? memory.get("CASH:EQ") ?? null,
      }),
    );
  }
  const ranked = rankEquities(scored);
  const ideas = ranked.map(equityToIdea);
  const buys = visibleIdeas(ideas, held, paperHeld, "CASH")
    .filter((idea) => idea.action === "BUY")
    .map((idea) => attachScore(idea, ranked, paperHeld));
  const sells = visibleIdeas(ideas, held, paperHeld, "CASH")
    .filter((idea) => idea.action === "SELL")
    .map((idea) => attachScore(idea, ranked, paperHeld));
  const today: PlainIdea[] = [];
  for (const item of watch.filter((w) => w.orderable && w.symbol !== "NIFTY 50")) {
    const ev = await s.strategy.evaluate(item.exchange, item.symbol);
    if (ev.decision !== "TRADE" || !("entryPrice" in ev) || !ev.entryPrice) continue;
    today.push({
      lane: "CASH",
      kind: "EQ",
      action: "BUY",
      contract: item.symbol,
      exchange: item.exchange,
      label: "TODAY",
      title: "Intraday breakout",
      why: ev.thesis ?? "5m volume breakout with EMA/VWAP trend.",
      when: "Same session. Square off by 15:15 IST.",
      stop: ev.stopLoss ?? null,
      target: ev.targets?.[0] ?? null,
      instrumentType: "EQUITY",
      canPaper: !paperHeld.has(item.symbol.toUpperCase()),
      lastPrice: String(ev.entryPrice),
      horizon: "INTRADAY",
      atrStop: ev.stopLoss ?? null,
    });
  }
  const drafts: PlayDraft[] = [...buys, ...today].map((idea) => {
    const row = ranked.find((r) => r.symbol === idea.contract);
    const regime = regimes.get(idea.contract) ?? "UNKNOWN";
    const horizon = idea.horizon === "INTRADAY" ? "INTRADAY" : idea.horizon === "POSITION" ? "POSITION" : "SWING";
    const holdKind = horizon === "INTRADAY" ? "intraday" : horizon === "POSITION" ? "position" : "swing";
    const snap = memory.get(`CASH:EQ:${regime}`) ?? memory.get("CASH:EQ") ?? null;
    return {
      lane: "CASH" as const,
      side: "EQ" as const,
      contract: idea.contract,
      exchange: idea.exchange,
      underlying: idea.contract,
      expiry: null,
      entryZone: idea.lastPrice ?? "market",
      stop: idea.stop ?? idea.atrStop ?? "atr",
      targets: idea.target ? [idea.target] : [],
      holdUntil: holdUntilAt(holdKind),
      invalidation: idea.stop ? `Spot through ${idea.stop}` : "Thesis broken",
      edgeAfterCost: null,
      confidence: Math.min(0.9, Math.max(0.35, 0.5 + (row?.score ?? 0))),
      regime,
      why: [idea.why, snap?.note ?? ""].filter(Boolean),
      horizon,
      rsVsNifty: idea.rsVsNifty ?? null,
      atrStop: idea.atrStop ?? idea.stop ?? null,
      rank: idea.rank ?? null,
      setupKey: `CASH:EQ:${regime}`,
      expectancyNote: snap?.note || null,
    };
  });
  let boardPlays: Play[] = [];
  if (s.plays && drafts.length) {
    try {
      await s.plays.upsertFromDrafts(drafts);
      boardPlays = (await s.plays.list({ limit: 24 })).filter((p) => p.lane === "CASH").slice(0, 8);
    } catch {
      boardPlays = [];
    }
  }
  return { buys, sells, today, plays: boardPlays };
}

function attachScore(idea: PlainIdea, ranked: EquityScore[], paperHeld: Set<string>): PlainIdea {
  const row = ranked.find((r) => r.symbol === idea.contract);
  if (!row) return { ...idea, canPaper: idea.action === "BUY" && !paperHeld.has(idea.contract.toUpperCase()) };
  return {
    ...idea,
    title: row.horizon === "POSITION" ? "Positional add" : "Swing add",
    label: row.horizon,
    when: row.until ? `Hold into ${row.until}.` : idea.when,
    stop: row.stop,
    target: row.target,
    horizon: row.horizon,
    rsVsNifty: row.rsVsNifty,
    atrStop: row.stop,
    rank: row.rank,
    lastPrice: money(row.last, 2),
    canPaper: idea.action === "BUY" && !paperHeld.has(idea.contract.toUpperCase()),
  };
}
