import { describe, expect, it } from "vitest";
import { newsScoreFromText } from "./service.js";

describe("newsScoreFromText", () => {
  it("scores bullish vs bearish language", () => {
    expect(newsScoreFromText("upgrade profit beat rally")).toBeGreaterThan(0);
    expect(newsScoreFromText("crash loss downgrade slump")).toBeLessThan(0);
    expect(newsScoreFromText("calendar holiday notice")).toBe(0);
  });
});
