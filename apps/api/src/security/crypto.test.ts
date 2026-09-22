import { describe, expect, it } from "vitest";
import { CryptoService } from "./crypto.js";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("CryptoService", () => {
  const crypto = new CryptoService({
    TOKEN_ENCRYPTION_KEY_BASE64: KEY,
    TOKEN_ENCRYPTION_KEY_VERSION: 1,
  } as never);

  it("round-trips encryption", () => {
    const blob = crypto.encrypt("access-token-secret");
    expect(blob.ciphertext).not.toContain("access-token");
    expect(crypto.decrypt(blob)).toBe("access-token-secret");
  });

  it("detects tampering", () => {
    const blob = crypto.encrypt("abc");
    blob.ciphertext = Buffer.from("ffff", "hex").toString("base64");
    expect(() => crypto.decrypt(blob)).toThrow();
  });
});
