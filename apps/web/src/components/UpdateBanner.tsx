"use client";

import { api } from "@/lib/api";
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
};

const DISMISS_KEY = "xtrader-dismiss-update";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check(force = false) {
      try {
        const data = await api<UpdateStatus>(`/api/update/status${force ? "?refresh=1" : ""}`);
        if (!cancelled) setStatus(data);
      } catch {
        /* offline during restart is fine */
      }
    }
    void check(true);
    const id = window.setInterval(() => void check(false), 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!status?.updateAvailable || !status.latest) return null;
  if (dismissed === status.latest) return null;

  async function apply() {
    if (!status?.canUpdate) return;
    setBusy(true);
    setNote("Downloading update — the app will restart…");
    try {
      await api("/api/update/apply", { method: "POST", body: "{}" });
    } catch {
      /* connection drop during restart is expected */
    }
    setNote("Restarting… waiting for the new version");
    try {
      await waitForHealth(status.latest!);
      setNote(null);
      localStorage.removeItem(DISMISS_KEY);
      window.location.reload();
    } catch (e) {
      setBusy(false);
      setNote(e instanceof Error ? e.message : "Update timed out — check ~/.xtrader/var/update.log");
    }
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-copy">
        <strong>Update available</strong>
        <span className="muted">
          v{status.current} → v{status.latest}
          {status.canUpdate ? "" : " · reinstall from GitHub release to upgrade"}
        </span>
        {note ? <span className="update-banner-note">{note}</span> : null}
      </div>
      <div className="update-banner-actions">
        {status.canUpdate ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void apply()}>
            {busy ? "Updating…" : "Update & restart"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, status.latest!);
            setDismissed(status.latest);
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}

async function waitForHealth(expectedVersion: string) {
  const want = expectedVersion.replace(/^v/i, "");
  const deadline = Date.now() + 180_000;
  let sawDown = false;
  await new Promise((r) => setTimeout(r, 2000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { version?: string };
        const got = (body.version ?? "").replace(/^v/i, "");
        if (sawDown || !got || got === want) return;
        // Still old process briefly — keep waiting if we never saw downtime
        if (got !== want) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return;
      }
      sawDown = true;
    } catch {
      sawDown = true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for restart");
}
