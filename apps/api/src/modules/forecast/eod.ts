import { money, type AiStudy, type ForecastBias } from "@xtrader/domain";
import { optionPnl } from "./charges.js";
import { liquidEnough, mapInvalidated, sessionClock } from "./chain-tape.js";
import type { AgentMark } from "./desk.js";

export function pickStructureMagnet(input: {
  last: number;
  bias: ForecastBias;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  supports?: number[];
  resistances?: number[];
  magnets?: number[];
}): number {
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const pad = Math.max(high - low, input.last * 0.002) * 0.2;
  const inBand = (n: number) => Number.isFinite(n) && n >= low - pad && n <= high + pad;
  const supports = (input.supports ?? []).filter(inBand);
  const resistances = (input.resistances ?? []).filter(inBand);
  const extras = (input.magnets ?? []).filter(inBand);
  const nearest = (values: number[], from: number) =>
    values.reduce((best, value) => (Math.abs(value - from) < Math.abs(best - from) ? value : best), values[0] ?? from);
  if (input.bias === "BULLISH") {
    const above = [...resistances, ...extras.filter((n) => n >= input.last)].sort((a, b) => a - b);
    if (above[0] != null) return above[0];
  }
  if (input.bias === "BEARISH") {
    const below = [...supports, ...extras.filter((n) => n <= input.last)].sort((a, b) => b - a);
    if (below[0] != null) return below[0];
  }
  return nearest([input.magnet || input.last, ...supports, ...resistances, ...extras], input.last);
}

export function predictEodSpot(input: {
  last: number;
  bias: ForecastBias;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  supports?: number[];
  resistances?: number[];
  magnets?: number[];
  pull?: number;
}): { close: string; low: string; high: string; note: string } {
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
  const magnet = pickStructureMagnet(input);
  const close = sessionTarget * 0.45 + magnet * 0.35 + input.last * 0.2;
  const label = money(magnet, 2);
  return {
    close: money(close, 2),
    low: money(low, 2),
    high: money(high, 2),
    note:
      input.bias === "BULLISH"
        ? `Helper expects a close toward resistance ${label}.`
        : input.bias === "BEARISH"
          ? `Helper expects a close toward support ${label}.`
          : `Helper expects a close near magnet ${label}.`,
  };
}

/** Price an LLM study inside the session band so it cannot invent a wild close. */
export function applyAiStudy(input: {
  last: number;
  expectedLow: number;
  expectedHigh: number;
  magnet: number;
  direction: ForecastBias;
  pull: number;
  closeHint?: number | null;
}): { close: string; low: string; high: string; note: string } {
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const span = Math.max(high - low, input.last * 0.002);
  const pull = Math.min(1, Math.max(0, input.pull));
  const fromPull = low + span * pull;
  const raw = input.closeHint != null && Number.isFinite(input.closeHint) ? input.closeHint : fromPull;
  const close = Math.min(high + span * 0.15, Math.max(low - span * 0.15, raw));
  return {
    close: money(close, 2),
    low: money(low, 2),
    high: money(high, 2),
    note:
      input.direction === "BULLISH"
        ? "AI study expects a close near the upper side after news + tape."
        : input.direction === "BEARISH"
          ? "AI study expects a close near the lower side after news + tape."
          : "AI study expects a range close after news + tape.",
  };
}

export function compareEod(algoClose: number, aiClose: number, algoBias: ForecastBias, aiBias: ForecastBias) {
  const mid = (Math.abs(algoClose) + Math.abs(aiClose)) / 2 || 1;
  const delta = aiClose - algoClose;
  const rel = Math.abs(delta) / mid;
  const same = algoBias === aiBias;
  const tag = same ? (rel <= 0.0015 ? "MATCH" : rel <= 0.004 ? "NEAR" : "WIDE") : rel <= 0.004 ? "SPLIT" : "CLASH";
  const hint =
    tag === "MATCH"
      ? "same call"
      : tag === "NEAR"
        ? "same side"
        : tag === "WIDE"
          ? "same side, gap"
          : tag === "SPLIT"
            ? "mixed view"
            : "opposite call";
  return { agree: same || rel <= 0.0015, delta: money(delta, 2), tag, hint };
}

