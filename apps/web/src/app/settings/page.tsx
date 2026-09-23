"use client";

import { AiProvidersPanel } from "@/components/AiProvidersPanel";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type Settings = {
  deskMode: string;
  ordersEnabled: boolean;
  haltActive: boolean;
  haltPolicy: string;
  haltReason: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

  return (
    <>
      <div className="page-hero">
        <div>
          <p className="eyebrow">Control plane</p>
          <h1>Settings</h1>
          <p className="lede">Analysis desk only. Connect Zerodha for data; place every order in the Zerodha app.</p>
        </div>
      </div>
      {msg ? <div className="card down">{msg}</div> : null}
      <div className="card">
        <h2>Desk</h2>
        <p>
          Mode: <span className="badge ok">{settings?.deskMode ?? "ANALYSIS"}</span>
        </p>
        <p className="muted">Orders from this app: never. Halt pauses alert scanning.</p>
        <div className="row">
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
    </>
  );
}
