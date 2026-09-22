import { describe, expect, it } from "vitest";
import { evaluateRisk, type RiskInputs } from "./engine.js";
import type { RiskProfile, TradeIntent } from "@xtrader/domain";

const profile: RiskProfile = {
  capital: "100000.00",
  maxDailyLoss: "1000.00",
  maxRiskPerTrade: "300.00",
  maxOpenPositions: 3,
  maxTradesPerDay: 5,
  minimumRiskReward: "1.5",
  allowEquity: true,
  allowFutures: false,
  allowOptions: false,
  allowOvernight: false,
  maxConsecutiveLosses: 5,
};

const baseIntent: TradeIntent = {
  decision: "TRADE",
  instrument: { exchange: "NSE", symbol: "RELIANCE", instrumentType: "EQUITY" },
  direction: "LONG",
  entryType: "LIMIT",
  entryPrice: "2965.00",
  stopLoss: "2940.00",
  targets: ["3020.00"],
  confidenceScore: 0.76,
  timeHorizon: "INTRADAY",
  strategy: "breakout-volume",
  thesis: "Breakout",
  invalidation: "Close below zone",
  maxRiskRequested: "250.00",
  metadata: {},
};

function input(over: Partial<RiskInputs> = {}): RiskInputs {
  return {
    profile,
    intent: baseIntent,
    availableCash: "100000",
    openPositions: 0,
    tradesToday: 0,
    consecutiveLosses: 0,
    dailyNetPnl: "0",
    reservedRisk: "0",
    haltActive: false,
    marketOpen: true,
    dataFresh: true,
    lastPrice: "2965.00",
    lotSize: 1,
    ...over,
  };
}

describe("evaluateRisk", () => {
  it("approves a valid long with rounded quantity", () => {
    const result = evaluateRisk(input());
    expect(result.approved).toBe(true);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.quantity! * 25).toBeLessThanOrEqual(300);
  });

  it("rejects risk above per-trade cap", () => {
    const result = evaluateRisk(input({ intent: { ...baseIntent, maxRiskRequested: "420.00" } }));
    expect(result.approved).toBe(false);
    expect(result.code).toBe("MAX_RISK_PER_TRADE_EXCEEDED");
  });

  it("rejects halt", () => {
    expect(evaluateRisk(input({ haltActive: true })).code).toBe("KILL_SWITCH_ACTIVE");
  });

  it("rejects stale data", () => {
    expect(evaluateRisk(input({ dataFresh: false })).code).toBe("MARKET_DATA_STALE");
  });

  it("rejects index instruments", () => {
    const result = evaluateRisk(
      input({
        intent: {
          ...baseIntent,
          instrument: { exchange: "NSE", symbol: "NIFTY 50", instrumentType: "INDEX" },
        },
      }),
    );
    expect(result.code).toBe("INSTRUMENT_NOT_ORDERABLE");
  });

  it("rejects low R:R", () => {
    const result = evaluateRisk(input({ intent: { ...baseIntent, targets: ["2970.00"] } }));
    expect(result.code).toBe("LOW_REWARD_RISK");
  });

  it("caps quantity at the requested size", () => {
    const result = evaluateRisk(input({ requestedQuantity: 1 }));
    expect(result.approved).toBe(true);
    expect(result.quantity).toBe(1);
  });

  it("rejects inverted stop", () => {
    const result = evaluateRisk(input({ intent: { ...baseIntent, stopLoss: "3000.00" } }));
    expect(result.code).toBe("INVALID_STOP");
  });
});
