import { z } from "zod";
import { normalizeAgentMode } from "@xtrader/domain";

const boolish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("xTrader"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:3000"),
  APP_BIND: z.string().default("127.0.0.1"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional().default(""),
  KITE_API_KEY: z.string().min(1).optional().or(z.literal("")),
  KITE_API_SECRET: z.string().min(1).optional().or(z.literal("")),
  KITE_ALLOWED_CLIENT_ID: z.string().optional().default(""),
  KITE_REDIRECT_URL: z.string().url().default("http://127.0.0.1:3000/zerodha/callback"),
  SESSION_SECRET: z.string().min(16),
  TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(16),
  TOKEN_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  EXECUTION_MODE: z.enum(["PAPER", "LIVE"]).default("PAPER"),
  AGENT_MODE: z.preprocess((value) => normalizeAgentMode(typeof value === "string" ? value : null), z.enum(["COPILOT", "AUTO"])).default("COPILOT"),
  LIVE_TRADING_ENABLED: boolish.default(false),
  AUTONOMOUS_TRADING_ENABLED: boolish.default(false),
  MARKET_TIMEZONE: z.string().default("Asia/Kolkata"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PAPER_INITIAL_CAPITAL_INR: z.string().default("100000"),
  MARKET_DATA_MAX_AGE_MS: z.coerce.number().int().positive().default(5000),
  TRADE_APPROVAL_TTL_MS: z.coerce.number().int().positive().default(15000),
  EMBEDDED_POSTGRES_PORT: z.coerce.number().int().positive().default(54329),
  EMBEDDED_POSTGRES_PASSWORD: z.string().default("xtrader"),
  DATA_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.TOKEN_ENCRYPTION_KEY_BASE64) {
    const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY_BASE64, "base64");
    if (key.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY_BASE64 must decode to 32 bytes (AES-256)");
    }
  }
  return env;
}
