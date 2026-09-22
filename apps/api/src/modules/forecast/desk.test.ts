import { describe, expect, it } from "vitest";
import { isHeld, markContract, visibleIdeas } from "./desk.js";
import type { Idea } from "./levels.js";

function idea(partial: Partial<Idea> & Pick<Idea, "action" | "contract">): Idea {
  return {
    lane: "CASH",
    kind: "EQ",
    exchange: "NSE",
    why: "test",
    until: null,
    ...partial,
  };
}

describe("desk sell filter", () => {
  it("hides sell unless the account already holds the name", () => {
    const held = new Set(["RELIANCE", "NSE:RELIANCE"]);
    const shown = visibleIdeas(
      [
        idea({ action: "BUY", contract: "INFY" }),
        idea({ action: "SELL", contract: "RELIANCE" }),
        idea({ action: "SELL", contract: "TCS" }),
        idea({ action: "WAIT", contract: "HDFCBANK" }),
      ],
      held,
      new Set(["RELIANCE"]),
      "CASH",
    );
    expect(shown.map((row) => row.contract)).toEqual(["INFY", "RELIANCE"]);
    expect(shown[1]?.canPaper).toBe(true);
  });

  it("marks CE/PE buy vs no-buy and hides sell unless held", () => {
    const ideas: Idea[] = [
      idea({ lane: "FNO", kind: "PE", action: "BUY", contract: "NIFTY26SEP23450PE", exchange: "NFO" }),
      idea({ lane: "FNO", kind: "CE", action: "SKIP", contract: "NIFTY26SEP23450CE", exchange: "NFO" }),
      idea({ lane: "FNO", kind: "PE", action: "SELL", contract: "RELIANCE26SEP1250PE", exchange: "NFO" }),
    ];
    const held = new Set<string>();
    const paper = new Set<string>();
    expect(markContract(ideas, held, paper, "NIFTY26SEP23450PE", "PE").mark).toBe("BUY");
    expect(markContract(ideas, held, paper, "NIFTY26SEP23450CE", "CE").mark).toBe("NO_BUY");
    expect(markContract(ideas, held, paper, "RELIANCE26SEP1250PE", "PE").mark).toBe("NO_BUY");
    expect(markContract(ideas, new Set(["RELIANCE26SEP1250PE"]), paper, "RELIANCE26SEP1250PE", "PE").mark).toBe("SELL");
  });

  it("matches held contracts with exchange prefixes", () => {
    expect(isHeld(new Set(["NSE:NIFTY26SEP25000CE"]), "NIFTY26SEP25000CE", "NFO")).toBe(true);
    expect(isHeld(new Set(["INFY"]), "TCS")).toBe(false);
  });
});
