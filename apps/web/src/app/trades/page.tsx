"use client";

import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type Memory = { id: string; strategy: string; regime: string; sampleCount: number; wins: number; losses: number };
type Holding = { instrument: { symbol: string; exchange: string }; quantity: string; averagePrice: string; lastPrice?: string; pnl?: string };
type BrokerPos = { instrument: { symbol: string; exchange: string }; quantity: string; lastPrice?: string; pnl?: string };
type PlayRow = { id: string; status: string; contract: string; side: string; expectancyNote?: string | null; at: string };

type Desk = {
  journal: { memory: Memory[] };
  holdings: Holding[] | null;
  brokerPos: BrokerPos[] | null;
  plays: PlayRow[];
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

  const memory = desk?.journal.memory ?? [];
  const wins = memory.reduce((sum, row) => sum + row.wins, 0);
  const losses = memory.reduce((sum, row) => sum + row.losses, 0);
  const plays = desk?.plays ?? [];

  return (
    <div className="guide">
      <div className="page-hero">
        <div>
          <p className="eyebrow">My trades</p>
          <h1>Zerodha truth</h1>
          <p className="lede">Holdings and positions from Zerodha. Plays reconcile to fills you placed there — this app never sends an order.</p>
        </div>
      </div>
      {error ? <p className="down">{error}</p> : null}
      <div className="grid kpis">
        <div className="card kpi">
          <div className="label">Open plays</div>
          <div className="value">{plays.filter((p) => p.status === "OPEN" || p.status === "DISMISSED").length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Filled (learned)</div>
          <div className="value">{plays.filter((p) => p.status === "FILLED" || p.status === "PARTIAL").length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Setup expectancy</div>
          <div className="value">{wins + losses === 0 ? "—" : `${wins} yes / ${losses} no`}</div>
        </div>
      </div>

      <div className="card">
        <h2>Plays</h2>
        {plays.length === 0 ? (
          <p className="muted">No plays yet. Dismissed and filled ideas from Options/Stocks land here after reconcile.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Contract</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {plays.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{new Date(row.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.side} {row.contract}
                  </td>
                  <td className="muted">{row.expectancyNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>What you own (Zerodha)</h2>
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

      <div className="card">
        <h2>Day positions (Zerodha)</h2>
        {!desk?.brokerPos ? (
          <p className="muted">Connect Zerodha to see positions.</p>
        ) : desk.brokerPos.length === 0 ? (
          <p className="muted">No open day positions.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Now</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {desk.brokerPos.map((row) => (
                <tr key={`${row.instrument.exchange}:${row.instrument.symbol}`}>
                  <td>{row.instrument.symbol}</td>
                  <td className="mono">{row.quantity}</td>
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
