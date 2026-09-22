import { AppError, d, money, type RiskProfile, type TradeIntent } from "@xtrader/domain";

export interface RiskInputs {
  profile: RiskProfile;
  intent: TradeIntent;
  availableCash: string;
  openPositions: number;
  tradesToday: number;
  consecutiveLosses: number;
  dailyNetPnl: string;
  reservedRisk: string;
  haltActive: boolean;
  marketOpen: boolean;
  dataFresh: boolean;
  lastPrice: string;
  lotSize?: number;
  requestedQuantity?: number;
}

export interface RiskResult {
  approved: boolean;
  code: string;
  reason: string;
  quantity?: number;
  plannedRisk?: string;
  rewardRisk?: string;
}

export function evaluateRisk(input: RiskInputs): RiskResult {
  const { profile, intent } = input;
  if (input.haltActive) {
    return { approved: false, code: "KILL_SWITCH_ACTIVE", reason: "Trading halt is active; new exposure is blocked." };
  }
  if (!input.marketOpen) {
    return { approved: false, code: "MARKET_CLOSED", reason: "Market session is closed." };
  }
  if (!input.dataFresh) {
    return { approved: false, code: "MARKET_DATA_STALE", reason: "Market data is stale." };
  }
  if (intent.instrument.instrumentType === "FUTURE" && !profile.allowFutures) {
    return { approved: false, code: "FUTURES_DISABLED", reason: "Futures are disabled." };
  }
  if (intent.instrument.instrumentType === "OPTION" && !profile.allowOptions) {
    return { approved: false, code: "OPTIONS_DISABLED", reason: "Options are disabled." };
  }
  if (intent.instrument.instrumentType === "INDEX") {
    return { approved: false, code: "INSTRUMENT_NOT_ORDERABLE", reason: "Index instruments are for context only." };
  }
  if (intent.direction === "SHORT") {
    return { approved: false, code: "SHORTS_DISABLED", reason: "Short openings are not supported in this build." };
  }
  if (intent.timeHorizon !== "INTRADAY" && !profile.allowOvernight) {
    return { approved: false, code: "OVERNIGHT_DISABLED", reason: "Overnight positions are not allowed." };
  }

  const entry = d(intent.entryPrice);
  const stop = d(intent.stopLoss);
  const target = d(intent.targets[0] ?? "0");
  if (intent.direction === "LONG") {
    if (!stop.lt(entry)) {
      return { approved: false, code: "INVALID_STOP", reason: "Stop must be below entry for a long." };
    }
    if (!target.gt(entry)) {
      return { approved: false, code: "INVALID_TARGET", reason: "Target must be above entry for a long." };
    }
  }

  const perShareRisk = entry.minus(stop).abs();
  if (perShareRisk.lte(0)) {
    return { approved: false, code: "INVALID_STOP", reason: "Entry-to-stop distance must be positive." };
  }
  const reward = target.minus(entry).abs();
  const rr = reward.div(perShareRisk);
  if (rr.lt(d(profile.minimumRiskReward))) {
    return {
      approved: false,
      code: "LOW_REWARD_RISK",
      reason: `Reward/risk ${rr.toFixed(2)} is below the ${profile.minimumRiskReward} minimum.`,
    };
  }

  const requested = d(intent.maxRiskRequested);
  if (requested.gt(d(profile.maxRiskPerTrade))) {
    return {
      approved: false,
      code: "MAX_RISK_PER_TRADE_EXCEEDED",
      reason: `Requested planned risk of INR ${requested.toFixed(2)} exceeds the INR ${profile.maxRiskPerTrade} limit.`,
    };
  }

  const dailyLoss = d(input.dailyNetPnl);
  if (dailyLoss.lte(d(profile.maxDailyLoss).neg())) {
    return { approved: false, code: "DAILY_LOSS_LIMIT_REACHED", reason: "Daily loss limit already reached." };
  }

  const remainingDaily = d(profile.maxDailyLoss).plus(dailyLoss).minus(d(input.reservedRisk));
  if (remainingDaily.lte(0)) {
    return { approved: false, code: "DAILY_LOSS_LIMIT_REACHED", reason: "Remaining daily risk budget is zero." };
  }

  if (input.openPositions >= profile.maxOpenPositions) {
    return { approved: false, code: "MAX_OPEN_POSITIONS", reason: "Open position limit reached." };
  }
  if (input.tradesToday >= profile.maxTradesPerDay) {
    return { approved: false, code: "MAX_TRADES_PER_DAY", reason: "Daily trade count limit reached." };
  }
  if (input.consecutiveLosses >= profile.maxConsecutiveLosses) {
    return { approved: false, code: "CONSECUTIVE_LOSSES", reason: "Consecutive loss limit reached." };
  }

  const last = d(input.lastPrice);
  const priceDrift = last.minus(entry).abs().div(entry);
  if (priceDrift.gt("0.01")) {
    return { approved: false, code: "PRICE_DRIFT", reason: "Last price has moved more than 1% from the proposed entry." };
  }

  const budget = DecimalMin(requested, remainingDaily, d(profile.maxRiskPerTrade));
  let qty = budget.div(perShareRisk).floor().toNumber();
  const lot = input.lotSize ?? 1;
  qty = Math.floor(qty / lot) * lot;
  if (qty <= 0) {
    return { approved: false, code: "INVALID_QUANTITY", reason: "No valid quantity remains after rounding." };
  }

  const notional = entry.mul(qty);
  if (notional.gt(d(input.availableCash))) {
    qty = d(input.availableCash).div(entry).floor().toNumber();
    qty = Math.floor(qty / lot) * lot;
    if (qty <= 0) {
      return { approved: false, code: "INSUFFICIENT_CAPITAL", reason: "Available cash cannot fund this trade." };
    }
  }

  if (input.requestedQuantity && input.requestedQuantity > 0) {
    qty = Math.min(qty, Math.floor(input.requestedQuantity / lot) * lot);
    if (qty <= 0) {
      return { approved: false, code: "INVALID_QUANTITY", reason: "Requested quantity is below the lot size." };
    }
  }

  const plannedRisk = perShareRisk.mul(qty);
  return {
    approved: true,
    code: "APPROVED",
    reason: "Risk checks passed.",
    quantity: qty,
    plannedRisk: money(plannedRisk),
    rewardRisk: rr.toFixed(4),
  };
}

function DecimalMin(...values: ReturnType<typeof d>[]): ReturnType<typeof d> {
  return values.reduce((min, v) => (v.lt(min) ? v : min));
}

export function requireApproved(result: RiskResult): asserts result is RiskResult & { quantity: number } {
  if (!result.approved || !result.quantity) {
    throw new AppError(result.code, result.reason, 422);
  }
}
