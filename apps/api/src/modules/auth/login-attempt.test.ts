import { describe, expect, it } from "vitest";
import { CryptoService } from "../../security/crypto.js";

describe("login attempt hashing", () => {
  const crypto = new CryptoService({
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 9).toString("base64"),
    TOKEN_ENCRYPTION_KEY_VERSION: 1,
  } as never);

  it("does not treat different nonces as equal", () => {
    const a = crypto.hash("nonce-a");
    const b = crypto.hash("nonce-b");
    expect(a).not.toBe(b);
    expect(crypto.safeEqual(a, a)).toBe(true);
    expect(crypto.safeEqual(a, b)).toBe(false);
  });
});
