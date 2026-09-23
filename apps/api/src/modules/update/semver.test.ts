import { describe, expect, it } from "vitest";
import { compareSemver, isNewer, normalizeTag } from "./semver.js";

describe("semver", () => {
  it("normalizes v prefix", () => {
    expect(normalizeTag("v1.2.3")).toBe("1.2.3");
  });

  it("orders dotted versions", () => {
    expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
    expect(compareSemver("0.2.0", "0.1.9")).toBe(1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
  });

  it("detects newer tags", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.0.9", "0.1.0")).toBe(false);
  });
});
