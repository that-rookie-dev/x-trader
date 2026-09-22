import { describe, expect, it } from "vitest";
import { ema, rsi, sma } from "./index.js";

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
});
