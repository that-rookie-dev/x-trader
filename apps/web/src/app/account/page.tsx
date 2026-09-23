"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Profile = { userName: string; clientId: string; email?: string };
type Funds = { equity: { available: string; usedMargin: string }; asOf: string };
type Holding = { instrument: { symbol: string; exchange: string }; quantity: string; averagePrice: string; lastPrice?: string; pnl?: string };

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [funds, setFunds] = useState<Funds | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [p, f, h] = await Promise.all([
          api<Profile>("/api/account/profile"),
          api<Funds>("/api/account/funds"),
          api<Holding[]>("/api/account/holdings"),
        ]);
        if (cancelled) return;
        setProfile(p);
        setFunds(f);
        setHoldings(h);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load account");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="guide">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Your money</h1>
          <p className="lede">Real money stays in Zerodha. This app only reads balances and holdings for analysis.</p>
        </div>
      </div>
      {loading ? <div className="card muted">Loading…</div> : null}
      {error ? (
        <div className="card">
          <strong>Could not load the account.</strong>
          <p className="muted">{error}. Connect again to continue.</p>
        </div>
      ) : null}
      {profile ? (
        <div className="grid kpis">
          <div className="card kpi">
            <div className="label">Account</div>
            <div className="value">{profile.clientId}</div>
            <div className="muted">{profile.userName}</div>
          </div>
          <div className="card kpi" data-coach="funds">
            <div className="label">Cash available</div>
            <div className="value">{funds?.equity.available ?? "—"}</div>
          </div>
          <div className="card kpi">
            <div className="label">Used margin</div>
            <div className="value">{funds?.equity.usedMargin ?? "—"}</div>
          </div>
        </div>
      ) : null}
      <div className="card" data-coach="read-only">
        <h2>We only read after you trade</h2>
        <p className="muted" data-coach="fill">
          This app never sends an order. After you buy on Zerodha, dismiss the play on Options or Stocks. We match the fill and learn. A miss is not a win.
        </p>
      </div>
      <div className="card">
        <h2>Replay a tutorial</h2>
        <p className="muted">Walk the desk again any time. One step, then the next.</p>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent("xtrader-coach", { detail: "options" }))}>
            Options desk
          </button>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent("xtrader-coach", { detail: "stocks" }))}>
            Stocks
          </button>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent("xtrader-coach", { detail: "zerodha" }))}>
            Zerodha
          </button>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent("xtrader-coach", { detail: "alerts" }))}>
            Alerts
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Holdings</h2>
        {!holdings ? (
          <p className="muted">Connect Zerodha to load holdings.</p>
        ) : holdings.length === 0 ? (
          <p className="muted">No holdings.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Avg</th>
                <th>LTP</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((row) => (
                <tr key={`${row.instrument.exchange}:${row.instrument.symbol}`}>
                  <td>{row.instrument.symbol}</td>
                  <td className="mono">{row.quantity}</td>
                  <td className="mono">{row.averagePrice}</td>
                  <td className="mono">{row.lastPrice ?? "—"}</td>
                  <td className={`mono ${Number(row.pnl ?? 0) >= 0 ? "up" : "down"}`}>{row.pnl ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