export function nearestStrike(strikes: number[], want: number | null | undefined): number | null {
  if (want == null || !Number.isFinite(want) || strikes.length === 0) return null;
  return strikes.reduce((best, strike) => (Math.abs(strike - want) < Math.abs(best - want) ? strike : best), strikes[0]!);
}

export function viewAiStudy(
  study: AiStudy | undefined,
  live: { last: number; expectedLow: number; expectedHigh: number; magnet: number },
) {
  if (!study) return null;
  const priced = applyAiStudy({
    last: live.last,
    expectedLow: live.expectedLow,
    expectedHigh: live.expectedHigh,
    magnet: live.magnet,
    direction: study.direction,
    pull: study.pull,
    closeHint: Number(study.close),
  });
  return {
    close: priced.close,
    low: priced.low,
    high: priced.high,
    note: priced.note,
    direction: study.direction,
    confidence: Math.round(study.confidence * 100),
    why: study.why,
    catalysts: study.catalysts,
    peStrike: study.peStrike,
    ceStrike: study.ceStrike,
    studiedAt: study.studiedAt,
    skip: study.skip,
  };
}

/** PE at/below spot, CE at/above spot — skip expensive ITM premiums. */
export function isCheapSide(kind: "CE" | "PE", strike: number, spot: number): boolean {
  return kind === "PE" ? strike <= spot : strike >= spot;
}

/** Strike sits between spot and the EOD close (the move that pays). */
export function isInPlayStrike(kind: "CE" | "PE", strike: number, spot: number, eodSpot: number): boolean {
  const pad = Math.max(spot * 0.0025, 50);
  if (kind === "PE") return strike <= spot && strike >= eodSpot - pad;
  return strike >= spot && strike <= eodSpot + pad;
}

