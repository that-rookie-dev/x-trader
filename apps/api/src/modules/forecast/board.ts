import { money, type ForecastBias, type Play } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import type { MarketDataService } from "../market/service.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { JournalService } from "../journal/service.js";
import type { ForecastEngine } from "./engine.js";
import { friendlyDate, loadHeldKeys, markContract, paperHeldSymbols, stanceLine, visibleIdeas } from "./desk.js";
import { compareEod, eodTradeView, nearestStrike, predictEodSpot, viewAiStudy } from "./eod.js";
import { buyNetFloor, maxPain, putCallRatio, sessionClock } from "./chain-tape.js";
import type { SignalStore } from "./signals.js";
import type { PlayDraft, PlayStore } from "./plays.js";
import { holdUntilAt, trailNote } from "./plays.js";
import { adxAgainstKind, snapshotVol, volWhy } from "./vol.js";
import { adx, atr } from "../indicators/index.js";

export type BoardDeps = {
  db: Database;
  market: MarketDataService;
  forecasts: ForecastEngine;
  gate: LiveGate;
  read: ZerodhaReadAdapter;
  journal: JournalService;
  signals: SignalStore;
  plays: PlayStore;
};

export async function buildOptionsBoard(
  s: BoardDeps,
  input: { exchange: string; symbol: string; expiry: string | null },
) {
  const { exchange, symbol } = input;
  const stored = await s.forecasts.getStored(exchange, symbol);
  const forecast = await s.forecasts.refreshOne(exchange, symbol, stored ? "live" : "full", input.expiry);
  const spot = Number(forecast.lastPrice);
  const chain = await s.market.listOptionChain(symbol, input.expiry ?? forecast.derivatives?.expiry ?? null, spot);
  const held = await loadHeldKeys(s.db, s.read);
  const paperHeld = await paperHeldSymbols(s.db);
  const quoteItems = [
    { exchange, symbol },
    ...(chain.future ? [{ exchange: chain.future.exchange, symbol: chain.future.tradingsymbol }] : []),
    ...chain.rows.flatMap((row) => [
      row.ce ? { exchange: row.ce.exchange, symbol: row.ce.tradingsymbol } : null,
      row.pe ? { exchange: row.pe.exchange, symbol: row.pe.tradingsymbol } : null,
    ]),
  ].filter((item): item is { exchange: string; symbol: string } => Boolean(item));
  const quotes = await s.market.quoteMany(quoteItems);
  const qmap = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));
  const settings = await s.gate.snapshot();
  const ideas = forecast.suggestions ?? [];
  const liveSpot = Number(qmap.get(`${exchange}:${symbol}`)?.lastPrice ?? forecast.lastPrice);
  const sessionLive = {
    last: liveSpot,
    expectedLow: Number(forecast.session.expectedLow),
    expectedHigh: Number(forecast.session.expectedHigh),
    magnet: Number(forecast.session.magnet),
  };
  const supports = (forecast.path.supports ?? []).map(Number);
  const resistances = (forecast.path.resistances ?? []).map(Number);
  const eod = predictEodSpot({
    last: liveSpot,
    bias: forecast.bias,
    expectedLow: sessionLive.expectedLow,
    expectedHigh: sessionLive.expectedHigh,
    magnet: sessionLive.magnet,
    supports,
    resistances,
    pull: forecast.session.pull,
  });
  const ai = viewAiStudy(forecast.evidence.aiStudy, sessionLive);
  const eodSpot = Number(eod.close);
  const clock = sessionClock(new Date(), chain.expiry);
  const lossStreak = await s.journal.paperLossStreak(symbol);
  const setupKind = forecast.bias === "BEARISH" ? "PE" : "CE";
  const expectancy = await s.journal.expectancy("FNO", forecast.regime, setupKind);
  const netFloor = buyNetFloor(clock, lossStreak, expectancy);
  const daily = await s.market.listCandles(exchange, symbol, 1440, 80);
  const atmRow = chain.rows.find((row) => row.atm) ?? chain.rows[Math.floor(chain.rows.length / 2)];
  const atmCall = atmRow?.ce ? qmap.get(`${atmRow.ce.exchange}:${atmRow.ce.tradingsymbol}`) : null;
  const atmPut = atmRow?.pe ? qmap.get(`${atmRow.pe.exchange}:${atmRow.pe.tradingsymbol}`) : null;
  const vol = await snapshotVol(s.db, {
    symbol,
    spot: liveSpot,
    strike: chain.atm,
    expiry: chain.expiry,
    callMid: atmCall?.lastPrice != null ? Number(atmCall.lastPrice) : null,
    putMid: atmPut?.lastPrice != null ? Number(atmPut.lastPrice) : null,
    dailyCloses: daily.map((c) => c.close),
  });
  const adxSnap = adx(daily, 14);
  const callOi = chain.rows.reduce((sum, row) => {
    const q = row.ce ? qmap.get(`${row.ce.exchange}:${row.ce.tradingsymbol}`) : null;
    return sum + (q?.oi ?? 0);
  }, 0);
  const putOi = chain.rows.reduce((sum, row) => {
    const q = row.pe ? qmap.get(`${row.pe.exchange}:${row.pe.tradingsymbol}`) : null;
    return sum + (q?.oi ?? 0);
  }, 0);
  const pcr = putCallRatio(callOi, putOi);
  const pain = maxPain(
    chain.rows.map((row) => ({
      strike: row.strike,
      ceOi: (row.ce ? qmap.get(`${row.ce.exchange}:${row.ce.tradingsymbol}`)?.oi : null) ?? 0,
      peOi: (row.pe ? qmap.get(`${row.pe.exchange}:${row.pe.tradingsymbol}`)?.oi : null) ?? 0,
    })),
  );
  const side = (
    leg: { tradingsymbol: string; lotSize: number; exchange: string } | null,
    kind: "CE" | "PE",
    strike: number,
  ) => {
    if (!leg) return null;
    const q = qmap.get(`${leg.exchange}:${leg.tradingsymbol}`);
    const marked = markContract(ideas, held, paperHeld, leg.tradingsymbol, kind);
    const premium = q?.lastPrice != null ? Number(q.lastPrice) : null;
    const view = eodTradeView({
      kind,
      strike,
      spot: liveSpot,
      eodSpot,
      premium,
      expiry: chain.expiry,
      lotSize: leg.lotSize || 1,
      held: marked.mark === "SELL" || paperHeld.has(leg.tradingsymbol.toUpperCase()),
      existing: marked.mark,
      bias: forecast.bias,
      expectedLow: sessionLive.expectedLow,
      expectedHigh: sessionLive.expectedHigh,
      oi: q?.oi,
      volume: q?.volume,
      bid: q?.bid,
      ask: q?.ask,
      netFloor,
      cutoff: clock.cutoff,
      richIv: vol.rich,
      adxAgainst: adxAgainstKind(adxSnap, kind),
    });
    return {
      symbol: leg.tradingsymbol,
      exchange: leg.exchange,
      lastPrice: q?.lastPrice ?? null,
      prevPrice: q?.prevPrice ?? null,
      change: q?.change ?? null,
      oi: q?.oi ?? null,
      volume: q?.volume ?? null,
      mark: view.mark,
      why: view.why,
      canPaper: view.mark === "BUY" || (view.mark === "SELL" && paperHeld.has(leg.tradingsymbol.toUpperCase())),
      lotSize: view.lotSize,
      eodPremium: view.eodPremium,
      moneyness: view.moneyness,
      pnl: view.pnl,
    };
  };
  const rows = chain.rows.map((row) => ({
    strike: row.strike,
    atm: row.atm,
    ce: side(row.ce, "CE", row.strike),
    pe: side(row.pe, "PE", row.strike),
  }));
  const future = chain.future
    ? {
        symbol: chain.future.tradingsymbol,
        exchange: chain.future.exchange,
        lastPrice: qmap.get(`${chain.future.exchange}:${chain.future.tradingsymbol}`)?.lastPrice ?? null,
        ...markContract(ideas, held, paperHeld, chain.future.tradingsymbol, "FUT"),
      }
    : null;
  const ranked = rows
    .flatMap((row) => [
      row.ce ? { kind: "CE" as const, strike: row.strike, leg: row.ce } : null,
      row.pe ? { kind: "PE" as const, strike: row.strike, leg: row.pe } : null,
    ])
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const roi = (leg: { pnl: { net: string; buyNotional: string } }) => {
    const cost = Number(leg.pnl.buyNotional);
    return cost > 0 ? Number(leg.pnl.net) / cost : 0;
  };
  const buys = ranked
    .filter((item) => item.leg.mark === "BUY")
    .sort((a, b) => {
      const byRoi = roi(b.leg) - roi(a.leg);
      if (Math.abs(byRoi) > 0.01) return byRoi;
      return Math.abs(a.strike - liveSpot) - Math.abs(b.strike - liveSpot);
    })
    .slice(0, 4)
    .map((item) => ({
      lane: "FNO" as const,
      kind: item.kind,
      action: "BUY" as const,
      contract: item.leg.symbol,
      exchange: item.leg.exchange,
      label: item.kind,
      title: `Buy ${item.kind} ${item.strike}`,
      why: item.leg.why,
      when: `Hold to EOD if spot stays near ${eod.close}.`,
      premium: item.leg.lastPrice,
      instrumentType: "OPTION" as const,
      canPaper: item.leg.canPaper,
      lastPrice: item.leg.lastPrice ?? undefined,
    }));
  const sells = visibleIdeas(ideas, held, paperHeld, "FNO").filter((idea) => idea.action === "SELL");
  const listed = rows.map((row) => row.strike);
  const aiPick = ai
    ? ai.direction === "BEARISH"
      ? { kind: "PE" as const, strike: nearestStrike(listed, ai.peStrike) }
      : ai.direction === "BULLISH"
        ? { kind: "CE" as const, strike: nearestStrike(listed, ai.ceStrike) }
        : null
    : null;
  const compare = ai != null ? compareEod(Number(eod.close), Number(ai.close), forecast.bias, ai.direction as ForecastBias) : null;
  const desk = forecast.evidence.desk;
  void s.market.ensureHistoryPublic(exchange, symbol).catch(() => undefined);
  void s.signals
    .diffAndPersist(
      symbol,
      chain.expiry,
      ranked.map((item) => ({
        contract: item.leg.symbol,
        kind: item.kind,
        strike: item.strike,
        mark: item.leg.mark,
        why: item.leg.why,
        spot: liveSpot,
        premium: item.leg.lastPrice != null ? Number(item.leg.lastPrice) : null,
        net: item.leg.pnl ? Number(item.leg.pnl.net) : null,
      })),
    )
    .catch(() => undefined);
  const trail = trailNote(daily.map((c) => c.high), atr(daily, 14), setupKind === "PE" ? "PE" : "CE");
  const volLines = volWhy(vol);
  const drafts: PlayDraft[] = ranked
    .filter((item) => item.leg.mark === "BUY")
    .map((item) => ({
      lane: "FNO" as const,
      side: item.kind,
      contract: item.leg.symbol,
      exchange: item.leg.exchange ?? "NFO",
      underlying: symbol,
      expiry: chain.expiry,
      entryZone: item.leg.lastPrice ?? "market",
      stop: money(liveSpot * (item.kind === "CE" ? 0.992 : 1.008), 2),
      targets: [eod.close],
      holdUntil: holdUntilAt(chain.expiry ? "expiry" : "session", chain.expiry),
      invalidation: forecast.session.invalidation,
      edgeAfterCost: item.leg.pnl?.net ?? null,
      confidence: forecast.confidence,
      regime: forecast.regime,
      why: [item.leg.why, ...volLines, expectancy?.note ?? "", trail ?? ""].filter(Boolean),
      eodSpot: eod.close,
      eodPremium: item.leg.eodPremium ?? null,
      pcr,
      ivRank: vol.ivRank,
      thetaNote: clock.expiryToday ? "Theta burns fast on expiry. Square off by 13:30 if new, 15:15 if filled." : "Time stop 15:15 IST.",
      horizon: "EXPIRY",
      setupKey: `FNO:${item.kind}:${forecast.regime}`,
      expectancyNote: expectancy?.note || null,
    }));
  let boardPlays: Play[] = [];
  try {
    await s.plays.upsertFromDrafts(drafts);
    boardPlays = await s.plays.list({ underlying: symbol, expiry: chain.expiry, limit: 12 });
  } catch {
    boardPlays = [];
  }
  return {
    symbol,
    exchange,
    expiry: chain.expiry,
    expiryLabel: friendlyDate(chain.expiry),
    lastPrice: qmap.get(`${exchange}:${symbol}`)?.lastPrice ?? forecast.lastPrice,
    change: qmap.get(`${exchange}:${symbol}`)?.change ?? null,
    atm: chain.atm,
    trust: Math.round(forecast.confidence * 100),
    stance: stanceLine(forecast.bias),
    bias: forecast.bias,
    eod,
    levels: {
      supports: forecast.path.supports ?? [],
      resistances: forecast.path.resistances ?? [],
      magnet: forecast.session.magnet,
    },
    session: {
      expectedLow: forecast.session.expectedLow,
      expectedHigh: forecast.session.expectedHigh,
      magnet: forecast.session.magnet,
      pull: forecast.session.pull,
      invalidation: forecast.session.invalidation,
    },
    desk: {
      votes: desk?.votes ?? [],
      vwap: desk?.vwap ?? null,
      orbHigh: desk?.orbHigh ?? null,
      orbLow: desk?.orbLow ?? null,
      pcr,
      maxPain: pain,
      clock: clock.label,
      ivRank: vol.ivRank,
      ivAtm: vol.ivAtm,
      hv20: vol.hv20,
      adx: adxSnap?.adx ?? null,
    },
    ai,
    aiError: forecast.evidence.aiError ?? null,
    compare,
    aiPick,
    future,
    rows,
    buys,
    sells,
    plays: boardPlays,
    paperMode: settings.executionMode === "PAPER",
  };
}
