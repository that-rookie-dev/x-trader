"use client";

import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { showDec, showRupee, showSignedRupee } from "@/lib/format";
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
  fees?: string | null;
  direction?: string;
  status: string;
  meta?: { prediction?: { eodPremium?: string | null; why?: string | null }; kind?: string; source?: string };
  closeReason?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
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
  const [picked, setPicked] = useState<PaperPos | null>(null);

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
                const pred = row.meta?.prediction ?? {};
                return (
                  <tr key={row.id} className="click-row" onClick={() => setPicked(row)}>
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
      {picked ? <CloseSheet row={picked} onClose={() => setPicked(null)} /> : null}
    </div>
  );
}

function CloseSheet({ row, onClose }: { row: PaperPos; onClose: () => void }) {
  const qty = Number(row.quantity);
  const entry = Number(row.averageEntry);
  const exit = row.currentPrice != null ? Number(row.currentPrice) : null;
  const fees = Number(row.fees ?? 0);
  const long = (row.direction ?? "LONG") !== "SHORT";
  const spent = Number.isFinite(entry) && Number.isFinite(qty) ? entry * qty : null;
  const back = exit != null && Number.isFinite(exit) && Number.isFinite(qty) ? exit * qty : null;
  const result = row.realisedPnl != null ? Number(row.realisedPnl) : null;
  const when = (at?: string | null) =>
    at
      ? new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })
      : "—";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet close-sheet" role="dialog" aria-label={row.symbol} onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <div>
            <p className="eyebrow">{long ? "CLOSED BUY" : "CLOSED SHORT"}</p>
            <h2 className="mono">{row.symbol}</h2>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className={`close-result mono ${result != null && result >= 0 ? "up" : "down"}`}>
          {result != null ? (result >= 0 ? "Profit " : "Loss ") + showSignedRupee(result) : "—"}
        </p>
        <dl className="close-grid">
          <div>
            <dt>Quantity</dt>
            <dd className="mono">{Number.isFinite(qty) ? showDec(qty, 0) : "—"}</dd>
          </div>
          <div>
            <dt>Entry</dt>
            <dd className="mono">{Number.isFinite(entry) ? showDec(entry) : "—"}</dd>
          </div>
          <div>
            <dt>Exit</dt>
            <dd className="mono">{exit != null && Number.isFinite(exit) ? showDec(exit) : "—"}</dd>
          </div>
          <div>
            <dt>{long ? "Spent" : "Credited"}</dt>
            <dd className="mono">{spent != null ? showRupee(spent) : "—"}</dd>
          </div>
          <div>
            <dt>{long ? "Got back" : "Bought back"}</dt>
            <dd className="mono">{back != null ? showRupee(back) : "—"}</dd>
          </div>
          <div>
            <dt>Charges</dt>
            <dd className="mono">{showRupee(fees)}</dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd className="mono">{when(row.openedAt)}</dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd className="mono">{when(row.closedAt)}</dd>
          </div>
          <div>
            <dt>Why</dt>
            <dd>{row.closeReason ?? "—"}</dd>
          </div>
          {row.meta?.prediction?.eodPremium ? (
            <div>
              <dt>Predicted premium</dt>
              <dd className="mono">{showDec(row.meta.prediction.eodPremium)}</dd>
            </div>
          ) : null}
        </dl>
        {row.meta?.prediction?.why ? <p className="muted">{row.meta.prediction.why}</p> : null}
      </div>
    </div>
  );
}
