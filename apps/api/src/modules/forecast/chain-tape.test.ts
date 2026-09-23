import { describe, expect, it } from "vitest";
import { buyNetFloor, liquidEnough, mapInvalidated, maxPain, notableMarkChange, putCallRatio, sessionClock } from "./chain-tape.js";
import { eodTradeView } from "./eod.js";

const OPEN = new Date("2026-06-15T04:30:00.000Z"); // 10:00 IST
const CLOSING = new Date("2026-06-15T09:50:00.000Z"); // 15:20 IST
const AFTER_CLOSE = new Date("2026-06-15T10:05:00.000Z"); // 15:35 IST
const EXPIRY_AFTERNOON = new Date("2026-06-15T08:05:00.000Z"); // 13:35 IST

describe("session clock", () => {
  it("is open at 10:00 IST until 15:30", () => {
    const clock = sessionClock(OPEN, "2099-01-01");
    expect(clock.cutoff).toBe(false);
    expect(clock.closingSoon).toBe(false);
    expect(clock.netFloor).toBe(150);
    expect(clock.label).toBe("UNTIL 15:30");
  });

  it("flags the last 15 minutes before the close bell", () => {
    const clock = sessionClock(CLOSING, "2099-01-01");
    expect(clock.cutoff).toBe(false);
    expect(clock.closingSoon).toBe(true);
    expect(clock.label).toBe("LAST 15M");
  });

  it("closes new entries only after 15:30 IST", () => {
    expect(sessionClock(AFTER_CLOSE, "2099-01-01").cutoff).toBe(true);
    expect(sessionClock(AFTER_CLOSE, "2099-01-01").label).toBe("CLOSED");
  });

  it("does not use an early expiry-day cutoff", () => {
    const clock = sessionClock(EXPIRY_AFTERNOON, "2026-06-15");
    expect(clock.cutoff).toBe(false);
    expect(clock.label).toBe("UNTIL 15:30");
  });
});

describe("microstructure", () => {
  it("computes PCR and max pain", () => {
    expect(putCallRatio(100, 80)).toBe(0.8);
    expect(putCallRatio(0, 0)).toBeNull();
    expect(
      maxPain([
        { strike: 100, ceOi: 10, peOi: 40 },
        { strike: 110, ceOi: 30, peOi: 10 },
        { strike: 120, ceOi: 50, peOi: 5 },
      ]),
    ).toBe(110);
  });

  it("treats unknown depth as liquid and zero tape as dead", () => {
    expect(liquidEnough()).toBe(true);
    expect(liquidEnough(0, 0)).toBe(false);
    expect(liquidEnough(1200, 0)).toBe(true);
    expect(liquidEnough(0, 40, 10, 14)).toBe(false);
  });
});

describe("gates", () => {
  it("invalidates a bullish map when spot breaks the low", () => {
    expect(mapInvalidated("BULLISH", 990, 1000, 1020)).toBe(true);
    expect(mapInvalidated("BULLISH", 1005, 1000, 1020)).toBe(false);
  });

  it("raises the net floor after a paper loss streak", () => {
    expect(buyNetFloor({ cutoff: false, closingSoon: false, netFloor: 150, label: "UNTIL 15:30", expiryToday: false }, true)).toBe(250);
  });

  it("only records notable mark flips", () => {
    expect(notableMarkChange(null, "NO_BUY")).toBe(false);
    expect(notableMarkChange(null, "BUY")).toBe(true);
    expect(notableMarkChange("BUY", "NO_BUY")).toBe(true);
    expect(notableMarkChange("NO_BUY", "NO_BUY")).toBe(false);
    expect(notableMarkChange("BUY", "BUY")).toBe(false);
  });
});

describe("eodTradeView gates", () => {
  const base = {
    kind: "PE" as const,
    strike: 990,
    spot: 1000,
    eodSpot: 970,
    premium: 12,
    expiry: "2099-01-01",
    lotSize: 50,
    held: false,
    existing: "NO_BUY" as const,
  };

  it("keeps BUY marks through the last 15 minutes", () => {
    const view = eodTradeView({ ...base, now: CLOSING });
    expect(view.mark).toBe("BUY");
    expect(view.why).not.toMatch(/closed|cutoff/i);
  });

  it("blocks new entries only after the close bell", () => {
    const view = eodTradeView({ ...base, now: AFTER_CLOSE });
    expect(view.mark).toBe("CLOSED");
    expect(view.why).toMatch(/closed/i);
    expect(view.why).toMatch(/would BUY/i);
  });

  it("kills a buy when there is no tape", () => {
    const view = eodTradeView({ ...base, now: OPEN, oi: 0, volume: 0 });
    expect(view.mark).toBe("NO_BUY");
    expect(view.why).toMatch(/no tape/i);
  });

  it("kills a buy when IV is rich versus HV", () => {
    const view = eodTradeView({ ...base, now: OPEN, richIv: true });
    expect(view.mark).toBe("NO_BUY");
    expect(view.why).toMatch(/rich/i);
  });

  it("kills a buy when the map is invalidated", () => {
    const view = eodTradeView({
      ...base,
      now: OPEN,
      bias: "BEARISH",
      expectedLow: 980,
      expectedHigh: 1010,
      spot: 1020,
    });
    expect(view.mark).toBe("NO_BUY");
    expect(view.why).toMatch(/invalidated/i);
  });
});
