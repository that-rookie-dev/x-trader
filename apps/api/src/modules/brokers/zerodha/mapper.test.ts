import { describe, expect, it } from "vitest";
import { mapFunds, mapHoldings, mapPositions } from "./auth-service.js";

describe("zerodha mappers", () => {
  it("maps funds without leaking unknowns as zero silently when missing segments", () => {
    const funds = mapFunds({
      equity: { net: 120000.5, available: { live_balance: 110000, cash: 100000, collateral: 0 }, utilised: { debits: 1500 } },
    });
    expect(funds.equity.available).toBe("110000.00");
    expect(funds.equity.usedMargin).toBe("1500.00");
    expect(funds.asOf).toBeTruthy();
  });

  it("maps empty holdings", () => {
    expect(mapHoldings([])).toEqual([]);
  });

  it("filters flat positions", () => {
    const mapped = mapPositions({
      net: [
        { exchange: "NSE", tradingsymbol: "RELIANCE", quantity: 0, average_price: 0, product: "CNC" },
        { exchange: "NSE", tradingsymbol: "INFY", quantity: 10, average_price: 1400, last_price: 1410, pnl: 100, product: "CNC" },
      ],
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.instrument.symbol).toBe("INFY");
  });
});
