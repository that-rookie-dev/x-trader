import { clientOptionPnl, clientOptionPnlShort } from "./charges";
import type { AgentMark, ChainLeg, OptionsBoard, QuoteTick } from "./desk";

type Bias = "BULLISH" | "BEARISH" | "RANGE";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [i, f = ""] = String(Math.abs(n)).replace(/,/g, "").split(".");
  return `${sign}${i || "0"}.${f.slice(0, 2).padEnd(2, "0")}`;
}

function asBias(value: string | undefined): Bias {
  return value === "BULLISH" || value === "BEARISH" ? value : "RANGE";
}

function pickMagnet(input: {
  last: number;
  bias: Bias;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  supports: number[];
  resistances: number[];
}): number {
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const pad = Math.max(high - low, input.last * 0.002) * 0.2;
  const inBand = (n: number) => Number.isFinite(n) && n >= low - pad && n <= high + pad;
  const supports = input.supports.filter(inBand);
  const resistances = input.resistances.filter(inBand);
  const nearest = (values: number[], from: number) =>
    values.reduce((best, value) => (Math.abs(value - from) < Math.abs(best - from) ? value : best), values[0] ?? from);
  if (input.bias === "BULLISH") {
    const above = resistances.filter((n) => n >= input.last).sort((a, b) => a - b);
    if (above[0] != null) return above[0];
  }
  if (input.bias === "BEARISH") {
    const below = supports.filter((n) => n <= input.last).sort((a, b) => b - a);
    if (below[0] != null) return below[0];
  }
  return nearest([input.magnet || input.last, ...supports, ...resistances], input.last);
}

function predictEod(input: {
  last: number;
  bias: Bias;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  supports: number[];
  resistances: number[];
  pull?: number;
}) {
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const span = Math.max(high - low, input.last * 0.002);
  const pull =
    input.pull != null && Number.isFinite(input.pull)
      ? Math.min(0.82, Math.max(0.18, input.pull))
      : input.bias === "BULLISH"
        ? 0.68
        : input.bias === "BEARISH"
          ? 0.32
          : 0.5;
  const sessionTarget = low + span * pull;
  const magnet = pickMagnet(input);
  const close = sessionTarget * 0.45 + magnet * 0.35 + input.last * 0.2;
  return { close: money(close), low: money(low), high: money(high), note: input.bias === "BULLISH" ? `Helper expects a close toward resistance ${money(magnet)}.` : input.bias === "BEARISH" ? `Helper expects a close toward support ${money(magnet)}.` : `Helper expects a close near magnet ${money(magnet)}.` };
}

function clampAi(input: { last: number; expectedLow: number; expectedHigh: number; closeHint: number; direction: Bias; pull?: number }) {
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const span = Math.max(high - low, input.last * 0.002);
  const fromPull = input.pull != null ? low + span * Math.min(1, Math.max(0, input.pull)) : input.closeHint;
  const raw = Number.isFinite(input.closeHint) ? input.closeHint : fromPull;
  const close = Math.min(high + span * 0.15, Math.max(low - span * 0.15, raw));
  return { close: money(close), low: money(low), high: money(high) };
}

function estimateOptionEod(input: { kind: "CE" | "PE"; strike: number; spot: number; eodSpot: number; premium: number | null; expiry: string | null }) {
  const intrinsicNow = input.kind === "CE" ? Math.max(input.spot - input.strike, 0) : Math.max(input.strike - input.spot, 0);
  const intrinsicEod = input.kind === "CE" ? Math.max(input.eodSpot - input.strike, 0) : Math.max(input.strike - input.eodSpot, 0);
  const premium = input.premium != null && input.premium > 0 ? input.premium : Math.max(intrinsicNow, 0.05);
  const timeValue = Math.max(premium - intrinsicNow, 0);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const remain = input.expiry && input.expiry <= today ? 0.08 : 0.55;
  const eodPremium = Math.max(intrinsicEod + timeValue * remain, 0.05);
  const dist = Math.abs(input.eodSpot - input.strike);
  const atmBand = Math.max(input.eodSpot * 0.002, 1);
  const eodMoneyness: "ITM" | "ATM" | "OTM" = dist <= atmBand ? "ATM" : intrinsicEod > 0 ? "ITM" : "OTM";
  return { eodPremium: money(eodPremium), eodMoneyness };
}

