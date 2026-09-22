import { describe, expect, it } from "vitest";
import { optionPnl, optionRoundTrip } from "./charges.js";
import { applyAiStudy, compareEod, eodTradeView, estimateOptionEod, pickStructureMagnet, predictEodSpot } from "./eod.js";

describe("option charges", () => {
  it("charges STT only on the sell leg and GST on brokerage plus exchange", () => {
    const trip = optionRoundTrip({ buyPremium: 100, sellPremium: 140, qty: 75 });
    expect(Number(trip.buy.stt)).toBe(0);
    expect(Number(trip.sell.stt)).toBeGreaterThan(0);
    expect(Number(trip.buy.stamp)).toBeGreaterThan(0);
    expect(Number(trip.sell.stamp)).toBe(0);
    expect(Number(trip.total)).toBeGreaterThan(Number(trip.buy.total));
  });

  it("nets premium gain minus round-trip charges", () => {
    const pnl = optionPnl({ entry: 100, exit: 140, qty: 75 });
    expect(Number(pnl.gross)).toBe(3000);
    expect(Number(pnl.net)).toBeLessThan(3000);
    expect(Number(pnl.net)).toBeGreaterThan(2500);
  });
});

describe("EOD option estimate", () => {
  it("pulls a bearish close toward the low of the band", () => {
    const eod = predictEodSpot({ last: 1000, bias: "BEARISH", expectedLow: 980, expectedHigh: 1020, magnet: 1000 });
    expect(Number(eod.close)).toBeLessThan(1005);
  });

  it("uses the next support as the EOD magnet on a down close", () => {
    expect(
      pickStructureMagnet({
        last: 1000,
        bias: "BEARISH",
        expectedLow: 980,
        expectedHigh: 1020,
        magnet: 1000,
        supports: [988, 970],
        resistances: [1012, 1030],
      }),
    ).toBe(988);
    const withLevel = predictEodSpot({
      last: 1000,
      bias: "BEARISH",
      expectedLow: 980,
      expectedHigh: 1020,
      magnet: 1000,
      supports: [988],
      resistances: [1012],
    });
    const plain = predictEodSpot({ last: 1000, bias: "BEARISH", expectedLow: 980, expectedHigh: 1020, magnet: 1000 });
    expect(Number(withLevel.close)).toBeLessThan(Number(plain.close));
    expect(withLevel.note).toMatch(/988/);
  });

  it("collapses time value on expiry day and keeps CE intrinsic", () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const est = estimateOptionEod({
      kind: "CE",
      strike: 100,
      spot: 100,
      eodSpot: 110,
      premium: 4,
      expiry: today,
    });
    expect(Number(est.eodPremium)).toBeGreaterThan(9);
    expect(est.moneyness).toBe("ITM");
  });
});

describe("cheap-side option buys", () => {
  it("buys PE below spot when the index is expected lower, not ITM PE above spot", () => {
    const otm = eodTradeView({
      kind: "PE",
      strike: 990,
      spot: 1000,
      eodSpot: 970,
      premium: 12,
      expiry: "2099-01-01",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
    });
    const itm = eodTradeView({
      kind: "PE",
      strike: 1100,
      spot: 1000,
      eodSpot: 970,
      premium: 132,
      expiry: "2099-01-01",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
    });
    expect(otm.mark).toBe("BUY");
    expect(itm.mark).toBe("NO_BUY");
    expect(itm.why).toMatch(/below the index/i);
  });

  it("buys CE above spot when the index is expected higher, not ITM CE", () => {
    const otm = eodTradeView({
      kind: "CE",
      strike: 1010,
      spot: 1000,
      eodSpot: 1030,
      premium: 12,
      expiry: "2099-01-01",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
    });
    const itm = eodTradeView({
      kind: "CE",
      strike: 900,
      spot: 1000,
      eodSpot: 1030,
      premium: 105,
      expiry: "2099-01-01",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
    });
    expect(otm.mark).toBe("BUY");
    expect(itm.mark).toBe("NO_BUY");
  });

  it("does not buy CE on a bearish close", () => {
    const ce = eodTradeView({
      kind: "CE",
      strike: 1010,
      spot: 1000,
      eodSpot: 970,
      premium: 8,
      expiry: "2099-01-01",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
    });
    expect(ce.mark).toBe("NO_BUY");
    expect(ce.why).toMatch(/PE below spot/i);
  });
});

describe("AI study close clamp", () => {
  it("clamps a hallucinated close back into the session band", () => {
    const priced = applyAiStudy({
      last: 1000,
      expectedLow: 980,
      expectedHigh: 1020,
      magnet: 1000,
      direction: "BEARISH",
      pull: 0.25,
      closeHint: 1400,
    });
    expect(Number(priced.close)).toBeLessThan(1040);
    expect(Number(priced.close)).toBeGreaterThan(960);
  });

  it("labels algo vs AI closeness", () => {
    expect(compareEod(23340, 23320, "BEARISH", "BEARISH")).toMatchObject({ tag: "MATCH", hint: "same call" });
    expect(compareEod(23340, 23420, "BEARISH", "BEARISH")).toMatchObject({ tag: "NEAR", hint: "same side" });
    expect(compareEod(23340, 23500, "BEARISH", "BEARISH")).toMatchObject({ tag: "WIDE", hint: "same side, gap" });
    expect(compareEod(23340, 23380, "BEARISH", "BULLISH")).toMatchObject({ tag: "SPLIT", hint: "mixed view" });
    expect(compareEod(23340, 23600, "BEARISH", "BULLISH")).toMatchObject({ tag: "CLASH", hint: "opposite call", agree: false });
  });
});
