"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showDec } from "@/lib/format";
import { sessionPhase, sessionPhaseLabel, type SessionPhase } from "@/lib/session";
import { Coach, readSeen, tourForPath } from "@/components/Coach";
import { SetupCredentials } from "@/components/SetupCredentials";
import { SetupLlm } from "@/components/SetupLlm";
import { SetupZerodha } from "@/components/SetupZerodha";
import { UpdateBanner } from "@/components/UpdateBanner";
import { VectorAtmosphere } from "@/components/VectorAtmosphere";

const NAV = [
  ["/", "Options", IconOptions],
  ["/stocks", "Stocks", IconStocks],
  ["/training", "Training", IconTraining],
  ["/trades", "My trades", IconTrades],
  ["/account", "Account", IconAccount],
  ["/settings", "Settings", IconSettings],
] as const;

type KiteStatus = {
  configured: boolean;
  apiKeyHint: string | null;
  configuredAt: string | null;
};

type Bootstrap = {
  linked: boolean;
  authenticated: boolean;
  locked?: boolean;
  needsReconnect?: boolean;
  needsCredentials?: boolean;
  hasAiProfile?: boolean;
  kite?: KiteStatus;
  broker: { status: string; clientId?: string };
  settings: {
    deskMode?: string;
    ordersEnabled?: boolean;
    haltActive: boolean;
    paperAutopilot?: boolean;
    predictionMode?: "ALGO" | "AI";
    paperCash?: string | null;
    paperOpenCount?: number;
  };
};

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState("dark");
  const [clock, setClock] = useState("");
  const [phase, setPhase] = useState<SessionPhase>("open");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState<string | null>(null);
  const [askLlm, setAskLlm] = useState(false);

  const ONBOARD_KEY = "xtrader-onboarding";

  useEffect(() => {
    const stored = localStorage.getItem("xtrader-theme");
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.nav = "closed";
    localStorage.setItem("xtrader-theme", theme);
  }, [theme]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(now) + " IST",
      );
      setPhase(sessionPhase(now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const refresh = () => {
      api<Bootstrap>("/api/bootstrap")
        .then(setBoot)
        .catch((e) => setError(e instanceof Error ? e.message : "backend unavailable"));
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onCoach = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      if (detail) setTour(detail);
    };
    window.addEventListener("xtrader-coach", onCoach);
    return () => window.removeEventListener("xtrader-coach", onCoach);
  }, []);

  useEffect(() => {
    if (!boot || typeof window === "undefined") return;
    const step = window.localStorage.getItem(ONBOARD_KEY);
    if (boot.needsCredentials) return;
    if (!boot.authenticated) return;
    if (boot.hasAiProfile) {
      window.localStorage.setItem(ONBOARD_KEY, "done");
      setAskLlm(false);
      return;
    }
    if (step === "keys" || step === "llm") {
      window.localStorage.setItem(ONBOARD_KEY, "llm");
      setAskLlm(true);
      return;
    }
    if (!step) {
      window.localStorage.setItem(ONBOARD_KEY, "done");
      setAskLlm(false);
    }
  }, [boot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (boot?.needsCredentials || !boot?.authenticated || askLlm) return;
    const name = tourForPath(path);
    if (!readSeen()[name]) {
      const id = window.setTimeout(() => setTour(name), 600);
      return () => window.clearTimeout(id);
    }
  }, [path, boot?.needsCredentials, boot?.authenticated, askLlm]);

  async function connect() {
    try {
      setError(null);
      const { url } = await api<{ url: string }>("/api/brokers/zerodha/login");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    }
  }

  async function disconnect() {
    await api("/api/brokers/zerodha/disconnect", { method: "POST", body: "{}" });
    window.location.reload();
  }

  async function halt(active: boolean) {
    await api("/api/risk/halt", { method: "POST", body: JSON.stringify({ active, reason: "ui" }) });
    window.location.reload();
  }

  async function toggleAutopilot() {
    const enabled = !boot?.settings.paperAutopilot;
    try {
      const settings = await api<Bootstrap["settings"]>("/api/settings/autopilot", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      setBoot((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...settings } } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "autopilot failed");
    }
  }

  async function setPredictionMode(mode: "ALGO" | "AI") {
    if (boot?.settings.predictionMode === mode) return;
    try {
      const settings = await api<Bootstrap["settings"]>("/api/settings/prediction-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setBoot((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...settings } } : prev));
      window.dispatchEvent(new CustomEvent("xtrader-prediction-mode", { detail: mode }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "prediction mode failed");
    }
  }

  async function topupPaper() {
    try {
      const { cash } = await api<{ cash: string }>("/api/paper/topup", { method: "POST", body: "{}" });
      setBoot((prev) =>
        prev ? { ...prev, settings: { ...prev.settings, paperCash: cash } } : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "topup failed");
    }
  }

  const paperCash = boot?.settings.paperCash;
  const paperLow = paperCash != null && Number(paperCash) < 500;

  if (!boot && !error) {
    return (
      <div className="creds-gate on">
        <VectorAtmosphere />
        <div className="creds-loading">
          <span className="creds-mark">XT</span>
          <p>Starting desk…</p>
        </div>
      </div>
    );
  }

  if (boot?.needsCredentials) {
    return (
      <SetupCredentials
        onSaved={() => {
          window.localStorage.setItem(ONBOARD_KEY, "keys");
          setBoot(null);
          window.location.reload();
        }}
      />
    );
  }

  if (boot && !boot.authenticated) {
    return (
      <SetupZerodha
        linked={boot.linked}
        error={error}
        onConnect={() => void connect()}
      />
    );
  }

  if (boot && askLlm && !boot.hasAiProfile) {
    return (
      <SetupLlm
        onDone={() => {
          window.localStorage.setItem(ONBOARD_KEY, "done");
          setAskLlm(false);
          setBoot((prev) =>
            prev
              ? {
                  ...prev,
                  hasAiProfile: true,
                  settings: { ...prev.settings, predictionMode: "AI" },
                }
              : prev,
          );
        }}
        onSkip={() => {
          window.localStorage.setItem(ONBOARD_KEY, "done");
          setAskLlm(false);
          void setPredictionMode("ALGO");
        }}
      />
    );
  }

  return (
    <div className="shell">
      <VectorAtmosphere />
      <aside className="side">
        <div className="side-top">
          <div className="brand" title="xTrader">
            XT
          </div>
        </div>
        <nav className="nav">
          {NAV.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={path === href ? "active" : ""}
              aria-label={label}
              onClick={(e) => (e.currentTarget as HTMLAnchorElement).blur()}
            >
              <Icon />
              <span className="nav-tip">{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="main">
        <UpdateBanner />
        <header className="top">
          <div className="top-brand">
            <strong>xTrader</strong>
            <span>Analysis terminal</span>
          </div>
          {boot?.settings.haltActive ? <span className="badge live">HALT</span> : null}
          <span className={`badge mono ${paperLow ? "live" : "ok"}`} title="Paper training wallet">
            ₹{paperCash != null ? showDec(paperCash, 0) : "—"}
          </span>
          <span
            className={`badge session-phase ${phase === "closing" ? "closing" : phase === "closed" || phase === "preopen" ? "warn" : "ok"}`}
            title={
              phase === "closing"
                ? "Last 15 minutes before 15:30 IST close"
                : phase === "closed"
                  ? "Market closed — no new entries"
                  : phase === "preopen"
                    ? "Before 09:15 IST open"
                    : "Regular session until 15:30 IST"
            }
          >
            {sessionPhaseLabel(phase)}
          </span>
          <span className={`ist ${phase === "closing" ? "ist-closing" : ""}`}>{clock}</span>
          <span className="spacer" />
          <div className="pred-mode" role="group" aria-label="Prediction mode">
            <button
              type="button"
              className={boot?.settings.predictionMode !== "AI" ? "on" : ""}
              title="Use mechanical equation (algo delta)"
              onClick={() => void setPredictionMode("ALGO")}
            >
              ALGO
            </button>
            <button
              type="button"
              className={boot?.settings.predictionMode === "AI" ? "on" : ""}
              title={
                boot?.hasAiProfile
                  ? "Use AI equation (algo ⊕ AI delta)"
                  : "Add an LLM in Settings to enable AI"
              }
              disabled={!boot?.hasAiProfile}
              onClick={() => void setPredictionMode("AI")}
            >
              AI
            </button>
          </div>
          <button
            type="button"
            className={`btn ${boot?.settings.paperAutopilot ? "primary" : ""}`}
            title="Paper Autopilot — local BUY/SELL only, never Zerodha"
            onClick={() => void toggleAutopilot()}
          >
            {boot?.settings.paperAutopilot ? "Autopilot ON" : "Autopilot"}
          </button>
          <button type="button" className="btn" title="Add ₹25,000 paper cash" onClick={() => void topupPaper()}>
            +₹25k
          </button>
          <button
            type="button"
            className="btn"
            title="Replay guide"
            aria-label="Replay guide"
            onClick={() => setTour(tourForPath(path))}
          >
            ?
          </button>
          {error ? <span className="down">{error}</span> : null}
          <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {boot?.settings.haltActive ? (
            <button className="btn" onClick={() => void halt(false)}>
              Resume
            </button>
          ) : (
            <button className="btn danger" onClick={() => void halt(true)}>
              Pause
            </button>
          )}
          {boot?.authenticated ? (
            <button className="btn" onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            <button className="btn primary" data-coach="connect" onClick={() => void connect()}>
              {boot?.linked ? "Reconnect Zerodha" : "Connect Zerodha"}
            </button>
          )}
        </header>
        <div className="content">
          {children}
        </div>
      </div>
      <Coach tour={tour} onClose={() => setTour(null)} />
    </div>
  );
}

function IconOptions() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 19V9M12 19V5M18 19v-7" />
    </svg>
  );
}

function IconStocks() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 16l5-5 4 3 7-8" />
      <path d="M4 19h16" />
    </svg>
  );
}

function IconTrades() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="1" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function IconTraining() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 18V6M9 18V10M14 18V8M19 18V4" />
    </svg>
  );
}

function IconAccount() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19c1.4-3 4-4.5 7-4.5S17.6 16 19 19" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.4 6.4l1.6 1.6M16 16l1.6 1.6M17.6 6.4 16 8M8 16l-1.6 1.6" />
    </svg>
  );
}
