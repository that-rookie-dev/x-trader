"use client";

import { HorizonCompare, type ComparePoint } from "@/components/HorizonCompare";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { showDec, showRupee } from "@/lib/format";
import { useEffect, useState } from "react";

const HORIZONS = ["5m", "15m", "30m", "1h", "4h", "6h", "eod"] as const;

type Compare = {
  symbol: string | null;
  exchange: string | null;
  horizon: string;
  sessionDate: string;
  symbols: Array<{ exchange: string; symbol: string }>;
  points: ComparePoint[];
};

type Memory = { id: string; strategy: string; regime: string; sampleCount: number; wins: number; losses: number; expectancy?: string | null };
type Holding = { instrument: { symbol: string; exchange: string }; quantity: string; averagePrice: string; lastPrice?: string; pnl?: string };
type BrokerPos = { instrument: { symbol: string; exchange: string }; quantity: string; lastPrice?: string; pnl?: string };
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
  holdings: Holding[] | null;
  brokerPos: BrokerPos[] | null;
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
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>("5m");
  const [symbol, setSymbol] = useState("");
  const [compare, setCompare] = useState<Compare | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function loadCompare() {
      try {
        const data = await api<Compare>(`/api/horizon/compare?symbol=${encodeURIComponent(symbol)}&horizon=${horizon}`);
        if (cancelled) return;
        setCompare(data);
        if (data.symbol && data.symbol !== symbol) setSymbol(data.symbol);
      } catch {
        /* desk error already covers a dead API */
      }
    }
    void loadCompare();
    const id = window.setInterval(() => void loadCompare(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, horizon]);

  const memory = desk?.journal.memory ?? [];
  const paperMem = memory.filter((m) => m.id); // all memory; expectancy from paper+live
  const wins = paperMem.reduce((sum, row) => sum + row.wins, 0);
  const losses = paperMem.reduce((sum, row) => sum + row.losses, 0);
  const paperOpen = desk?.paper?.positions ?? [];
  const paperClosed = desk?.paper?.closed ?? [];
  const marketClosed = Boolean(desk?.paper?.marketClosed);
  const learning = desk?.learning;
  const branchMae =
    learning?.predictionMode === "AI" ? learning?.ai?.scoreMae : learning?.algo?.scoreMae;

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
        title="Training + Zerodha"
        lede="Paper wallet trains predictions locally. Zerodha holdings stay read-only — this app never sends a live order."
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
          <div className="label">Pred MAE</div>
          <div className="value mono">
            {(branchMae ?? learning?.mae) != null ? `${showDec(branchMae ?? learning?.mae, 2)}%` : "—"}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Dir hit</div>
          <div className="value mono">
            {learning?.hitRate != null ? `${showDec(learning.hitRate * 100, 0)}%` : wins + losses === 0 ? "—" : `${wins}/${losses}`}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Horizon compare</h2>
          <span className="muted">{compare?.sessionDate ?? "today"} · every quote, saved each minute</span>
        </div>
        <div className="compare-bar">
          <label className="news-pick">
            <span>Symbol</span>
            <select value={compare?.symbol ?? symbol} onChange={(event) => setSymbol(event.target.value)}>
              {(compare?.symbols ?? []).map((item) => (
                <option key={`${item.exchange}:${item.symbol}`} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
          </label>
          <div className="news-slot">
            <span>Horizon</span>
            <div>
              {HORIZONS.map((id) => (
                <button key={id} type="button" className={id === horizon ? "on" : ""} onClick={() => setHorizon(id)}>
                  {id === "eod" ? "EOD" : id}
                </button>
              ))}
            </div>
          </div>
          <div className="compare-key">
            <i className="mkt" /> Market
            <i className="algo" /> Algo
            <i className="ai" /> AI
          </div>
        </div>
        <p className="muted compare-note">
          Market is the live price on each quote. Algo and AI are the horizon price named on that same quote. A minute of quotes is written together.
        </p>
        <HorizonCompare points={compare?.points ?? []} />
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

      <div className="card">
        <div className="section-head">
          <h2>What you own</h2>
          <span className="muted">Zerodha</span>
        </div>
        {!desk?.holdings ? (
          <p className="muted">Connect Zerodha to see holdings.</p>
        ) : desk.holdings.length === 0 ? (
          <p className="muted">No stock holdings right now.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Bought at</th>
                <th>Now</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {desk.holdings.map((row) => (
                <tr key={`${row.instrument.exchange}:${row.instrument.symbol}`}>
                  <td>{row.instrument.symbol}</td>
                  <td className="mono">{showDec(row.quantity, 0)}</td>
                  <td className="mono">{showDec(row.averagePrice)}</td>
                  <td className="mono">{row.lastPrice != null ? showDec(row.lastPrice) : "—"}</td>
                  <td className="mono">{row.pnl != null ? showDec(row.pnl) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {desk?.brokerPos && desk.brokerPos.length > 0 ? (
        <div className="card">
          <div className="section-head">
            <h2>Zerodha positions</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Qty</th>
                <th>Now</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {desk.brokerPos.map((row) => (
                <tr key={`${row.instrument.exchange}:${row.instrument.symbol}`}>
                  <td>{row.instrument.symbol}</td>
                  <td className="mono">{showDec(row.quantity, 0)}</td>
                  <td className="mono">{row.lastPrice != null ? showDec(row.lastPrice) : "—"}</td>
                  <td className="mono">{row.pnl != null ? showDec(row.pnl) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
