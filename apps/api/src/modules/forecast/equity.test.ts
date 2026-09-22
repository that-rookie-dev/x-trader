import { describe, expect, it } from "vitest";
import { momentum12_1, periodRet, rankEquities, relativeStrength, scoreEquity } from "./equity.js";

function climb(start: number, n: number, step = 1) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { high: close + 2, low: close - 2, close };
  });
}

describe("equity scorer", () => {
  it("computes 12-1 momentum as now/252 minus last-month skip", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2);
    const value = momentum12_1(closes);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(0);
  });

  it("scores RS as stock return minus Nifty return", () => {
    const stock = Array.from({ length: 30 }, (_, i) => 100 + i);
    const nifty = Array.from({ length: 30 }, () => 100);
    expect(relativeStrength(stock, nifty, 20)).toBeGreaterThan(0);
    expect(periodRet(stock, 20)).toBeGreaterThan(0);
  });

  it("ranks a strong uptrend as a swing/position buy", () => {
    const daily = climb(200, 260, 1.2);
    const nifty = climb(200, 260, 0.2).map((c) => c.close);
    const scored = scoreEquity({
      symbol: "RELIANCE",
      exchange: "NSE",
      last: daily.at(-1)!.close,
      daily,
      niftyCloses: nifty,
      newsScore: 0.1,
      regime: "BULLISH",
    });
    expect(scored.action).toBe("BUY");
    expect(scored.stop).not.toBeNull();
    expect(scored.target).not.toBeNull();
    expect(scored.rsVsNifty).not.toBeNull();
    expect(rankEquities([scored])[0]!.rank).toBe(1);
  });

  it("blocks new cash buys in a strong downtrend below SMA200", () => {
    const daily = climb(400, 260, -1);
    const nifty = climb(200, 260, 0.1).map((c) => c.close);
    const scored = scoreEquity({
      symbol: "WEAK",
      exchange: "NSE",
      last: daily.at(-1)!.close,
      daily,
      niftyCloses: nifty,
      regime: "STRONG_BEARISH",
    });
    expect(scored.action).toBe("AVOID");
  });

  it("down-weights a setup with negative expectancy after 10 samples", () => {
    const daily = climb(200, 260, 0.4);
    const nifty = climb(200, 260, 0.3).map((c) => c.close);
    const base = scoreEquity({ symbol: "A", exchange: "NSE", last: daily.at(-1)!.close, daily, niftyCloses: nifty, regime: "BULLISH" });
    const weak = scoreEquity({
      symbol: "A",
      exchange: "NSE",
      last: daily.at(-1)!.close,
      daily,
      niftyCloses: nifty,
      regime: "BULLISH",
      expectancy: { key: "CASH:EQ:BULLISH", samples: 12, wins: 3, losses: 9, value: -40, note: "this setup 3/12 after costs" },
    });
    expect(weak.score).toBeLessThan(base.score);
  });
});
