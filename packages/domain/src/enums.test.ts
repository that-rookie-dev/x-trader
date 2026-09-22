import { describe, expect, it } from "vitest";
import { normalizeAgentMode } from "./enums.js";

describe("normalizeAgentMode", () => {
  it("maps legacy names onto Copilot/Auto", () => {
    expect(normalizeAgentMode("MANUAL")).toBe("COPILOT");
    expect(normalizeAgentMode("COPILOT")).toBe("COPILOT");
    expect(normalizeAgentMode("AUTONOMOUS")).toBe("AUTO");
    expect(normalizeAgentMode("AUTO")).toBe("AUTO");
  });
});
