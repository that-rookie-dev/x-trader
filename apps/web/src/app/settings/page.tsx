"use client";

import { AiProvidersPanel } from "@/components/AiProvidersPanel";
import { PageHeader } from "@/components/PageHeader";
import { TrackedSymbolsPanel } from "@/components/TrackedSymbolsPanel";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type KiteStatus = {
  configured: boolean;
  apiKeyHint: string | null;
  configuredAt: string | null;
};

type Settings = {
  deskMode: string;
  ordersEnabled: boolean;
  haltActive: boolean;
  haltPolicy: string;
  haltReason: string | null;
  kite?: KiteStatus;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function load() {
    setSettings(await api<Settings>("/api/settings"));
  }
  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "failed"));
  }, []);

  async function save(patch: Record<string, unknown>) {
    setMsg(null);
    try {
      setSettings(await api<Settings>("/api/settings", { method: "POST", body: JSON.stringify(patch) }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    }
  }

  async function revokeKite() {
    setMsg(null);
    setRevoking(true);
    try {
      const res = await api<{ ok: boolean; kite: KiteStatus }>("/api/setup/kite/revoke", {
        method: "POST",
        body: "{}",
      });
      setSettings((s) => (s ? { ...s, kite: res.kite } : s));
      setConfirmRevoke(false);
      window.location.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "revoke failed");
    } finally {
      setRevoking(false);
    }
  }

  const kite = settings?.kite;
  const configuredAt = kite?.configuredAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(kite.configuredAt))
    : null;

  return (
    <div className="guide">
      <PageHeader
        kicker="Control plane"
        title="Settings"
        lede="Analysis desk only. Connect Zerodha for data; place every order in the Zerodha app."
      />
      {msg ? <div className="card down">{msg}</div> : null}

      <TrackedSymbolsPanel />

      <div className="card kite-vault-card">
        <div className="kite-vault-head">
          <div>
            <h2>Kite credentials</h2>
            <p className="muted">
              API key and secret are encrypted with AES-GCM on this machine. Plaintext never leaves the vault.
            </p>
          </div>
          <span className={`badge ${kite?.configured ? "ok" : "warn"}`}>
            {kite?.configured ? "SECURED" : "MISSING"}
          </span>
        </div>
        {kite?.configured ? (
          <div className="kite-vault-meta">
            <div>
              <span className="muted">API key</span>
              <strong className="mono">{kite.apiKeyHint ?? "••••"}</strong>
            </div>
            {configuredAt ? (
              <div>
                <span className="muted">Saved</span>
                <strong>{configuredAt} IST</strong>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">No credentials stored. You will be asked for them on the next load.</p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {kite?.configured ? (
            confirmRevoke ? (
              <>
                <span className="down">This clears the vault and signs you out. Continue?</span>
                <button className="btn danger" disabled={revoking} onClick={() => void revokeKite()}>
                  {revoking ? "Revoking…" : "Yes, revoke"}
                </button>
                <button className="btn" disabled={revoking} onClick={() => setConfirmRevoke(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmRevoke(true)}>
                Revoke credentials
              </button>
            )
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Desk</h2>
          <span className="badge ok">{settings?.deskMode ?? "ANALYSIS"}</span>
        </div>
        <p className="muted">Orders from this app: never. Halt pauses alert scanning.</p>
        <div className="row" style={{ marginTop: 10 }}>
          {settings?.haltActive ? (
            <button className="btn" onClick={() => void save({ haltActive: false, haltReason: null })}>
              Resume desk
            </button>
          ) : (
            <button className="btn danger" onClick={() => void save({ haltActive: true, haltReason: "user" })}>
              Pause desk
            </button>
          )}
        </div>
      </div>
      <AiProvidersPanel />
    </div>
  );
}
