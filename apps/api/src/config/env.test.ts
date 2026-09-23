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
    expect(env.API_PORT).toBe(4000);
    expect(env.MARKET_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("ignores legacy AGENT_MODE / EXECUTION_MODE without failing", () => {
    const env = parseEnv({ ...base, AGENT_MODE: "AUTO", EXECUTION_MODE: "LIVE", LIVE_TRADING_ENABLED: "true" });
    expect(env.AGENT_MODE).toBe("AUTO");
    expect(env.EXECUTION_MODE).toBe("LIVE");
    expect(env.LIVE_TRADING_ENABLED).toBe(true);
  });
});
