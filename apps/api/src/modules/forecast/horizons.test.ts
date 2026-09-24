import { describe, expect, it } from "vitest";
import { buildHorizons, horizonSpot, horizonTarget } from "./horizons.js";

describe("horizons", () => {
  const morning = new Date("2026-09-24T04:00:00.000Z");

  it("clamps a horizon that would land after the cash close", () => {
    const late = new Date("2026-09-24T09:20:00.000Z");
    const target = horizonTarget(late, "4h");
    expect(target.clamped).toBe(true);
    expect(target.label).toBe("EOD");
    expect(target.at.toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });

  it("walks spot only part of the way to the close on a short horizon", () => {
    const spot = horizonSpot({
      last: 100,
      eodClose: 110,
      eodLow: 98,
      eodHigh: 112,
      minutesToTarget: 15,
      minutesToClose: 150,
    });
    expect(spot.close).toBeCloseTo(101, 5);
    expect(spot.high).toBeGreaterThan(spot.close);
    expect(spot.low).toBeLessThan(spot.close);
  });

  it("keeps a short horizon on the same side as the close and raises its cost hurdle", () => {
    const rows = buildHorizons({
      now: morning,
      last: 1000,
      eodClose: 990,
      eodLow: 980,
      eodHigh: 1010,
    });
    const five = rows.find((row) => row.id === "5m")!;
    const hour = rows.find((row) => row.id === "1h")!;
    expect(Number(five.close)).toBeGreaterThan(Number(hour.close));
    expect(Number(hour.close)).toBeGreaterThan(990);
    expect(five.floorScale).toBe(2);
    expect(rows.find((row) => row.id === "30m")!.floorScale).toBe(1);
    expect(rows.find((row) => row.id === "eod")!.label).toBe("EOD");
    expect(five.label).not.toBe("EOD");
  });

  it("abstains when the short tape and the hour path point opposite ways", () => {
    const rows = buildHorizons({
      now: morning,
      last: 1000,
      eodClose: 1100,
      eodLow: 990,
      eodHigh: 1120,
      vwap: 900,
    });
    expect(rows.find((row) => row.id === "5m")!.abstain).toBe(true);
    expect(rows.find((row) => row.id === "1h")!.abstain).toBe(false);
    expect(rows.find((row) => row.id === "15m")!.label.startsWith("by ")).toBe(true);
  });
});