function spotMoneyness(kind: "CE" | "PE", strike: number, spot: number): "ITM" | "ATM" | "OTM" {
  const band = Math.max(spot * 0.0015, 1);
  if (Math.abs(spot - strike) <= band) return "ATM";
  if (kind === "CE") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

function isCheapSide(kind: "CE" | "PE", strike: number, spot: number) {
  return kind === "PE" ? strike <= spot : strike >= spot;
}

function isInPlay(kind: "CE" | "PE", strike: number, spot: number, eodSpot: number) {
  const pad = Math.max(spot * 0.0025, 50);
  return kind === "PE" ? strike <= spot && strike >= eodSpot - pad : strike >= spot && strike <= eodSpot + pad;
}

function tradeDirection(spot: number, eodSpot: number): "PE" | "CE" | null {
  const dead = Math.max(spot * 0.0006, 8);
  if (eodSpot <= spot - dead) return "PE";
  if (eodSpot >= spot + dead) return "CE";
  return null;
}

function compareEod(algoClose: number, aiClose: number, algoBias: Bias, aiBias: Bias) {
  const mid = (Math.abs(algoClose) + Math.abs(aiClose)) / 2 || 1;
  const delta = aiClose - algoClose;
  const rel = Math.abs(delta) / mid;
  const same = algoBias === aiBias;
  const tag = same
    ? rel <= 0.0015
      ? "ALIGNED"
      : rel <= 0.004
        ? "LEAN"
        : "STRETCH"
    : rel <= 0.004
      ? "MIXED"
      : "OPPOSED";
  const gapPct = (() => {
    const [i, f = ""] = String(Math.abs(rel * 100)).split(".");
    return `${i || "0"}.${f.slice(0, 2).padEnd(2, "0")}`;
  })();
  const gap = `${gapPct}% apart`;
  const hint =
    tag === "ALIGNED"
      ? `same direction · ${gap}`
      : tag === "LEAN"
        ? `same direction · small gap · ${gap}`
        : tag === "STRETCH"
          ? `same direction · wider targets · ${gap}`
          : tag === "MIXED"
            ? `different direction · closes near · ${gap}`
            : `different direction · ${gap}`;
  return { agree: same || rel <= 0.0015, delta: money(delta), tag, hint };
}

function fnoKey(exchange: string | undefined, symbol: string) {
  return `${exchange ?? "NFO"}:${symbol}`;
}

function istMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

function sessionClock(now: Date, expiry: string | null) {
  const mins = istMinutes(now);
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryToday = Boolean(expiry && expiry <= today);
  const openMin = 9 * 60 + 15;
  const closeSoonMin = 15 * 60 + 15;
  const closeMin = 15 * 60 + 30;
  const closed = mins >= closeMin || mins < openMin;
  const closingSoon = !closed && mins >= closeSoonMin;
  const late = mins >= 14 * 60 + 30;
  return {
    cutoff: closed,
    closingSoon,
    netFloor: closed ? 150 : late ? 250 : 150,
    label: closed ? (mins >= closeMin ? "CLOSED" : "PRE-OPEN") : closingSoon ? "LAST 15M" : "UNTIL 15:30",
  };
}

function mapInvalidated(bias: Bias, last: number, expectedLow: number, expectedHigh: number) {
  if (bias === "BULLISH" && expectedLow > 0 && last < expectedLow * 0.998) return true;
  if (bias === "BEARISH" && expectedHigh > 0 && last > expectedHigh * 1.002) return true;
  return false;
}

function liquidEnough(oi?: number | null, volume?: number | null) {
  if (oi == null && volume == null) return true;
  return (oi != null && oi > 0) || (volume != null && volume > 0);
}

function repriceLeg(
  leg: ChainLeg,
  kind: "CE" | "PE",
  strike: number,
  spot: number,
  eodSpot: number,
  expiry: string | null,
  gates: { cutoff: boolean; netFloor: number; invalidated: boolean },
): ChainLeg {
  const premium = leg.lastPrice != null ? Number(leg.lastPrice) : null;
  const est = estimateOptionEod({ kind, strike, spot, eodSpot, premium, expiry });
  const entry = premium != null && premium > 0 ? premium : Number(est.eodPremium);
  const exit = Number(est.eodPremium);
  const qty = Math.max(1, leg.lotSize ?? 1);
  const pnl = clientOptionPnl({ entry, exit, qty });
  const shortPnl = clientOptionPnlShort({ entry, exit, qty });
  const net = Number(pnl.net);
  const shortNet = Number(shortPnl.net);
  const want = tradeDirection(spot, eodSpot);
  const cheap = isCheapSide(kind, strike, spot);
  const inPlay = isInPlay(kind, strike, spot, eodSpot);
  const liquid = liquidEnough(leg.oi, leg.volume);
  const sideNow = spotMoneyness(kind, strike, spot);
  const heldSide = leg.heldSide ?? null;
  let mark: AgentMark = "NO_BUY";
  let why = leg.why;
  if (heldSide === "LONG") {
    mark = "SELL";
    why = "You hold long — helper wants this closed (or edge faded).";
  } else if (heldSide === "SHORT") {
    if (net >= gates.netFloor || shortNet < gates.netFloor) {
      mark = "BUY";
      why = "You are short — cover (premium rising / write edge gone).";
    } else {
      mark = "WAIT";
      why = `Short working — keep write if premium fades to ~${money(exit)}.`;
    }
  } else if (!liquid) {
    why = "No tape / no OI — skip this weekly.";
    mark = "NO_BUY";
  } else if (gates.invalidated) {
    why = "Map invalidated — spot broke the session band against the bias.";
    mark = "NO_BUY";
  } else if (net >= gates.netFloor) {
    mark = "BUY";
    const bits = [`${sideNow} ${kind}`, `net ₹${pnl.net} if close ~${money(eodSpot)}`];
    if (want && want !== kind) bits.push(`against ${want} lean`);
    else if (want === kind) bits.push(`${want} lean`);
    else bits.push("flat tape");
    if (!cheap) bits.push("ITM premium");
    else if (!inPlay) bits.push("wide of EOD path");
    why = bits.join(" · ");
  } else if (shortNet >= gates.netFloor) {
    mark = "SELL";
    why = `WRITE ${sideNow} ${kind} · net ₹${shortPnl.net} if buy back ~${money(exit)}`;
  } else {
    mark = "NO_BUY";
    if (want && want !== kind) why = `Index leans ${want}. Buy net ₹${pnl.net} / write net ₹${shortPnl.net}.`;
    else why = "Expected EOD move does not cover charges.";
  }
  if (!heldSide && gates.cutoff) {
    why =
      mark === "BUY" || mark === "SELL"
        ? `CLOSED — market hours ended (would ${mark}: ${why})`
        : `CLOSED — market hours ended. ${why}`;
    mark = "CLOSED";
  }
  return {
    ...leg,
    eodPremium: est.eodPremium,
    moneyness: sideNow,
    eodMoneyness: est.eodMoneyness,
    pnl,
    shortPnl,
    mark,
    why,
    canPaper:
      !gates.cutoff &&
      ((mark === "BUY" && heldSide == null) ||
        (mark === "SELL" && heldSide == null) ||
        (heldSide === "LONG" && mark === "SELL") ||
        (heldSide === "SHORT" && mark === "BUY")),
    heldSide,
  };
}

function rebuildBuys(board: OptionsBoard, eodClose: string): OptionsBoard["buys"] {
  const liveSpot = Number(board.lastPrice);
  const eodSpot = Number(eodClose);
  const ranked = board.rows.flatMap((row) => [
    row.ce ? { kind: "CE" as const, strike: row.strike, leg: row.ce } : null,
    row.pe ? { kind: "PE" as const, strike: row.strike, leg: row.pe } : null,
  ]).filter((item): item is { kind: "CE" | "PE"; strike: number; leg: ChainLeg } => Boolean(item));
  const wantSide =
    eodSpot <= liveSpot - Math.max(liveSpot * 0.0006, 8) ? ("PE" as const) : eodSpot >= liveSpot + Math.max(liveSpot * 0.0006, 8) ? ("CE" as const) : null;
  const roi = (leg: ChainLeg) => {
    const cost = Number(leg.pnl?.buyNotional ?? 0);
    return cost > 0 ? Number(leg.pnl?.net ?? 0) / cost : 0;
  };
  const buyScore = (item: { kind: "CE" | "PE"; strike: number; leg: ChainLeg }) => {
    const r = roi(item.leg);
    const sideBoost = wantSide == null ? 0 : wantSide === item.kind ? 0.08 : -0.04;
    const near = 1 - Math.min(1, Math.abs(item.strike - liveSpot) / Math.max(liveSpot * 0.02, 1));
    const net = Number(item.leg.pnl?.net ?? 0);
    return r * 10 + sideBoost + near * 0.05 + Math.min(Math.max(net, 0), 5000) / 5000;
  };
  return ranked
    .filter((item) => item.leg.mark === "BUY")
    .sort((a, b) => buyScore(b) - buyScore(a))
    .slice(0, 12)
    .map((item) => ({
      lane: "FNO" as const,
      kind: item.kind,
      action: "BUY" as const,
      contract: item.leg.symbol,
      exchange: item.leg.exchange ?? "NFO",
      label: item.kind,
      title: `Buy ${item.kind} ${item.strike}`,
      why: item.leg.why,
      when: `Hold to EOD if spot stays near ${eodClose}.`,
      premium: item.leg.lastPrice,
      instrumentType: "OPTION" as const,
      canPaper: item.leg.canPaper,
      lastPrice: item.leg.lastPrice ?? undefined,
      edge: item.leg.pnl?.net ?? null,
    }));
}

function repriceBoard(board: OptionsBoard): OptionsBoard {
  const last = Number(board.lastPrice);
  if (!Number.isFinite(last) || last <= 0) return board;
  const bias = asBias(board.bias);
  const expectedLow = Number(board.session?.expectedLow ?? board.eod?.low ?? last);
  const expectedHigh = Number(board.session?.expectedHigh ?? board.eod?.high ?? last);
  const magnet = Number(board.session?.magnet ?? board.levels?.magnet ?? last);
  const supports = (board.levels?.supports ?? []).map(Number);
  const resistances = (board.levels?.resistances ?? []).map(Number);
  const eod = predictEod({
    last,
    bias,
    expectedLow,
    expectedHigh,
    magnet,
    supports,
    resistances,
    pull: board.session?.pull,
  });
  const eodSpot = Number(eod.close);
  const ai = board.ai
    ? {
        ...board.ai,
        ...clampAi({
          last,
          expectedLow,
          expectedHigh,
          closeHint: Number(board.ai.close),
          direction: asBias(board.ai.direction),
          pull: board.session?.pull,
        }),
      }
    : board.ai;
  const clock = sessionClock(new Date(), board.expiry);
  const gates = {
    cutoff: clock.cutoff,
    netFloor: clock.netFloor,
    invalidated: mapInvalidated(bias, last, expectedLow, expectedHigh),
  };
  const rows = board.rows.map((row) => ({
    ...row,
    ce: row.ce ? repriceLeg(row.ce, "CE", row.strike, last, eodSpot, board.expiry, gates) : null,
    pe: row.pe ? repriceLeg(row.pe, "PE", row.strike, last, eodSpot, board.expiry, gates) : null,
  }));
  const next: OptionsBoard = {
    ...board,
    eod: board.eod ? { ...board.eod, ...eod } : eod,
    ai,
    compare: ai ? compareEod(eodSpot, Number(ai.close), bias, asBias(ai.direction)) : board.compare,
    desk: board.desk ? { ...board.desk, clock: clock.label } : board.desk,
    rows,
  };
  next.buys = rebuildBuys(next, eod.close);
  return next;
}

export function quotesFromBoard(board: OptionsBoard): QuoteTick[] {
  const out: QuoteTick[] = [
    {
      exchange: board.exchange,
      symbol: board.symbol,
      lastPrice: board.lastPrice,
      prevPrice: null,
      change: board.change,
    },
  ];
  if (board.future?.lastPrice) {
    out.push({
      exchange: board.future.exchange ?? "NFO",
      symbol: board.future.symbol,
      lastPrice: board.future.lastPrice,
      prevPrice: null,
      change: null,
    });
  }
  for (const row of board.rows) {
    for (const leg of [row.ce, row.pe]) {
      if (!leg?.lastPrice) continue;
      out.push({
        exchange: leg.exchange ?? "NFO",
        symbol: leg.symbol,
        lastPrice: leg.lastPrice,
        prevPrice: leg.prevPrice,
        change: leg.change,
      });
    }
  }
  return out;
}

export function applyLiveQuotes(board: OptionsBoard, quotes: QuoteTick[]): OptionsBoard {
  if (!quotes.length) return board;
  const map = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));
  const patch = (leg: ChainLeg | null): ChainLeg | null => {
    if (!leg) return null;
    const q = map.get(fnoKey(leg.exchange, leg.symbol));
    if (!q?.lastPrice) return leg;
    return { ...leg, lastPrice: q.lastPrice, prevPrice: q.prevPrice, change: q.change, oi: q.oi ?? leg.oi, volume: q.volume ?? leg.volume };
  };
  const spot = map.get(`${board.exchange}:${board.symbol}`);
  const futureQ = board.future ? map.get(fnoKey(board.future.exchange, board.future.symbol)) : null;
  const priced: OptionsBoard = {
    ...board,
    lastPrice: spot?.lastPrice ?? board.lastPrice,
    change: spot?.change ?? board.change,
    future: board.future
      ? { ...board.future, lastPrice: futureQ?.lastPrice ?? board.future.lastPrice }
      : null,
    rows: board.rows.map((row) => ({ ...row, ce: patch(row.ce), pe: patch(row.pe) })),
  };
  return repriceBoard(priced);
}

