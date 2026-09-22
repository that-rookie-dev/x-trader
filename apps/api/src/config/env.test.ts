import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  const base = {
    SESSION_SECRET: "session-secret-key-16",
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
  };

  it("fails when encryption key is the wrong length", () => {
    expect(() => parseEnv({ ...base, TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(16, 1).toString("base64") })).toThrow(
      /32 bytes/,
    );
  });

  it("accepts empty kite keys (login will fail later)", () => {
    const env = parseEnv(base);
    expect(env.EXECUTION_MODE).toBe("PAPER");
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.AGENT_MODE).toBe("COPILOT");
  });

  it("maps legacy AGENT_MODE values", () => {
    expect(parseEnv({ ...base, AGENT_MODE: "AUTONOMOUS" }).AGENT_MODE).toBe("AUTO");
    expect(parseEnv({ ...base, AGENT_MODE: "MANUAL" }).AGENT_MODE).toBe("COPILOT");
  });
});
