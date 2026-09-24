import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../../config/env.js";
import type { Logger } from "../../config/logger.js";
import { isNewer, normalizeTag } from "./semver.js";

export type UpdateStatus = {
  current: string;
  latest: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  installRoot: string | null;
  channel: "bundle" | "source";
  checkedAt: string | null;
  message: string | null;
  applying: boolean;
  progress: { state: string; message: string; percent: number } | null;
};

type GhRelease = {
  tag_name: string;
  html_url?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
};

const CHECK_TTL_MS = 60 * 60 * 1000;

/** Detect release installs, poll GitHub for newer tags, apply self-update + restart. */
export class UpdateService {
  private cache: { at: number; release: GhRelease | null } | null = null;
  private applying = false;

  constructor(
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  installRoot(): string | null {
    const fromEnv = process.env.XTRADER_HOME?.trim();
    if (fromEnv && this.looksLikeBundle(fromEnv)) return resolve(fromEnv);

    const cwd = process.cwd();
    if (this.looksLikeBundle(cwd)) return cwd;

    if (this.env.DATA_DIR) {
      const parent = resolve(this.env.DATA_DIR, "..");
      if (this.looksLikeBundle(parent)) return parent;
    }
    return null;
  }

  currentVersion(): string {
    const root = this.installRoot() ?? process.cwd();
    const versionFile = resolve(root, "VERSION");
    if (existsSync(versionFile)) {
      return normalizeTag(readFileSync(versionFile, "utf8").split("\n")[0] ?? "0.0.0");
    }
    try {
      const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: string };
      if (pkg.version) return normalizeTag(pkg.version);
    } catch {
      /* fall through */
    }
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const apiPkg = JSON.parse(readFileSync(resolve(here, "../../../package.json"), "utf8")) as { version?: string };
      if (apiPkg.version) return normalizeTag(apiPkg.version);
    } catch {
      /* ignore */
    }
    return "0.0.0";
  }

  canSelfUpdate(): boolean {
    const root = this.installRoot();
    if (!root) return false;
    return existsSync(resolve(root, "scripts/self-update.sh"));
  }

  async status(force = false): Promise<UpdateStatus> {
    const root = this.installRoot();
    const current = this.currentVersion();
    const channel = root ? "bundle" : "source";
    const canUpdate = this.canSelfUpdate();

    let latest: string | null = null;
    let latestTag: string | null = null;
    let checkedAt: string | null = null;
    let message: string | null = null;

    try {
      const release = await this.fetchLatest(force);
      checkedAt = new Date().toISOString();
      if (release) {
        latestTag = release.tag_name;
        latest = normalizeTag(release.tag_name);
      } else {
        message = "No GitHub release found yet";
      }
    } catch (err) {
      message = err instanceof Error ? err.message : "update check failed";
      this.log.warn({ err }, "update check failed");
    }

    const updateAvailable = Boolean(latest && isNewer(latest, current));
    if (updateAvailable && !canUpdate) {
      message = `v${latest} available — reinstall from the GitHub release (source checkout)`;
    }

    const progress = this.readProgress(current);
    const applying = this.applying || progress?.active === true;
    if (progress?.state === "failed" && progress.message) message = progress.message;

    return {
      current,
      latest,
      latestTag,
      updateAvailable: updateAvailable || applying,
      canUpdate,
      installRoot: root,
      channel,
      checkedAt,
      message,
      applying,
      progress: progress
        ? { state: progress.state, message: progress.message, percent: progress.percent }
        : null,
    };
  }

  /** Download latest (or given tag), swap files, restart. Returns immediately; process exits shortly. */
  async apply(tag?: string): Promise<{ ok: true; version: string; restarting: true }> {
    if (this.applying) {
      const err = new Error("Update already in progress");
      (err as Error & { code?: string }).code = "UPDATE_BUSY";
      throw err;
    }
    const root = this.installRoot();
    if (!root || !this.canSelfUpdate()) {
      const err = new Error("Self-update only works for release installs under XTRADER_HOME");
      (err as Error & { code?: string }).code = "UPDATE_NOT_SUPPORTED";
      throw err;
    }

    const st = await this.status(true);
    const targetTag = tag?.trim() || st.latestTag;
    if (!targetTag) {
      const err = new Error("No release tag to install");
      (err as Error & { code?: string }).code = "UPDATE_NONE";
      throw err;
    }
    if (!isNewer(normalizeTag(targetTag), st.current) && !tag) {
      const err = new Error("Already on the latest version");
      (err as Error & { code?: string }).code = "UPDATE_NONE";
      throw err;
    }

    const script = this.resolveUpdateScript(root);
    mkdirSync(resolve(root, "var"), { recursive: true });
    writeFileSync(
      resolve(root, "var/update.log"),
      `\n--- update ${new Date().toISOString()} → ${targetTag} ---\n`,
      { flag: "a" },
    );

    this.applying = true;
    this.writeProgress({
      state: "starting",
      target: normalizeTag(targetTag),
      message: "Starting update",
      percent: 0,
      startedAt: new Date().toISOString(),
    });
    this.log.info({ root, targetTag, script }, "starting self-update");

    const launcher = spawn(
      "bash",
      [
        "-c",
        `nohup bash "$1" --restart --version "$2" >>"$3/var/update.log" 2>&1 &`,
        "_",
        script,
        targetTag,
        root,
      ],
      {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          XTRADER_HOME: root,
          XTRADER_VERSION: targetTag,
          XTRADER_REPO: this.env.UPDATE_REPO,
          DATA_DIR: this.env.DATA_DIR ?? resolve(root, "var"),
        },
      },
    );
    launcher.unref();

    return { ok: true, version: normalizeTag(targetTag), restarting: true };
  }

  private progressFile(): string | null {
    const root = this.installRoot();
    const dir = this.env.DATA_DIR ?? (root ? resolve(root, "var") : null);
    return dir ? resolve(dir, "update-status.json") : null;
  }

  private writeProgress(row: { state: string; target: string; message: string; percent: number; startedAt: string }) {
    const file = this.progressFile();
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(row)}\n`);
  }

  private readProgress(current: string): { state: string; message: string; percent: number; active: boolean } | null {
    const file = this.progressFile();
    if (!file || !existsSync(file)) return null;
    try {
      const row = JSON.parse(readFileSync(file, "utf8")) as {
        state?: string;
        target?: string;
        message?: string;
        percent?: number;
        startedAt?: string;
      };
      const state = row.state ?? "starting";
      const target = normalizeTag(row.target ?? "");
      const started = row.startedAt ? Date.parse(row.startedAt) : 0;
      const fresh = started > 0 && Date.now() - started < 45 * 60 * 1000;
      if (target && !isNewer(target, current)) return null;
      if (!fresh && state !== "failed") return null;
      const active = fresh && state !== "failed";
      return {
        state,
        message: row.message ?? "Updating",
        percent: Number.isFinite(row.percent) ? Number(row.percent) : 0,
        active,
      };
    } catch {
      return null;
    }
  }

  private looksLikeBundle(root: string): boolean {
    return (
      existsSync(resolve(root, "bin/xtrader")) &&
      (existsSync(resolve(root, "VERSION")) || existsSync(resolve(root, "apps/web/standalone")))
    );
  }

  private resolveUpdateScript(root: string): string {
    const bundled = resolve(root, "scripts/self-update.sh");
    if (existsSync(bundled)) return bundled;
    throw Object.assign(new Error("self-update.sh missing from install"), { code: "UPDATE_NOT_SUPPORTED" });
  }

  private async fetchLatest(force: boolean): Promise<GhRelease | null> {
    if (!force && this.cache && Date.now() - this.cache.at < CHECK_TTL_MS) {
      return this.cache.release;
    }
    const repo = this.env.UPDATE_REPO;
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `xTrader/${this.currentVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) {
      this.cache = { at: Date.now(), release: null };
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitHub releases HTTP ${res.status}`);
    }
    const release = (await res.json()) as GhRelease;
    this.cache = { at: Date.now(), release };
    return release;
  }
}