export type LiveCandle = { time: number; open: number; high: number; low: number; close: number };

export function applyTickCandle(candles: LiveCandle[], price: number, atMs: number, intervalMin = 5): LiveCandle[] {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(atMs)) return candles;
  const bucket = Math.floor(atMs / 1000 / (intervalMin * 60)) * (intervalMin * 60);
  const last = candles[candles.length - 1];
  if (last && last.time === bucket) {
    if (last.close === price && last.high >= price && last.low <= price) return candles;
    return [
      ...candles.slice(0, -1),
      {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      },
    ];
  }
  if (last && last.time > bucket) return candles;
  return [...candles, { time: bucket, open: price, high: price, low: price, close: price }];
}

export function mergeCandles(local: LiveCandle[], remote: LiveCandle[]): LiveCandle[] {
  if (!remote.length) return local;
  if (!local.length) return remote;
  const lastL = local[local.length - 1]!;
  const lastR = remote[remote.length - 1]!;
  if (lastL.time > lastR.time) return [...remote, lastL];
  if (lastL.time === lastR.time) {
    return [
      ...remote.slice(0, -1),
      {
        time: lastL.time,
        open: lastR.open,
        high: Math.max(lastL.high, lastR.high),
        low: Math.min(lastL.low, lastR.low),
        close: lastL.close,
      },
    ];
  }
  return remote;
}
