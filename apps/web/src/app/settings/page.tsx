"use client";

import { AiProvidersPanel } from "@/components/AiProvidersPanel";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type Settings = {
  executionMode: string;
  agentMode: string;
  liveTradingEnabled: boolean;
  currentEgressIp: string | null;
  confirmedEgressIp: string | null;
  liveReady: boolean;
  liveBlockedReason: string | null;
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
          <p className="lede">Live-test a model before you activate it. Copilot never places an order.</p>
        </div>
      </div>
      {msg ? <div className="card down">{msg}</div> : null}
      <div className="card">
        <h2>TEST / LIVE</h2>
        <p>
          Mode:{" "}
          <span className={`badge ${settings?.executionMode === "LIVE" ? "live" : "paper"}`}>
            {settings?.executionMode ?? "PAPER"}
          </span>
        </p>
        <p className="muted">Current egress IP: {settings?.currentEgressIp ?? "unknown"}</p>
        <p className="muted">Confirmed static IP: {settings?.confirmedEgressIp ?? "none"}</p>
        <p className="muted">{settings?.liveBlockedReason}</p>
        <div className="row">
          <button className="btn" onClick={() => void save({ confirmEgress: true })}>
            Confirm current IP as static
          </button>
          <button className="btn" onClick={() => void save({ liveTradingEnabled: true })}>
            Enable live capability
          </button>
          <button className="btn" onClick={() => void save({ executionMode: "PAPER" })}>
            TEST
          </button>
          <button className="btn danger" onClick={() => void save({ executionMode: "LIVE" })}>
            LIVE
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Copilot / Auto</h2>
        <p className="muted">
          Copilot studies history, news, and F&amp;O and never places an order. Auto uses the same study, then
          risk-gated execution for names you enable on Forecast.
        </p>
        <div className="row">
          {(["COPILOT", "AUTO"] as const).map((m) => (
            <button key={m} className={`btn ${settings?.agentMode === m ? "primary" : ""}`} onClick={() => void save({ agentMode: m })}>
              {m}
            </button>
          ))}
        </div>
        <p className="muted">LIVE Auto still requires the IP gate. Development stays on TEST/paper unless you switch LIVE.</p>
      </div>
      <AiProvidersPanel />
    </>
  );
}
