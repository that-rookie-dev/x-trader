"use client";

import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type PaperPos = {
  id: string;
  symbol: string;
  quantity: string;
  averageEntry: string;
  currentPrice?: string | null;
  unrealisedPnl?: string | null;
  realisedPnl: string;
  status: string;
};
type Order = {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  status: string;
  averagePrice?: string | null;
};
type Memory = { id: string; strategy: string; regime: string; sampleCount: number; wins: number; losses: number };
type Holding = { instrument: { symbol: string; exchange: string }; quantity: string; averagePrice: string; lastPrice?: string; pnl?: string };

type Desk = {
  paper: { account: { cash: string } | null; positions: PaperPos[]; orders: Order[] };
  journal: { memory: Memory[] };
  holdings: Holding[] | null;
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

  async function close(id: string) {
    await api(`/api/paper/positions/${id}/close`, { method: "POST", body: "{}" });
    await load();
  }

  const open = (desk?.paper.positions ?? []).filter((row) => row.status === "OPEN");
  const memory = desk?.journal.memory ?? [];
  const wins = memory.reduce((sum, row) => sum + row.wins, 0);
  const losses = memory.reduce((sum, row) => sum + row.losses, 0);

  return (
    <div className="guide">
      <div className="page-hero">
        <div>
          <p className="eyebrow">My trades</p>
          <h1>What you have</h1>
          <p className="lede">Play-money tries stay here so we can see if the helper was right. Real holdings are shown separately.</p>
        </div>
      </div>
      {error ? <p className="down">{error}</p> : null}
      <div className="grid kpis">
        <div className="card kpi">
          <div className="label">Play money left</div>
          <div className="value">{desk?.paper.account?.cash ?? "—"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Open play trades</div>
          <div className="value">{open.length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Was the helper right?</div>
          <div className="value">
            {wins + losses === 0 ? "—" : `${wins} yes / ${losses} no`}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Play-money positions</h2>
        {open.length === 0 ? (
          <p className="muted">None yet. Use “Try with play money” on Options or Stocks.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Bought at</th>
                <th>Now</th>
                <th>Result so far</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((row) => (
                <tr key={row.id}>
                  <td>{row.symbol}</td>
                  <td className="mono">{row.quantity}</td>
                  <td className="mono">{row.averageEntry}</td>
                  <td className="mono">{row.currentPrice ?? "—"}</td>
                  <td className={`mono ${Number(row.unrealisedPnl ?? 0) >= 0 ? "up" : "down"}`}>{row.unrealisedPnl ?? "—"}</td>
                  <td>
                    <button className="btn" onClick={() => void close(row.id)}>
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Play-money history</h2>
        {(desk?.paper.orders ?? []).length === 0 ? (
          <p className="muted">No play-money orders yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Action</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(desk?.paper.orders ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.symbol}</td>
                  <td>{row.side === "BUY" ? "Bought" : "Sold"}</td>
                  <td className="mono">{row.quantity}</td>
                  <td className="mono">{row.averagePrice ?? "—"}</td>
                  <td>{row.status === "FILLED" ? "Done" : row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>What you really own</h2>
        {!desk?.holdings ? (
          <p className="muted">Connect Zerodha to see your real holdings.</p>
        ) : desk.holdings.length === 0 ? (
          <p className="muted">You do not own any stocks in the real account right now.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Bought at</th>
                <th>Now</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {desk.holdings.map((row) => (
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
