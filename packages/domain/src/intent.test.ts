import { describe, expect, it } from "vitest";
import { money, tradeIntentSchema } from "./index.js";

describe("money", () => {
  it("formats two decimal places", () => {
    expect(money("100000")).toBe("100000.00");
  });
});

describe("tradeIntentSchema", () => {
  it("accepts a valid equity intent", () => {
    const parsed = tradeIntentSchema.parse({
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
      thesis: "Breakout above resistance with increasing volume",
      invalidation: "Price closes below the breakout zone",
      maxRiskRequested: "250.00",
      metadata: {},
    });
    expect(parsed.instrument.symbol).toBe("RELIANCE");
  });

  it("rejects malformed prices", () => {
    expect(() =>
      tradeIntentSchema.parse({
        decision: "TRADE",
        instrument: { exchange: "NSE", symbol: "RELIANCE" },
        direction: "LONG",
        entryType: "LIMIT",
        entryPrice: "NaN",
        stopLoss: "2940.00",
        targets: ["3020.00"],
        confidenceScore: 0.76,
        timeHorizon: "INTRADAY",
        strategy: "x",
        thesis: "x",
        invalidation: "x",
        maxRiskRequested: "250.00",
      }),
    ).toThrow();
  });
});
