import { describe, expect, it } from "vitest";
import { optionPnl, optionRoundTrip, shortOptionMargin } from "./charges.js";
import { applyAiStudy, compareEod, eodTradeView, estimateOptionEod, pickStructureMagnet, predictEodSpot } from "./eod.js";

describe("option charges", () => {
  it("charges STT only on the sell leg and GST on brokerage plus exchange", () => {
    const trip = optionRoundTrip({ buyPremium: 100, sellPremium: 140, qty: 75 });
    expect(Number(trip.buy.stt)).toBe(0);
    expect(Number(trip.sell.stt)).toBeCloseTo(140 * 75 * 0.0015, 1);
    expect(Number(trip.buy.stamp)).toBeGreaterThan(0);
    expect(Number(trip.sell.stamp)).toBe(0);
    expect(Number(trip.total)).toBeGreaterThan(Number(trip.buy.total));
  });

  it("blocks index short margin at the 9.3% scan plus 2% exposure, above the premium", () => {
    const qty = 30;
    const spot = 62212;
    const margin = shortOptionMargin({ spot, strike: 62800, kind: "PE", qty, index: true });
    expect(margin).toBeCloseTo((0.093 + 0.02) * spot * qty, 0);
    expect(margin).toBeGreaterThan(1100 * qty);
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

  it("settles calls and puts to the same cash close when the future is far from spot", () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const now = new Date(`${today}T09:07:00+05:30`);
    const shared = { spot: 74418, eodSpot: 74402.64, expiry: today, now, futurePx: 74833 };
    const call = estimateOptionEod({ ...shared, kind: "CE", strike: 73800, premium: 1052 });
    const put = estimateOptionEod({ ...shared, kind: "PE", strike: 74500, premium: 82 });
    expect(Number(call.eodPremium)).toBeCloseTo(74402.64 - 73800, 0);
    expect(Number(put.eodPremium)).toBeCloseTo(74500 - 74402.64, 0);
    const later = new Date(now.getTime() + 2 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const withBasis = estimateOptionEod({ ...shared, kind: "CE", strike: 74500, premium: 400, expiry: later, futurePx: 75200 });
    const cashOnly = estimateOptionEod({ ...shared, kind: "CE", strike: 74500, premium: 400, expiry: later, futurePx: null });
    expect(Math.abs(Number(withBasis.eodPremium) - Number(cashOnly.eodPremium))).toBeLessThan(5);
  });
});

const OPEN = new Date("2026-06-15T04:30:00.000Z");

describe("profitable option buys", () => {
  it("buys PE below spot when the index is expected lower", () => {
    const otm = eodTradeView({
      kind: "PE",
      strike: 990,
      spot: 1000,
      eodSpot: 970,
      premium: 12,
      expiry: "2026-06-18",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
      now: OPEN,
    });
    expect(otm.mark).toBe("BUY");
    expect(otm.why).toMatch(/net ₹/i);
  });

  it("still surfaces an ITM PE when expected net clears the floor", () => {
    const itm = eodTradeView({
      kind: "PE",
      strike: 1100,
      spot: 1000,
      eodSpot: 970,
      premium: 132,
      expiry: "2026-06-18",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
      now: OPEN,
      netFloor: 50,
    });
    if (Number(itm.pnl.net) >= 50) {
      expect(itm.mark).toBe("BUY");
      expect(itm.why).toMatch(/ITM/i);
    } else {
      expect(itm.mark).toBe("NO_BUY");
    }
  });

  it("buys CE above spot when the index is expected higher", () => {
    const otm = eodTradeView({
      kind: "CE",
      strike: 1010,
      spot: 1000,
      eodSpot: 1030,
      premium: 12,
      expiry: "2026-06-18",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
      now: OPEN,
    });
    expect(otm.mark).toBe("BUY");
  });

  it("does not buy or write a CE when the close is bearish and the buy fails the floor", () => {
    const ce = eodTradeView({
      kind: "CE",
      strike: 1010,
      spot: 1000,
      eodSpot: 970,
      premium: 8,
      expiry: "2026-06-18",
      lotSize: 50,
      held: false,
      existing: "NO_BUY",
      now: OPEN,
    });
    expect(ce.mark).not.toBe("BUY");
    expect(ce.mark).not.toBe("SELL");
    expect(ce.why).toMatch(/leans PE|not expected to pay|does not cover|under/i);
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
    expect(compareEod(23340, 23320, "BEARISH", "BEARISH")).toMatchObject({
      tag: "ALIGNED",
      hint: expect.stringMatching(/same direction/),
    });
    expect(compareEod(23340, 23420, "BEARISH", "BEARISH")).toMatchObject({
      tag: "LEAN",
      hint: expect.stringMatching(/same direction · small gap/),
    });
    expect(compareEod(23340, 23500, "BEARISH", "BEARISH")).toMatchObject({
      tag: "STRETCH",
      hint: expect.stringMatching(/wider targets/),
    });
    expect(compareEod(23340, 23380, "BEARISH", "BULLISH")).toMatchObject({
      tag: "MIXED",
      hint: expect.stringMatching(/different direction · closes near/),
    });
    expect(compareEod(23340, 23600, "BEARISH", "BULLISH")).toMatchObject({
      tag: "OPPOSED",
      hint: expect.stringMatching(/different direction/),
      agree: false,
    });
  });
});
