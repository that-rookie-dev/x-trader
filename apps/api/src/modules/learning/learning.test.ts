import { describe, expect, it } from "vitest";
import { DEFAULT_FORECAST_PARAMS, clampParams, pullForBias, diffParams, applyParamDelta } from "./params.js";
import { predictionErrorPct, scorePrediction } from "./ledger.js";
import { searchParams, type TuneSample } from "./tuner.js";
import { predictEodSpot } from "../forecast/eod.js";
import { marketBlocksPaper, sessionClock } from "../forecast/chain-tape.js";

describe("forecast params", () => {
  it("loads defaults that match the historic blend", () => {
    expect(DEFAULT_FORECAST_PARAMS.wSession).toBeCloseTo(0.38);
    expect(DEFAULT_FORECAST_PARAMS.wMagnet).toBeCloseTo(0.28);
    expect(DEFAULT_FORECAST_PARAMS.wSpot).toBeCloseTo(0.18);
    expect(DEFAULT_FORECAST_PARAMS.wFlow + DEFAULT_FORECAST_PARAMS.wPain + DEFAULT_FORECAST_PARAMS.wVwap).toBeCloseTo(0.16);
  });

  it("renormalizes weights after clamp", () => {
    const next = clampParams({ wSession: 0.9, wMagnet: 0.9, wSpot: 0.9, wFlow: 0.9, wPain: 0.9, wVwap: 0.9 });
    const sum =
      next.wSession + next.wMagnet + next.wSpot + next.wFlow + next.wPain + next.wVwap;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("pullForBias uses param table", () => {
    expect(pullForBias(DEFAULT_FORECAST_PARAMS, "BULLISH")).toBe(0.68);
    expect(pullForBias(DEFAULT_FORECAST_PARAMS, "BEARISH")).toBe(0.32);
  });
});

describe("predictEodSpot params", () => {
  it("changes close when wSpot rises", () => {
    const base = {
      last: 1000,
      bias: "RANGE" as const,
      expectedLow: 980,
      expectedHigh: 1020,
      magnet: 990,
    };
    const heavySpot = predictEodSpot({
      ...base,
      params: clampParams({
        ...DEFAULT_FORECAST_PARAMS,
        wSession: 0.05,
        wMagnet: 0.05,
        wSpot: 0.8,
        wFlow: 0.05,
        wPain: 0.025,
        wVwap: 0.025,
      }),
    });
    const heavyMagnet = predictEodSpot({
      ...base,
      params: clampParams({
        ...DEFAULT_FORECAST_PARAMS,
        wSession: 0.05,
        wMagnet: 0.8,
        wSpot: 0.05,
        wFlow: 0.05,
        wPain: 0.025,
        wVwap: 0.025,
      }),
    });
    expect(Number(heavySpot.close)).toBeGreaterThan(Number(heavyMagnet.close));
  });

  it("high PCR tilts the close lower", () => {
    const base = {
      last: 1000,
      bias: "RANGE" as const,
      expectedLow: 980,
      expectedHigh: 1020,
      magnet: 1000,
      params: DEFAULT_FORECAST_PARAMS,
    };
    const heavyPuts = predictEodSpot({ ...base, features: { pcr: 1.6 } });
    const heavyCalls = predictEodSpot({ ...base, features: { pcr: 0.5 } });
    expect(Number(heavyPuts.close)).toBeLessThan(Number(heavyCalls.close));
  });

  it("late session boosts spot weight toward last", () => {
    const base = {
      last: 1010,
      bias: "RANGE" as const,
      expectedLow: 980,
      expectedHigh: 1020,
      magnet: 990,
      params: DEFAULT_FORECAST_PARAMS,
    };
    const early = predictEodSpot({ ...base, features: { minutesToClose: 200 } });
    const late = predictEodSpot({ ...base, features: { minutesToClose: 20 } });
    // Late close should sit closer to last (1010) than early.
    expect(Math.abs(Number(late.close) - 1010)).toBeLessThan(Math.abs(Number(early.close) - 1010));
  });
});

describe("ledger scoring", () => {
  it("computes abs and pct error", () => {
    const scored = scorePrediction({
      predictedClose: 100,
      actualClose: 110,
      predictedDirection: "BULLISH",
      entrySpot: 100,
    });
    expect(scored.errorAbs).toBe(10);
    expect(scored.errorPct).toBeCloseTo(10);
    expect(scored.directionHit).toBe(true);
  });

  it("signed predictionErrorPct is (actual-pred)/pred", () => {
    expect(predictionErrorPct(100, 95)).toBeCloseTo(-5);
  });
});

describe("auto tuner", () => {
  it("improves MAE when true close favors higher wSpot", () => {
    const samples: TuneSample[] = [];
    for (let i = 0; i < 12; i += 1) {
      const last = 1000 + i;
      samples.push({
        last,
        bias: "RANGE",
        expectedLow: last - 20,
        expectedHigh: last + 20,
        magnet: last - 30,
        actualClose: last + 1,
      });
    }
    const start = clampParams({ ...DEFAULT_FORECAST_PARAMS, wSession: 0.45, wMagnet: 0.45, wSpot: 0.1 });
    const result = searchParams(samples, start);
    expect(result.maeAfter).toBeLessThanOrEqual(result.maeBefore);
    if (result.improved) {
      expect(result.params.wSpot).toBeGreaterThan(start.wSpot - 1e-9);
    }
  });
});

describe("param deltas", () => {
  it("diffParams captures changed keys", () => {
    const next = clampParams({ ...DEFAULT_FORECAST_PARAMS, wSpot: 0.5, wSession: 0.3, wMagnet: 0.2 });
    const delta = diffParams(DEFAULT_FORECAST_PARAMS, next);
    expect(delta.wSpot).toBeDefined();
    const applied = applyParamDelta(DEFAULT_FORECAST_PARAMS, delta);
    expect(applied.wSpot).toBeCloseTo(next.wSpot, 5);
  });
});

describe("closed gate", () => {
  it("sessionClock marks CLOSED after 15:30 IST", () => {
    const after = new Date("2026-06-15T10:05:00.000Z"); // 15:35 IST
    const clock = sessionClock(after, null);
    expect(clock.cutoff).toBe(true);
    expect(clock.label).toBe("CLOSED");
    expect(marketBlocksPaper(after)).toBe(true);
  });

  it("sessionClock is open mid-session", () => {
    const open = new Date("2026-06-15T05:00:00.000Z"); // 10:30 IST
    expect(sessionClock(open, null).cutoff).toBe(false);
    expect(marketBlocksPaper(open)).toBe(false);
  });
});
