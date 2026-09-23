import { eq } from "drizzle-orm";
import { AppError } from "@xtrader/domain";
import type { Database } from "../../../db/client.js";
import { appSettings } from "../../../db/schema.js";
import type { CryptoService, EncryptedBlob } from "../../../security/crypto.js";
import type { Env } from "../../../config/env.js";

export type KiteCreds = { apiKey: string; apiSecret: string };

export type KiteCredsStatus = {
  configured: boolean;
  apiKeyHint: string | null;
  configuredAt: string | null;
};

function asBlob(raw: unknown): EncryptedBlob | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.ciphertext !== "string" || typeof o.nonce !== "string" || typeof o.authTag !== "string") return null;
  return {
    ciphertext: o.ciphertext,
    nonce: o.nonce,
    authTag: o.authTag,
    keyVersion: Number(o.keyVersion ?? 1),
  };
}

/** AES-GCM vault for Kite API key/secret. Never returns plaintext via HTTP status. */
export class KiteCredentialsVault {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    _env: Env,
  ) {
    void _env;
  }

  async ensureRow(): Promise<void> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) await this.db.insert(appSettings).values({ id: 1 });
  }

  async status(): Promise<KiteCredsStatus> {
    await this.ensureRow();
    const [row] = await this.db.select().from(appSettings).limit(1);
    const keyBlob = asBlob(row?.kiteApiKeyEnc);
    if (!keyBlob) {
      return { configured: false, apiKeyHint: null, configuredAt: null };
    }
    try {
      const key = this.crypto.decrypt(keyBlob);
      return {
        configured: true,
        apiKeyHint: maskKey(key),
        configuredAt: row?.kiteConfiguredAt?.toISOString() ?? null,
      };
    } catch {
      return { configured: false, apiKeyHint: null, configuredAt: null };
    }
  }

  async get(): Promise<KiteCreds | null> {
    await this.ensureRow();
    const [row] = await this.db.select().from(appSettings).limit(1);
    const keyBlob = asBlob(row?.kiteApiKeyEnc);
    const secretBlob = asBlob(row?.kiteApiSecretEnc);
    if (keyBlob && secretBlob) {
      try {
        return {
          apiKey: this.crypto.decrypt(keyBlob),
          apiSecret: this.crypto.decrypt(secretBlob),
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async save(apiKey: string, apiSecret: string): Promise<KiteCredsStatus> {
    const key = apiKey.trim();
    const secret = apiSecret.trim();
    if (key.length < 6 || secret.length < 6) {
      throw new AppError("INVALID_CREDENTIALS", "API key and secret look too short", 422);
    }
    await this.ensureRow();
    const now = new Date();
    await this.db
      .update(appSettings)
      .set({
        kiteApiKeyEnc: this.crypto.encrypt(key) as unknown as Record<string, unknown>,
        kiteApiSecretEnc: this.crypto.encrypt(secret) as unknown as Record<string, unknown>,
        kiteConfiguredAt: now,
        updatedAt: now,
      })
      .where(eq(appSettings.id, 1));
    return this.status();
  }

  async revoke(): Promise<KiteCredsStatus> {
    await this.ensureRow();
    await this.db
      .update(appSettings)
      .set({
        kiteApiKeyEnc: null,
        kiteApiSecretEnc: null,
        kiteConfiguredAt: null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
    return this.status();
  }
}

function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}
