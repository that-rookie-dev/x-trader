import { money, type AiStudy, type ForecastBias } from "@xtrader/domain";
import { blackScholesIv, blackScholesPrice } from "../indicators/index.js";
import { optionPnl, optionPnlShort } from "./charges.js";
import { isIndexUnderlying } from "./levels.js";
import { liquidEnough, mapInvalidated, sessionClock } from "./chain-tape.js";
import type { AgentMark } from "./desk.js";
import {
  DEFAULT_FORECAST_PARAMS,
  pullForBias,
  type EodFeatures,
  type ForecastParams,
} from "../learning/params.js";

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

function clampPull(n: number): number {
  return Math.min(0.82, Math.max(0.18, n));
}

/** Adjust session pull using PCR / ADX / IV when present. */
export function adjustedPull(
  params: ForecastParams,
  bias: ForecastBias,
  basePull: number,
  features?: EodFeatures | null,
): number {
  let pull = clampPull(basePull);
  const f = features ?? {};
  if (f.pcr != null && Number.isFinite(f.pcr) && params.pcrTilt > 0) {
    // PCR > 1 → more put heavy → tilt pull down; PCR < 1 → tilt up.
    const tilt = (1 - f.pcr) * params.pcrTilt;
    pull = clampPull(pull + tilt);
  }
  if (f.adx != null && Number.isFinite(f.adx) && f.adx >= 22 && params.adxTrendTilt > 0) {
    const sign = bias === "BULLISH" ? 1 : bias === "BEARISH" ? -1 : 0;
    pull = clampPull(pull + sign * params.adxTrendTilt);
  }
  if (f.ivRank != null && Number.isFinite(f.ivRank) && f.ivRank >= 0.55 && params.ivMeanRevert > 0) {
    const strength = Math.min(1, (f.ivRank - 0.55) / 0.45) * params.ivMeanRevert;
    pull = clampPull(pull + (0.5 - pull) * strength);
  }
  if (f.gapPct != null && Number.isFinite(f.gapPct) && params.gapTilt > 0) {
    // Cap gap influence at ±2% of spot move equivalent on pull scale
    const g = Math.max(-0.02, Math.min(0.02, f.gapPct));
    pull = clampPull(pull + (g / 0.02) * params.gapTilt);
  }
  if (f.voteScore != null && Number.isFinite(f.voteScore) && params.voteTilt > 0) {
    const v = Math.max(-6, Math.min(6, f.voteScore));
    pull = clampPull(pull + (v / 6) * params.voteTilt);
  }
  return pull;
}

