import { describe, expect, it } from "vitest";
import { fillStatus, holdUntilAt, matchBrokerOrder, shouldExpire, shouldMiss } from "./plays.js";

describe("play reconcile", () => {
  const at = new Date("2026-06-15T04:00:00.000Z");
  const hold = new Date("2026-06-15T09:45:00.000Z");

  it("matches a filled Zerodha order on the same contract", () => {
    const hit = matchBrokerOrder(
      { contract: "NIFTY25619C25000", at, holdUntil: hold },
      [
        {
          brokerOrderId: "1",
          status: "COMPLETE",
          exchange: "NFO",
          symbol: "NIFTY25619C25000",
          quantity: 75,
          filledQuantity: 75,
          pendingQuantity: 0,
          averagePrice: "120.00",
          transactionType: "BUY",
          orderTimestamp: "2026-06-15T04:10:00.000Z",
        },
      ],
      new Date("2026-06-15T04:20:00.000Z"),
    );
    expect(hit?.brokerOrderId).toBe("1");
    expect(fillStatus(hit!)).toBe("FILLED");
  });

  it("ignores a sell or an empty fill", () => {
    expect(
      matchBrokerOrder(
        { contract: "NIFTY25619C25000", at, holdUntil: hold },
        [
          {
            brokerOrderId: "2",
            status: "COMPLETE",
            exchange: "NFO",
            symbol: "NIFTY25619C25000",
            quantity: 75,
            filledQuantity: 0,
            pendingQuantity: 75,
            transactionType: "BUY",
          },
        ],
        new Date("2026-06-15T04:20:00.000Z"),
      ),
    ).toBeNull();
  });

  it("expires open plays at cutoff or holdUntil", () => {
    expect(shouldExpire({ status: "OPEN", holdUntil: hold }, new Date("2026-06-15T09:50:00.000Z"), false)).toBe(true);
    expect(shouldExpire({ status: "OPEN", holdUntil: hold }, new Date("2026-06-15T04:10:00.000Z"), true)).toBe(true);
    expect(shouldExpire({ status: "DISMISSED", holdUntil: hold }, new Date("2026-06-15T09:50:00.000Z"), true)).toBe(false);
  });

  it("marks missed after the window", () => {
    expect(shouldMiss({ status: "DISMISSED", at, holdUntil: hold, dismissedAt: at }, new Date("2026-06-15T12:00:00.000Z"))).toBe(true);
    expect(shouldMiss({ status: "OPEN", at, holdUntil: hold }, new Date("2026-06-15T04:10:00.000Z"))).toBe(false);
  });

  it("builds a session hold-until on the IST clock", () => {
    const until = holdUntilAt("session", null, new Date("2026-06-15T04:00:00.000Z"));
    expect(until.toISOString()).toContain("2026-06-15");
  });
});
