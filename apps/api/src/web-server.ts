import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "./config/env.js";
import type { Logger } from "./config/logger.js";

export type WebStandalone = {
  standaloneRoot: string;
  serverJs: string;
};

/** Locate Next.js standalone server relative to the install / repo root (cwd). */
export function resolveWebStandalone(root = process.cwd()): WebStandalone | null {
  const packed = resolve(root, "apps/web/standalone");
  const packedServer = resolve(packed, "apps/web/server.js");
  if (existsSync(packedServer)) return { standaloneRoot: packed, serverJs: packedServer };
  const packedFlat = resolve(packed, "server.js");
  if (existsSync(packedFlat)) return { standaloneRoot: packed, serverJs: packedFlat };

  const nextStandalone = resolve(root, "apps/web/.next/standalone");
  const nextServer = resolve(nextStandalone, "apps/web/server.js");
  if (existsSync(nextServer)) return { standaloneRoot: nextStandalone, serverJs: nextServer };

  return null;
}

function webPort(env: Env): string {
  try {
    const port = new URL(env.APP_ORIGIN).port;
    if (port) return port;
  } catch {
    /* default */
  }
  return "3456";
}

/** Spawn the Next standalone UI. Returns null if the standalone build is missing. */
export function startWebServer(env: Env, log: Logger): ChildProcess | null {
  const hit = resolveWebStandalone(process.cwd());
  if (!hit) {
    log.warn("Web standalone not found — UI will not start (run npm run build -w @xtrader/web)");
    return null;
  }

  const port = webPort(env);
  const host = env.APP_BIND || "127.0.0.1";
  const child = spawn(process.execPath, [hit.serverJs], {
    cwd: hit.standaloneRoot,
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: host,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("exit", (code, signal) => {
    if (signal) log.warn({ signal }, "web server exited on signal");
    else if (code && code !== 0) log.warn({ code }, "web server exited");
  });

  log.info({ url: `http://${host}:${port}`, server: hit.serverJs }, "xTrader web starting");
  return child;
}
