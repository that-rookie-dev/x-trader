import { describe, expect, it } from "vitest";
import { isOpencodeFamily, opencodeSessionId, usesOpencodeAnthropicWire } from "./opencode-route.js";

describe("OpenCode Go routing", () => {
  it("sends MiniMax/Qwen on the Anthropic messages wire", () => {
    expect(usesOpencodeAnthropicWire("opencode", "minimax-m3")).toBe(true);
    expect(usesOpencodeAnthropicWire("opencode", "qwen3.7-plus")).toBe(true);
    expect(usesOpencodeAnthropicWire("opencode", "glm-5.2")).toBe(false);
    expect(usesOpencodeAnthropicWire("opencode-zen", "minimax-m3")).toBe(false);
  });

  it("builds a stable session header per profile", () => {
    expect(isOpencodeFamily("opencode")).toBe(true);
    expect(opencodeSessionId("e4d78e49-c9b5-4b30-8cc5-97c0b5d444dc")).toMatch(/^xtrader-/);
  });
});
