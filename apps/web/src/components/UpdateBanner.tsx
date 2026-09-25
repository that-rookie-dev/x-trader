"use client";

import { api } from "@/lib/api";
import { showDec } from "@/lib/format";
import { useEffect, useState } from "react";

type UpdateStatus = {
  current: string;
  latest: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  channel: "bundle" | "source";
  message: string | null;
  applying: boolean;
  progress: { state: string; message: string; percent: number } | null;
};

const DISMISS_KEY = "xtrader-dismiss-update";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const applying = busy || Boolean(status?.applying);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check(force = false) {
      try {
        const data = await api<UpdateStatus>(`/api/update/status${force ? "?refresh=1" : ""}`);
        if (cancelled) return;
        setStatus(data);
        if (data.applying) {
          setBusy(true);
          setNote(progressLabel(data));
          return;
        }
        if (data.progress?.state === "failed") {
          setBusy(false);
          setNote(data.progress.message);
          return;
        }
        setNote(null);
        if (!data.updateAvailable) setBusy(false);
      } catch {
        /* API is down only for the short restart at the end */
      }
    }
    void check(true);
    const id = window.setInterval(() => void check(false), applying ? 2000 : 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applying]);

  useEffect(() => {
    if (!applying || !status?.latest) return;
    let cancelled = false;
    void waitForVersion(status.latest).then((ok) => {
      if (cancelled || !ok) return;
      localStorage.removeItem(DISMISS_KEY);
      window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [applying, status?.latest]);

  if (applying) {
    const pct = status?.progress?.percent ?? 0;
    return (
      <div className="update-banner updating" role="status">
        <strong>Updating</strong>
        <span className="muted">
          v{status?.current ?? "…"} → v{status?.latest ?? "…"}
          {note ? ` · ${note}` : ""}
        </span>
        <span className="update-meter" aria-hidden>
          <i style={{ width: `${Math.max(8, Math.min(100, pct))}%` }} />
        </span>
        <span className="mono update-pct">{pct > 0 ? `${showDec(pct, 3)}%` : ""}</span>
      </div>
    );
  }

  if (!status?.updateAvailable || !status.latest) return null;
  if (dismissed === status.latest) return null;

  async function apply() {
    if (!status?.canUpdate || !status.latest) return;
    setBusy(true);
    setNote("Starting update");
    try {
      await api("/api/update/apply", { method: "POST", body: "{}" });
    } catch (e) {
      setBusy(false);
      setNote(e instanceof Error ? e.message : "Could not start the update");
    }
  }

  return (
    <div className="update-banner" role="status">
      <strong>Update</strong>
      <span className="muted">
        v{status.current} → v{status.latest}
        {status.canUpdate ? "" : " · reinstall from the GitHub release"}
        {note ? ` · ${note}` : ""}
      </span>
      <span className="spacer" />
      {status.canUpdate ? (
        <button type="button" className="btn primary" onClick={() => void apply()}>
          Update
        </button>
      ) : null}
      <button
        type="button"
        className="btn"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, status.latest!);
          setDismissed(status.latest);
        }}
      >
        Later
      </button>
    </div>
  );
}

function progressLabel(status: UpdateStatus): string {
  const row = status.progress;
  if (!row) return "Downloading release";
  if (row.state === "extracting") return "Replacing files";
  if (row.state === "restarting") return "Restarting";
  if (row.state === "starting") return "Starting update";
  return row.message || "Downloading release";
}

async function waitForVersion(expectedVersion: string) {
  const want = expectedVersion.replace(/^v/i, "");
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { version?: string };
        const got = (body.version ?? "").replace(/^v/i, "");
        if (got && got === want) return true;
      }
    } catch {
      /* restart window */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
