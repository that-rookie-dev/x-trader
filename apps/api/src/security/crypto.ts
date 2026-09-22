import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env.js";

export interface EncryptedBlob {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
}

export class CryptoService {
  private readonly key: Buffer;

  constructor(private readonly env: Env) {
    this.key = Buffer.from(env.TOKEN_ENCRYPTION_KEY_BASE64, "base64");
  }

  encrypt(plaintext: string): EncryptedBlob {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion: this.env.TOKEN_ENCRYPTION_KEY_VERSION,
    };
  }

  decrypt(blob: EncryptedBlob): string {
    if (blob.keyVersion !== this.env.TOKEN_ENCRYPTION_KEY_VERSION) {
      throw new Error("TOKEN_KEY_VERSION_MISMATCH");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(blob.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
