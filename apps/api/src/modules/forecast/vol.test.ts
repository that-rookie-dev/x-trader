import { describe, expect, it } from "vitest";
import { adxAgainstKind, invertAtmIv, preferBuyPremium, richPremium, yearsToExpiry } from "./vol.js";
import { blackScholesPrice } from "../indicators/index.js";

describe("vol gates", () => {
  it("inverts ATM CE/PE mid to a usable IV", () => {
    const now = new Date("2026-06-15T04:30:00.000Z");
    const t = yearsToExpiry("2026-06-22", now);
    const call = blackScholesPrice(25000, 25000, t, 0.12, "CE");
    const put = blackScholesPrice(25000, 25000, t, 0.12, "PE");
    const iv = invertAtmIv({ spot: 25000, strike: 25000, expiry: "2026-06-22", callMid: call, putMid: put, now });
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(0.12, 1);
  });

  it("flags rich premium and cheap premium", () => {
    expect(richPremium(0.3, 0.2)).toBe(true);
    expect(preferBuyPremium(0.15, 0.2)).toBe(true);
    expect(richPremium(null, 0.2)).toBe(false);
  });

  it("blocks CE against a strong down ADX", () => {
    expect(adxAgainstKind({ adx: 32, plusDi: 12, minusDi: 28 }, "CE")).toBe(true);
    expect(adxAgainstKind({ adx: 32, plusDi: 12, minusDi: 28 }, "PE")).toBe(false);
    expect(adxAgainstKind({ adx: 12, plusDi: 10, minusDi: 14 }, "CE")).toBe(false);
  });

  it("keeps a minimum year fraction on expiry", () => {
    expect(yearsToExpiry("1990-01-01")).toBeGreaterThan(0);
  });
});
