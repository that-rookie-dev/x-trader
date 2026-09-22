import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { Env } from "../config/env.js";
import type { Logger } from "../config/logger.js";

export class PostgresSupervisor {
  private instance: EmbeddedPostgres | null = null;
  private started = false;

  constructor(
    private readonly env: Env,
    private readonly log: Logger,
    private readonly dataDir: string,
  ) {}

  async start(): Promise<string> {
    if (this.env.DATABASE_URL && this.env.DATABASE_URL.length > 0) {
      this.log.info("Using DATABASE_URL; bundled Postgres not started");
      return this.env.DATABASE_URL;
    }

    mkdirSync(this.dataDir, { recursive: true });
    const databaseDir = resolve(this.dataDir, "pgdata");
    const alreadyInit = existsSync(resolve(databaseDir, "PG_VERSION"));

    this.instance = new EmbeddedPostgres({
      databaseDir,
      user: "xtrader",
      password: this.env.EMBEDDED_POSTGRES_PASSWORD,
      port: this.env.EMBEDDED_POSTGRES_PORT,
      persistent: true,
      onLog: (message) => this.log.debug({ pg: String(message) }, "postgres"),
      onError: (message) => this.log.error({ pg: String(message) }, "postgres error"),
    });

    if (!alreadyInit) {
      this.log.info({ databaseDir }, "Initialising bundled PostgreSQL");
      await this.instance.initialise();
    }

    await this.instance.start();
    this.started = true;

    try {
      await this.instance.createDatabase("xtrader");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!/already exists/i.test(text)) {
        this.log.debug({ err: text }, "createDatabase");
      }
    }

    const url = `postgresql://xtrader:${encodeURIComponent(this.env.EMBEDDED_POSTGRES_PASSWORD)}@127.0.0.1:${this.env.EMBEDDED_POSTGRES_PORT}/xtrader`;
    this.log.info({ port: this.env.EMBEDDED_POSTGRES_PORT }, "Bundled PostgreSQL started");
    return url;
  }

  async stop(): Promise<void> {
    if (this.instance && this.started) {
      await this.instance.stop();
      this.started = false;
      this.log.info("Bundled PostgreSQL stopped");
    }
  }
}
