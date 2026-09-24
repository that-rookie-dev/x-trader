import { describe, expect, it } from "vitest";
import { pickPaperBuy, shouldCutLong } from "./paper-autopilot.js";

describe("paper autopilot loss limits", () => {
  it("picks the buy with the highest positive edge and skips a fight with the AI", () => {
    const best = pickPaperBuy(
      [
        { contract: "A", edge: "200" },
        { contract: "B", edge: "900" },
        { contract: "C", edge: "-50" },
      ],
      "ALIGNED",
    );
    expect(best?.contract).toBe("B");
    expect(pickPaperBuy([{ contract: "A", edge: "900" }], "OPPOSED")).toBeNull();
    expect(pickPaperBuy([{ contract: "A", edge: "400" }], "")?.contract).toBe("A");
  });

  it("cuts a long once premium or rupees breach the cap, and holds a working buy", () => {
    expect(shouldCutLong({ entry: 100, last: 74, unrealised: -100, mark: "BUY", cutoff: false })).toBe("PREMIUM_STOP");
    expect(shouldCutLong({ entry: 100, last: 90, unrealised: -2000, mark: "BUY", cutoff: false })).toBe("RUPEE_STOP");
    expect(shouldCutLong({ entry: 100, last: 110, unrealised: 200, mark: "NO_BUY", cutoff: false })).toBe("MARK_LEFT");
    expect(shouldCutLong({ entry: 100, last: 110, unrealised: 200, mark: "BUY", cutoff: false })).toBeNull();
    expect(
      shouldCutLong({
        entry: 100,
        last: 110,
        unrealised: 200,
        mark: "BUY",
        cutoff: false,
        targetAt: "2026-09-24T04:15:00.000Z",
        now: new Date("2026-09-24T04:15:00.000Z"),
      }),
    ).toBe("HORIZON");
  });
});
