#!/usr/bin/env node
import { resolve } from "node:path";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDb } from "./db/client.js";
import { applySchema } from "./db/migrate.js";
import { PostgresSupervisor } from "./postgres/supervisor.js";
import { appSessions, brokerSessions } from "./db/schema.js";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });
config();

const [cmd, sub] = process.argv.slice(2);

async function withDb<T>(fn: (db: ReturnType<typeof createDb>["db"]) => Promise<T>): Promise<T> {
  const env = parseEnv(process.env);
  const log = createLogger(env);
  const postgres = new PostgresSupervisor(env, log, env.DATA_DIR ?? resolve(process.cwd(), "var"));
  const url = await postgres.start();
  const { db, client } = createDb(url);
  await applySchema(client);
  try {
    return await fn(db);
  } finally {
    await client.end({ timeout: 5 });
    await postgres.stop();
  }
}

async function run() {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(`xTrader CLI
  xtrader start           Start API + web UI (bundled Postgres)
  xtrader update          Download latest release and restart (bundle installs)
  xtrader uninstall       Stop services and delete app + all local data
  xtrader session reset   Revoke app cookies and expire broker sessions
`);
    return;
  }
  if (cmd === "session" && sub === "reset") {
    await withDb(async (db) => {
      await db.update(appSessions).set({ revokedAt: new Date() });
      await db.update(brokerSessions).set({ status: "EXPIRED" }).where(eq(brokerSessions.status, "CONNECTED"));
      console.log("xTrader sessions reset. Reconnect Zerodha from the UI.");
    });
    return;
  }
  if (cmd === "uninstall") {
    const { existsSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const root = process.env.XTRADER_HOME?.trim() || process.cwd();
    const script =
      [resolve(root, "uninstall.sh"), resolve(root, "scripts/uninstall.sh")].find((p) => existsSync(p)) ?? null;
    if (!script) {
      console.error("uninstall.sh not found — use the release uninstall script from GitHub.");
      process.exit(1);
    }
    const child = spawn("bash", [script], {
      stdio: "inherit",
      env: { ...process.env, XTRADER_HOME: root },
    });
    const code = await new Promise<number>((resolveCode) => child.on("exit", (c) => resolveCode(c ?? 1)));
    process.exit(code);
  }
  if (cmd === "update") {
    const { UpdateService } = await import("./modules/update/service.js");
    const env = parseEnv(process.env);
    const log = createLogger(env);
    const updates = new UpdateService(env, log);
    const tag = sub && sub !== "latest" ? sub : undefined;
    const result = await updates.apply(tag);
    console.log(`Updating to ${result.version} — process will exit and restart.`);
    return;
  }
  if (cmd === "start" || !cmd) {
    const { main } = await import("./boot.js");
    await main();
    return;
  }
  console.log(`xTrader CLI
  xtrader start           Start API + web UI (bundled Postgres)
  xtrader update          Download latest release and restart (bundle installs)
  xtrader uninstall       Stop services and delete app + all local data
  xtrader session reset   Revoke app cookies and expire broker sessions
`);
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
