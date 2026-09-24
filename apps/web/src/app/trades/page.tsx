"use client";

import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { showDec, showRupee } from "@/lib/format";
import { useEffect, useState } from "react";

type Memory = { id: string; strategy: string; regime: string; sampleCount: number; wins: number; losses: number; expectancy?: string | null };
type PaperPos = {
  id: string;
  symbol: string;
  exchange: string;
  quantity: string;
  averageEntry: string;
  currentPrice?: string | null;
  unrealisedPnl?: string | null;
  realisedPnl?: string | null;
  status: string;
  meta?: Record<string, unknown>;
  closeReason?: string | null;
};

type Desk = {
  journal: { memory: Memory[] };
  paper?: {
    cash: string;
    paperAutopilot: boolean;
    positions: PaperPos[];
    closed: PaperPos[];
    marketClosed?: boolean;
  };
  learning?: {
    mae: number | null;
    hitRate: number | null;
    samples: number;
    recent: Array<{
      kind: string;
      symbol: string;
      sessionDate: string;
      predictedClose: number | null;
      actualClose: number | null;
      errorPct: number | null;
      directionHit: boolean | null;
      status: string;
    }>;
    predictionMode?: "ALGO" | "AI";
    symbol?: string | null;
    algo?: {
      params: Record<string, number>;
      delta: Record<string, number>;
      scoreMae: number | null;
      lastTunedSession: string | null;
    } | null;
    ai?: {
      params: Record<string, number>;
      delta: Record<string, number>;
      scoreMae: number | null;
      lastTunedSession: string | null;
    } | null;
    paramsVersion: number | null;
    lastTune: Record<string, unknown> | null;
  };
};

export default function TradesPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setDesk(await api<Desk>("/api/trades/desk"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load trades");
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, []);

  const paperOpen = desk?.paper?.positions ?? [];
  const paperClosed = desk?.paper?.closed ?? [];
  const marketClosed = Boolean(desk?.paper?.marketClosed);

  async function closePaper(id: string) {
    if (marketClosed) {
      setError("Market closed — paper trading paused.");
      return;
    }
    try {
      await api(`/api/paper/positions/${id}/close`, { method: "POST", body: JSON.stringify({ reason: "MANUAL" }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close failed");
    }
  }

  async function topup() {
    if (marketClosed) {
      setError("Market closed — paper trading paused.");
      return;
    }
    try {
      await api("/api/paper/topup", { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Topup failed");
    }
  }

  return (
    <div className="guide">
      <PageHeader
        kicker="My trades"
        title="Paper book"
        lede="Local paper cash, open trades, and closed trades. The Zerodha account stays on My Account."
      />
      {error ? <p className="down">{error}</p> : null}
      {marketClosed ? <p className="muted">Market closed — paper buy/sell/topup blocked until the next session.</p> : null}
      <div className="grid kpis">
        <div className="card kpi">
          <div className="label">Paper cash</div>
          <div className="value mono">{desk?.paper?.cash != null ? showRupee(desk.paper.cash, 0) : "—"}</div>
          <button type="button" className="btn" style={{ marginTop: 8 }} disabled={marketClosed} onClick={() => void topup()}>
            +₹25k
          </button>
        </div>
        <div className="card kpi">
          <div className="label">Paper open</div>
          <div className="value">{paperOpen.length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Paper closed</div>
          <div className="value">{paperClosed.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Paper positions</h2>
          <span className="muted">Training wallet</span>
        </div>
        {paperOpen.length === 0 ? (
          <p className="muted">No open paper positions. Use TRAIN BUY on Options/Stocks or turn Autopilot on.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Now</th>
                <th>uPnL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paperOpen.map((row) => (
                <tr key={row.id}>
                  <td className="mono">
                    {row.exchange}:{row.symbol}
                  </td>
                  <td className="mono">{showDec(row.quantity, 0)}</td>
                  <td className="mono">{showDec(row.averageEntry)}</td>
                  <td className="mono">{row.currentPrice != null ? showDec(row.currentPrice) : "—"}</td>
                  <td className={`mono ${Number(row.unrealisedPnl ?? 0) >= 0 ? "up" : "down"}`}>
                    {row.unrealisedPnl != null ? showDec(row.unrealisedPnl) : "—"}
                  </td>
                  <td>
                    <button type="button" className="btn" disabled={marketClosed} onClick={() => void closePaper(row.id)}>
                      SELL
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Recent paper closes</h2>
        </div>
        {paperClosed.length === 0 ? (
          <p className="muted">Closed training trades will show here with predicted vs actual.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>PnL</th>
                <th>Why closed</th>
              </tr>
            </thead>
            <tbody>
              {paperClosed.map((row) => {
                const pred = (row.meta?.prediction ?? {}) as { eodPremium?: string };
                return (
                  <tr key={row.id}>
                    <td className="mono">{row.symbol}</td>
                    <td className="mono">{showDec(row.averageEntry)}</td>
                    <td className="mono" title={pred.eodPremium ? `Predicted EOD ${showDec(pred.eodPremium)}` : undefined}>
                      {row.currentPrice != null ? showDec(row.currentPrice) : "—"}
                    </td>
                    <td className={`mono ${Number(row.realisedPnl ?? 0) >= 0 ? "up" : "down"}`}>
                      {row.realisedPnl != null ? showDec(row.realisedPnl) : "—"}
                    </td>
                    <td className="muted">{row.closeReason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
