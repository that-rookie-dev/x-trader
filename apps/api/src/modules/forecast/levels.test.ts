import { describe, expect, it } from "vitest";
import { biasFromTrend, buildSuggestions, collectFnoNames, confidenceFrom, pickExpiringDesk, sessionLevels, structureLevels, underlyingFnoName } from "./levels.js";

describe("forecast levels", () => {
  it("builds a session band around last and ATR", () => {
    const band = sessionLevels(1000, 10);
    expect(Number(band.expectedLow)).toBeLessThan(1000);
    expect(Number(band.expectedHigh)).toBeGreaterThan(1000);
    expect(band.magnet).toBe("1000.00");
  });

  it("reads prior-day pivots and swing highs/lows as support and resistance", () => {
    const map = structureLevels({
      last: 1000,
      atr: 12,
      candles: [
        { high: 990, low: 960, close: 980 },
        { high: 1015, low: 970, close: 1005 },
        { high: 1008, low: 982, close: 996 },
        { high: 1022, low: 988, close: 1010 },
        { high: 1006, low: 974, close: 998 },
      ],
    });
    expect(map.priorHigh).toBe(1022);
    expect(map.priorLow).toBe(988);
    expect(map.supports.some((n) => Number(n) <= 1000)).toBe(true);
    expect(map.resistances.some((n) => Number(n) >= 1000)).toBe(true);
    expect(map.pivot).toBeGreaterThan(990);
  });

  it("reads trend bias from moving averages", () => {
    expect(biasFromTrend(110, 100, 90, 58)).toBe("BULLISH");
    expect(biasFromTrend(90, 100, 110, 40)).toBe("BEARISH");
    expect(biasFromTrend(100, 100, 100, 50)).toBe("RANGE");
  });

  it("raises confidence when history and news agree", () => {
    const aligned = confidenceFrom({ bias: "BULLISH", newsScore: 0.5, rsi: 55, historyBars: 50 });
    const conflicted = confidenceFrom({ bias: "BULLISH", newsScore: -0.5, rsi: 55, historyBars: 10 });
    expect(aligned).toBeGreaterThan(conflicted);
  });

  it("maps index names onto NFO underlyings", () => {
    expect(underlyingFnoName("NIFTY 50")).toBe("NIFTY");
    expect(underlyingFnoName("NIFTY BANK")).toBe("BANKNIFTY");
    expect(underlyingFnoName("NIFTY FIN SERVICE")).toBe("FINNIFTY");
    expect(underlyingFnoName("NIFTY MID SELECT")).toBe("MIDCPNIFTY");
    expect(underlyingFnoName("NIFTY NXT 50")).toBe("NIFTYNXT50");
    expect(underlyingFnoName("SENSEX")).toBe("SENSEX");
    expect(underlyingFnoName("RELIANCE")).toBe("RELIANCE");
  });

  it("lists every live F&O name with indexes first", () => {
    const names = collectFnoNames(
      [
        { name: "RELIANCE", instrumentType: "CE", expiry: "2026-09-29" },
        { name: "BANKNIFTY", instrumentType: "PE", expiry: "2026-09-22" },
        { name: "NIFTY", instrumentType: "CE", expiry: "2026-09-22" },
        { name: "SBIN", instrumentType: "CE", expiry: "2026-09-29" },
        { name: "EXPIRED", instrumentType: "CE", expiry: "2020-01-01" },
        { name: "FUTONLY", instrumentType: "FUT", expiry: "2026-09-29" },
      ],
      "2026-09-22",
    );
    expect(names.map((n) => n.fno)).toEqual(["NIFTY", "BANKNIFTY", "RELIANCE", "SBIN"]);
    expect(names[0]).toMatchObject({ symbol: "NIFTY 50", exchange: "NSE", kind: "INDEX", nextExpiry: "2026-09-22" });
    expect(names[1]).toMatchObject({ symbol: "NIFTY BANK", kind: "INDEX", nextExpiry: "2026-09-22" });
  });

  it("opens the index that expires today, else the soonest index", () => {
    const names = collectFnoNames(
      [
        { name: "NIFTY", instrumentType: "CE", expiry: "2026-09-29" },
        { name: "BANKNIFTY", instrumentType: "PE", expiry: "2026-09-23" },
        { name: "SENSEX", instrumentType: "CE", expiry: "2026-09-25" },
        { name: "RELIANCE", instrumentType: "CE", expiry: "2026-09-22" },
      ],
      "2026-09-23",
    );
    expect(pickExpiringDesk(names, "2026-09-23")).toMatchObject({ fno: "BANKNIFTY", nextExpiry: "2026-09-23" });
    expect(pickExpiringDesk(names, "2026-09-22")).toMatchObject({ fno: "BANKNIFTY", nextExpiry: "2026-09-23" });
  });

  it("picks CE on bullish and PE on bearish maps", () => {
    const bull = buildSuggestions({
      symbol: "HDFCBANK",
      instrumentType: "EQUITY",
      bias: "BULLISH",
      confidence: 0.8,
      last: 740,
      sma20: 714,
      sma50: 700,
      future: "HDFCBANK26SEPFUT",
      call: "HDFCBANK26SEP740CE",
      put: "HDFCBANK26SEP740PE",
      expiry: "2026-09-29",
    });
    expect(bull.find((i) => i.kind === "CE")?.action).toBe("BUY");
    expect(bull.find((i) => i.kind === "CE")?.exit).toMatch(/Sell the CE/);
    expect(bull.find((i) => i.kind === "PE")?.action).toBe("SKIP");
    expect(bull.find((i) => i.lane === "CASH")?.action).toBe("BUY");

    const bear = buildSuggestions({
      symbol: "RELIANCE",
      instrumentType: "EQUITY",
      bias: "BEARISH",
      confidence: 0.7,
      last: 1246,
      sma20: 1281,
      sma50: 1300,
      future: "RELIANCE26SEPFUT",
      call: "RELIANCE26SEP1250CE",
      put: "RELIANCE26SEP1250PE",
      expiry: "2026-09-29",
    });
    expect(bear.find((i) => i.kind === "PE")?.action).toBe("BUY");
    expect(bear.find((i) => i.kind === "CE")?.action).toBe("SKIP");
    expect(bear.find((i) => i.lane === "CASH")?.action).toBe("AVOID");
  });

  it("sells an extended call and picks long-term cash when SMA200 is stacked", () => {
    const sell = buildSuggestions({
      symbol: "NIFTY 50",
      instrumentType: "INDEX",
      bias: "BULLISH",
      confidence: 0.8,
      last: 23500,
      sma20: 23200,
      sma50: 23000,
      rsi: 76,
      liveBreak: "DOWN",
      future: "NIFTY26SEPFUT",
      call: "NIFTY26SEP23400CE",
      put: "NIFTY26SEP23400PE",
      expiry: "2026-09-29",
      callPx: "120",
    });
    expect(sell.find((i) => i.kind === "CE")?.action).toBe("SELL");

    const growth = buildSuggestions({
      symbol: "HDFCBANK",
      instrumentType: "EQUITY",
      bias: "BULLISH",
      confidence: 0.7,
      last: 740,
      sma20: 720,
      sma50: 700,
      sma200: 640,
      ret6m: 0.12,
      ret12m: 0.22,
      newsScore: 0.2,
      future: null,
      call: null,
      put: null,
      expiry: null,
    });
    expect(growth.find((i) => i.lane === "CASH")?.action).toBe("BUY");
    expect(growth.find((i) => i.lane === "CASH")?.why).toMatch(/Long-term growth/);
  });
});