function lateSpotWeights(params: ForecastParams, minutesToClose: number | null | undefined): ForecastParams {
  if (minutesToClose == null || !Number.isFinite(minutesToClose) || params.lateSpotBoost <= 0) return params;
  // Full boost in last 60 minutes; none before 120 minutes.
  const t = minutesToClose <= 60 ? 1 : minutesToClose >= 120 ? 0 : (120 - minutesToClose) / 60;
  if (t <= 0) return params;
  const boost = params.lateSpotBoost * t;
  const donors = params.wSession + params.wMagnet + params.wFlow + params.wPain + params.wVwap;
  if (!(donors > 0) || !(boost > 0)) return params;
  const take = Math.min(boost, donors * 0.85);
  const scale = (donors - take) / donors;
  return {
    ...params,
    wSession: params.wSession * scale,
    wMagnet: params.wMagnet * scale,
    wFlow: params.wFlow * scale,
    wPain: params.wPain * scale,
    wVwap: params.wVwap * scale,
    wSpot: params.wSpot + take,
  };
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
  params?: ForecastParams;
  features?: EodFeatures | null;
}): { close: string; low: string; high: string; note: string } {
  const base = input.params ?? DEFAULT_FORECAST_PARAMS;
  const low = Math.min(input.expectedLow, input.last);
  const high = Math.max(input.expectedHigh, input.last);
  const span = Math.max(high - low, input.last * 0.002);
  const rawPull =
    input.pull != null && Number.isFinite(input.pull)
      ? Math.min(0.82, Math.max(0.18, input.pull))
      : pullForBias(base, input.bias);
  const pull = adjustedPull(base, input.bias, rawPull, input.features);
  const sessionTarget = low + span * pull;
  const magnet = pickStructureMagnet(input);
  const f = input.features ?? {};
  const flowPull = clampPull(0.5 + (f.pcr != null && Number.isFinite(f.pcr) ? (1 - f.pcr) * base.pcrTilt : 0));
  const flowTarget = low + span * flowPull;
  const painRaw = f.maxPain != null && Number.isFinite(f.maxPain) ? f.maxPain : magnet;
  const painTarget = Math.min(high + span * 0.1, Math.max(low - span * 0.1, painRaw));
  const vwapRaw = f.vwap != null && Number.isFinite(f.vwap) ? f.vwap : magnet;
  const vwapTarget = Math.min(high + span * 0.1, Math.max(low - span * 0.1, vwapRaw));

  const w = lateSpotWeights(base, f.minutesToClose);
  const close =
    sessionTarget * w.wSession +
    magnet * w.wMagnet +
    input.last * w.wSpot +
    flowTarget * w.wFlow +
    painTarget * w.wPain +
    vwapTarget * w.wVwap;

  const label = money(magnet, 2);
  const extras: string[] = [];
  if (f.pcr != null) extras.push(`PCR ${f.pcr.toFixed(2)}`);
  if (f.maxPain != null) extras.push(`pain ${money(f.maxPain, 0)}`);
  if (f.vwap != null) extras.push(`VWAP ${money(f.vwap, 0)}`);
  const featNote = extras.length ? ` · ${extras.join(" · ")}` : "";
  return {
    close: money(close, 2),
    low: money(low, 2),
    high: money(high, 2),
    note:
      (input.bias === "BULLISH"
        ? `Helper expects a close toward resistance ${label}.`
        : input.bias === "BEARISH"
          ? `Helper expects a close toward support ${label}.`
          : `Helper expects a close near magnet ${label}.`) + featNote,
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
  /** Labels are about direction agreement + how far the two closes sit, not identical prints. */
  const tag = same
    ? rel <= 0.0015
      ? "ALIGNED"
      : rel <= 0.004
        ? "LEAN"
        : "STRETCH"
    : rel <= 0.004
      ? "MIXED"
      : "OPPOSED";
  const gap = `${(rel * 100).toFixed(2)}% apart`;
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

function yearsUntil(expiry: string | null, at: Date): number {
  if (!expiry) return 3 / 365;
  const end = new Date(`${expiry}T15:30:00+05:30`);
  return Math.max((end.getTime() - at.getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0);
}

/** Stock F&O delivery margin starts four sessions before a Tuesday expiry. Six calendar days covers that week. */
export function inPhysicalWindow(symbol: string, expiry: string | null, now = new Date()): boolean {
  if (!expiry || isIndexUnderlying(symbol)) return false;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const days = (new Date(`${expiry}T15:30:00+05:30`).getTime() - new Date(`${today}T12:00:00+05:30`).getTime()) / 86400000;
  return days <= 6;
}

export function estimateOptionEod(input: {
  kind: "CE" | "PE";
  strike: number;
  spot: number;
  eodSpot: number;
  premium: number | null;
  expiry: string | null;
  params?: ForecastParams;
  now?: Date;
  /** Futures price when the chain has one. Carry is already in the future, so the rate used with it is 0. */
  futurePx?: number | null;
}): { eodPremium: string; moneyness: "ITM" | "ATM" | "OTM" } {
  const params = input.params ?? DEFAULT_FORECAST_PARAMS;
  const now = input.now ?? new Date();
  const intrinsicNow = input.kind === "CE" ? Math.max(input.spot - input.strike, 0) : Math.max(input.strike - input.spot, 0);
  const intrinsicEod = input.kind === "CE" ? Math.max(input.eodSpot - input.strike, 0) : Math.max(input.strike - input.eodSpot, 0);
  const premium = input.premium != null && input.premium > 0 ? input.premium : Math.max(intrinsicNow, 0.05);
  const timeValue = Math.max(premium - intrinsicNow, 0);
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryToday = Boolean(input.expiry && input.expiry <= today);
  const remain = expiryToday ? params.optionRemainExpiry : params.optionRemainLater;
  const flat = Math.max(intrinsicEod + timeValue * remain, 0.05);
  const useFuture = input.futurePx != null && input.futurePx > 0 && input.spot > 0;
  const basis = useFuture ? input.futurePx! / input.spot : 1;
  // Use the future only to imply IV, and only when it is the same expiry and within a few days of carry.
  // Never rescale the cash close. That made calls settle hundreds of points away from puts.
  const aligned = useFuture && !expiryToday && basis > 0.997 && basis < 1.003;
  const undNow = aligned ? input.futurePx! : input.spot;
  const rate = aligned ? 0 : 0.065;
  const tNow = yearsUntil(input.expiry, now);
  const eodAt = new Date(`${today}T15:30:00+05:30`);
  const tEod = yearsUntil(input.expiry, eodAt);
  const iv = tNow > 1 / 24 / 365 ? blackScholesIv(premium, undNow, input.strike, tNow, input.kind, rate) : null;
  const modelled = iv != null ? blackScholesPrice(input.eodSpot, input.strike, tEod, iv, input.kind, rate) : flat;
  const priced = Number.isFinite(modelled) ? modelled : flat;
  const eodPremium = Math.max(priced, expiryToday ? intrinsicEod : 0, 0.05);
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
  heldSide?: "LONG" | "SHORT" | null;
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
  params?: ForecastParams;
  futurePx?: number | null;
  /** Cash symbol. Stock names inside the delivery week are not opened. */
  underlying?: string | null;
}): {
  eodPremium: string;
  moneyness: "ITM" | "ATM" | "OTM";
  eodMoneyness: "ITM" | "ATM" | "OTM";
  lotSize: number;
  pnl: ReturnType<typeof optionPnl>;
  shortPnl: ReturnType<typeof optionPnlShort>;
  mark: AgentMark;
  why: string;
} {
  const now = input.now ?? new Date();
  const est = estimateOptionEod({ ...input, now });
  const sideNow = spotMoneyness(input.kind, input.strike, input.spot);
  const entry = input.premium != null && input.premium > 0 ? input.premium : Number(est.eodPremium);
  const exit = Number(est.eodPremium);
  const qty = Math.max(1, input.lotSize);
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryToday = Boolean(input.expiry && input.expiry <= today);
  const intrinsicEod = input.kind === "CE" ? Math.max(input.eodSpot - input.strike, 0) : Math.max(input.strike - input.eodSpot, 0);
  const pnl = optionPnl({ entry, exit, qty });
  const shortPnl = optionPnlShort({ entry, exit, qty, exerciseIntrinsic: expiryToday ? intrinsicEod : 0 });
  const net = Number(pnl.net);
  const shortNet = Number(shortPnl.net);
  const physical = input.underlying ? inPhysicalWindow(input.underlying, input.expiry, now) : false;
  const want = tradeDirection(input.spot, input.eodSpot);
  const cheap = isCheapSide(input.kind, input.strike, input.spot);
  const inPlay = isInPlayStrike(input.kind, input.strike, input.spot, input.eodSpot);
  const clock = sessionClock(input.now ?? new Date(), input.expiry, input.params);
  const cutoff = input.cutoff ?? clock.cutoff;
  const floor = input.netFloor ?? clock.netFloor;
  const invalidated =
    input.invalidated ??
    (input.bias != null && input.expectedLow != null && input.expectedHigh != null
      ? mapInvalidated(input.bias, input.spot, input.expectedLow, input.expectedHigh)
      : false);
  const liquid = input.liquid ?? liquidEnough(input.oi, input.volume, input.bid, input.ask);
  const heldSide = input.heldSide ?? (input.held ? "LONG" : null);
  let mark: AgentMark = "NO_BUY";
  let why = "Expected EOD move does not cover charges.";

  if (heldSide === "LONG" && physical) {
    mark = "SELL";
    why = "Delivery week — square off this stock option before expiry. An ITM strike becomes a share obligation.";
  } else if (heldSide === "LONG" && (input.existing === "SELL" || shortNet >= floor || net < floor * 0.5)) {
    mark = "SELL";
    why = "You hold long — helper wants this closed (or edge faded).";
  } else if (heldSide === "SHORT") {
    if (net >= floor || shortNet < floor) {
      mark = "BUY";
      why = "You are short — cover (premium rising / write edge gone).";
    } else {
      mark = "WAIT";
      why = `Short working — keep write if premium fades to ~${money(exit, 2)}.`;
    }
  } else if (!liquid) {
    why = "No tape / no OI — skip this weekly.";
  } else if (invalidated) {
    why = "Map invalidated — spot broke the session band against the bias.";
    mark = input.existing === "WAIT" ? "WAIT" : "NO_BUY";
  } else if (physical) {
    why = "Stock F&O is inside the physical-delivery week. Square off before expiry; do not open a new option.";
  } else if (input.richIv && net >= floor) {
    why = "IV is rich vs realized vol — premium is expensive to buy; prefer a write only if short edge clears the floor.";
  } else if (net >= floor) {
    mark = "BUY";
    const bits = [
      `${sideNow} ${input.kind}`,
      `net ₹${pnl.net} if close ~${money(input.eodSpot, 2)}`,
    ];
    if (want && want !== input.kind) bits.push(`against ${want} lean`);
    else if (want === input.kind) bits.push(`${want} lean`);
    else bits.push("flat tape");
    if (!cheap) bits.push("ITM premium");
    else if (!inPlay) bits.push("wide of EOD path");
    if (input.adxAgainst) bits.push("ADX against");
    why = bits.join(" · ");
  } else if (shortNet >= floor) {
    // Write / short: premium expected to fade after charges.
    mark = "SELL";
    const bits = [
      `WRITE ${sideNow} ${input.kind}`,
      `net ₹${shortPnl.net} if buy back ~${money(exit, 2)}`,
    ];
    if (input.richIv) bits.push("rich IV");
    if (want && want !== input.kind) bits.push(`${want} lean helps write`);
    why = bits.join(" · ");
  } else if (input.richIv) {
    why = "IV is rich vs realized vol — premium is expensive to buy; write edge also thin.";
  } else if (input.existing === "WAIT") {
    mark = "WAIT";
    why = "Waiting for a clearer EOD close.";
  } else if (want && want !== input.kind) {
    why = `Index leans ${want}. This ${input.kind} is not expected to pay after charges (buy net ₹${pnl.net}, write net ₹${shortPnl.net}).`;
  } else if (!cheap) {
    why = `${sideNow} ${input.kind} — buy net ₹${pnl.net} / write net ₹${shortPnl.net} under ₹${floor} floor.`;
  } else if (!inPlay) {
    why = `Too far from the EOD path — buy net ₹${pnl.net}.`;
  }

  // Outside market hours — no new paper entries; marks read CLOSED.
  if (!heldSide && cutoff) {
    why = mark === "BUY" || mark === "SELL" ? `CLOSED — market hours ended (would ${mark}: ${why})` : why.startsWith("CLOSED") ? why : `CLOSED — market hours ended. ${why}`;
    mark = "CLOSED";
  }

  return {
    eodPremium: est.eodPremium,
    moneyness: sideNow,
    eodMoneyness: est.moneyness,
    lotSize: Math.max(1, input.lotSize),
    pnl,
    shortPnl,
    mark,
    why,
  };
}
