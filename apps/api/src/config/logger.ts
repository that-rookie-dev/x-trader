import pino from "pino";
import type { Env } from "./env.js";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "secret",
  "api_secret",
  "apiSecret",
  "access_token",
  "accessToken",
  "request_token",
  "requestToken",
  "checksum",
  "ciphertext",
  "token",
  "TOKEN_ENCRYPTION_KEY_BASE64",
  "KITE_API_SECRET",
  "SESSION_SECRET",
];

export function createLogger(env: Env) {
  return pino({
    name: env.APP_NAME,
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: "[redacted]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
