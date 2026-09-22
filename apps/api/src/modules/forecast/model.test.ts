import { describe, expect, it } from "vitest";
import { centralPivotRange } from "../indicators/index.js";
import { buildDeskModel } from "./model.js";

function climb(start: number, n: number, step = 4) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { high: close + 3, low: close - 3, close, open: close - 1, volume: 1000 };
  });
}

function drop(start: number, n: number, step = 4) {
  return Array.from({ length: n }, (_, i) => {
    const close = start - i * step;
    return { high: close + 3, low: close - 3, close, open: close + 1, volume: 1000 };
  });
}

describe("desk model", () => {
  it("builds CPR from the prior day the way Indian desks do", () => {
    const cpr = centralPivotRange({ high: 1020, low: 980, close: 1010 });
    expect(cpr.pivot).toBeCloseTo(1003.333, 2);
    expect(cpr.tc).toBeGreaterThan(cpr.bc);
    expect(cpr.r1).toBeGreaterThan(cpr.pivot);
    expect(cpr.s1).toBeLessThan(cpr.pivot);
  });

  it("votes bullish when daily trend, CPR and RSI stack up", () => {
    const daily = climb(900, 60);
    const last = daily.at(-1)!.close;
    const model = buildDeskModel({ last, daily, newsScore: 0.4 });
    expect(model.bias).toBe("BULLISH");
    expect(model.score).toBeGreaterThan(0.16);
    expect(model.pull).toBeGreaterThan(0.5);
    expect(model.resistances.length).toBeGreaterThan(0);
  });

  it("votes bearish when the tape is stacked down", () => {
    const daily = drop(1100, 60);
    const last = daily.at(-1)!.close;
    const model = buildDeskModel({ last, daily, newsScore: -0.4 });
    expect(model.bias).toBe("BEARISH");
    expect(model.score).toBeLessThan(-0.16);
    expect(model.pull).toBeLessThan(0.5);
    expect(model.supports.length).toBeGreaterThan(0);
  });
});
