"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Coach, readSeen, tourForPath } from "@/components/Coach";

const NAV = [
  ["/", "Options", IconOptions],
  ["/stocks", "Stocks", IconStocks],
  ["/trades", "My trades", IconTrades],
  ["/account", "Account", IconAccount],
  ["/settings", "Settings", IconSettings],
] as const;

function compactStatus(status?: string): string {
  switch (status) {
    case "CONNECTED":
      return "ON";
    case "DISCONNECTED":
      return "OFF";
    case "EXPIRED":
      return "EXP";
    case "CONNECTING":
      return "…";
    case "ERROR":
      return "ERR";
    default:
      return status ?? "…";
  }
}

type Bootstrap = {
  linked: boolean;
  authenticated: boolean;
  locked?: boolean;
  needsReconnect?: boolean;
  broker: { status: string; clientId?: string };
  settings: { deskMode?: string; ordersEnabled?: boolean; haltActive: boolean };
};

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState("dark");
  const [clock, setClock] = useState("");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState<string | null>(null);

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
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(new Date()) + " IST",
      );
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
    if (typeof window === "undefined") return;
    const name = tourForPath(path);
    if (!readSeen()[name]) {
      const id = window.setTimeout(() => setTour(name), 600);
      return () => window.clearTimeout(id);
    }
  }, [path]);

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

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-top">
          <div className="brand" title="xTrader">
            XT
          </div>
        </div>
        <nav className="nav">
          {NAV.map(([href, label, Icon]) => (
            <Link key={href} href={href} className={path === href ? "active" : ""} aria-label={label}>
              <Icon />
              <span className="nav-tip">{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="top">
          <span className="badge ok">DESK</span>
          <span className="badge warn">READ-ONLY</span>
          <span className={`badge ${boot?.broker.status === "CONNECTED" ? "ok" : "warn"}`}>
            {compactStatus(boot?.broker.status)}
          </span>
          {boot?.settings.haltActive ? <span className="badge live">HALT</span> : null}
          <span className="ist">{clock}</span>
          <span className="spacer" />
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
          {boot && !boot.authenticated ? (
            <div className="card">
              <h2>{boot.linked ? "Login ran out" : "Connect to continue"}</h2>
              <p className="muted">
                {boot.linked
                  ? "Connect again with the same account so the helper can see live prices."
                  : "Connect your trading account so the helper can read prices and tell you what to do."}
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" data-coach="connect" onClick={() => void connect()}>
                  {boot.linked ? "Reconnect Zerodha" : "Connect Zerodha"}
                </button>
              </div>
            </div>
          ) : null}
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