export function spotMoneyness(kind: "CE" | "PE", strike: number, spot: number): "ITM" | "ATM" | "OTM" {
  const band = Math.max(spot * 0.0015, 1);
  const dist = Math.abs(spot - strike);
  if (dist <= band) return "ATM";
  if (kind === "CE") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

function tradeDirection(spot: number, eodSpot: number): "PE" | "CE" | null {
  const dead = Math.max(spot * 0.0006, 8);
  if (eodSpot <= spot - dead) return "PE";
  if (eodSpot >= spot + dead) return "CE";
  return null;
}

export function estimateOptionEod(input: {
  kind: "CE" | "PE";
  strike: number;
  spot: number;
  eodSpot: number;
  premium: number | null;
  expiry: string | null;
}): { eodPremium: string; moneyness: "ITM" | "ATM" | "OTM" } {
  const intrinsicNow = input.kind === "CE" ? Math.max(input.spot - input.strike, 0) : Math.max(input.strike - input.spot, 0);
  const intrinsicEod = input.kind === "CE" ? Math.max(input.eodSpot - input.strike, 0) : Math.max(input.strike - input.eodSpot, 0);
  const premium = input.premium != null && input.premium > 0 ? input.premium : Math.max(intrinsicNow, 0.05);
  const timeValue = Math.max(premium - intrinsicNow, 0);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryToday = Boolean(input.expiry && input.expiry <= today);
  const remain = expiryToday ? 0.08 : 0.55;
  const eodPremium = Math.max(intrinsicEod + timeValue * remain, 0.05);
  const dist = Math.abs(input.eodSpot - input.strike);
  const atmBand = Math.max(input.eodSpot * 0.002, 1);
  const moneyness: "ITM" | "ATM" | "OTM" = dist <= atmBand ? "ATM" : intrinsicEod > 0 ? "ITM" : "OTM";
  return { eodPremium: money(eodPremium, 2), moneyness };
}

export function eodTradeView(input: {
  kind: "CE" | "PE";
  strike: number;
  spot: number;
  eodSpot: number;
  premium: number | null;
  expiry: string | null;
  lotSize: number;
  held: boolean;
  existing: AgentMark;
  now?: Date;
  bias?: ForecastBias;
  expectedLow?: number;
  expectedHigh?: number;
  oi?: number | null;
  volume?: number | null;
  bid?: number | null;
  ask?: number | null;
  netFloor?: number;
  cutoff?: boolean;
  invalidated?: boolean;
  liquid?: boolean;
  richIv?: boolean;
  adxAgainst?: boolean;
}): {
  eodPremium: string;
  moneyness: "ITM" | "ATM" | "OTM";
  eodMoneyness: "ITM" | "ATM" | "OTM";
  lotSize: number;
  pnl: ReturnType<typeof optionPnl>;
  mark: AgentMark;
  why: string;
} {
  const est = estimateOptionEod(input);
  const sideNow = spotMoneyness(input.kind, input.strike, input.spot);
  const entry = input.premium != null && input.premium > 0 ? input.premium : Number(est.eodPremium);
  const exit = Number(est.eodPremium);
  const pnl = optionPnl({ entry, exit, qty: Math.max(1, input.lotSize) });
  const net = Number(pnl.net);
  const want = tradeDirection(input.spot, input.eodSpot);
  const cheap = isCheapSide(input.kind, input.strike, input.spot);
  const inPlay = isInPlayStrike(input.kind, input.strike, input.spot, input.eodSpot);
  const clock = sessionClock(input.now ?? new Date(), input.expiry);
  const cutoff = input.cutoff ?? clock.cutoff;
  const floor = input.netFloor ?? clock.netFloor;
  const invalidated =
    input.invalidated ??
    (input.bias != null && input.expectedLow != null && input.expectedHigh != null
      ? mapInvalidated(input.bias, input.spot, input.expectedLow, input.expectedHigh)
      : false);
  const liquid = input.liquid ?? liquidEnough(input.oi, input.volume, input.bid, input.ask);
  let mark: AgentMark = "NO_BUY";
  let why = "Expected EOD move does not cover charges.";
  if (input.existing === "SELL" && input.held) {
    mark = "SELL";
    why = "You already hold this. Helper wants it closed.";
  } else if (!cheap) {
    why =
      input.kind === "PE"
        ? "ITM PE sits above spot — premium is too high. Buy a PE below the index."
        : "ITM CE sits below spot — premium is too high. Buy a CE above the index.";
  } else if (want && want !== input.kind) {
    why =
      want === "PE"
        ? "Index looks lower by EOD. Buy PE below spot, not this CE."
        : "Index looks higher by EOD. Buy CE above spot, not this PE.";
  } else if (!inPlay) {
    why = "Too far from the EOD close — this strike is likely worthless or already spent.";
  } else if (!liquid) {
    why = "No tape / no OI — skip this weekly.";
  } else if (input.richIv) {
    why = "IV is rich vs realized vol — do not buy this weekly premium.";
  } else if (input.adxAgainst) {
    why = "ADX is trending against this side — do not fade a strong move.";
  } else if (invalidated) {
    why = "Map invalidated — spot broke the session band against the bias.";
    mark = input.existing === "WAIT" ? "WAIT" : "NO_BUY";
  } else if (cutoff) {
    why = "Session cutoff — no new buys.";
  } else if (net >= floor) {
    mark = "BUY";
    why =
      input.kind === "PE"
        ? `OTM PE below spot. Expected net ₹${pnl.net} if the index closes near ${money(input.eodSpot, 2)}.`
        : `OTM CE above spot. Expected net ₹${pnl.net} if the index closes near ${money(input.eodSpot, 2)}.`;
  } else if (input.existing === "WAIT") {
    mark = "WAIT";
    why = "Waiting for a clearer EOD close.";
  }
  return {
    eodPremium: est.eodPremium,
    moneyness: sideNow,
    eodMoneyness: est.moneyness,
    lotSize: Math.max(1, input.lotSize),
    pnl,
    mark,
    why,
  };
}
