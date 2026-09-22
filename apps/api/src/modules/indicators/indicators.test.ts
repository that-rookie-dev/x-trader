import { describe, expect, it } from "vitest";
import { adx, blackScholesIv, blackScholesPrice, bollinger, chandelierStop, donchian, ema, hv, ivRank, rsi, sma } from "./index.js";

describe("indicators", () => {
  it("computes SMA", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
  });

  it("returns null until warm-up", () => {
    expect(ema([1, 2], 9)).toBeNull();
  });

  it("computes RSI in 0-100", () => {
    const values = [44, 44.2, 44.5, 43.9, 44.8, 45.1, 45.4, 45.9, 46, 46.2, 46.5, 46.1, 46.7, 47, 47.4, 47.1];
    const value = rsi(values, 14);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(0);
    expect(value!).toBeLessThan(100);
  });

  it("computes ADX with +DI/-DI", () => {
    const up = Array.from({ length: 40 }, (_, i) => {
      const close = 100 + i * 2;
      return { high: close + 1, low: close - 1, close };
    });
    const value = adx(up, 14);
    expect(value).not.toBeNull();
    expect(value!.plusDi).toBeGreaterThan(value!.minusDi);
    expect(value!.adx).toBeGreaterThan(10);
  });

  it("computes Donchian and HV", () => {
    const bars = Array.from({ length: 25 }, (_, i) => ({ high: 110 + i, low: 90 + i, close: 100 + i }));
    const band = donchian(bars, 20);
    expect(band?.high).toBeGreaterThan(band!.low);
    const vol = hv(bars.map((b) => b.close), 20);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0);
  });

  it("computes Bollinger percent B", () => {
    const closes = Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i / 3) * 2);
    const bb = bollinger(closes, 20);
    expect(bb).not.toBeNull();
    expect(bb!.pctB).toBeGreaterThanOrEqual(0);
  });

  it("inverts Black-Scholes IV near the input vol", () => {
    const price = blackScholesPrice(100, 100, 7 / 365, 0.2, "CE");
    const iv = blackScholesIv(price, 100, 100, 7 / 365, "CE");
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(0.2, 2);
  });

  it("ranks IV and trails chandelier", () => {
    expect(ivRank(0.3, [0.1, 0.2, 0.3, 0.4])).toBe(0.75);
    expect(chandelierStop([110, 112, 108], 2, 2, "long")).toBe(108);
  });
});
