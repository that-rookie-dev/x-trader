"use client";

import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type WatchItem = {
  exchange: string;
  symbol: string;
  orderable: boolean;
  autoEnabled: boolean;
  lastPrice: string | null;
};

type FnoName = {
  exchange: string;
  symbol: string;
  kind?: string;
  nextExpiry?: string | null;
};

export function TrackedSymbolsPanel() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [names, setNames] = useState<FnoName[]>([]);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [watch, opts] = await Promise.all([
      api<WatchItem[]>("/api/market/watchlist"),
      api<{ names: FnoName[] }>("/api/options/names"),
    ]);
    setItems(watch);
    setNames(opts.names ?? []);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "failed"));
  }, []);

  async function add() {
    const name = names.find((n) => n.symbol === pick);
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      setItems(
        await api<WatchItem[]>("/api/market/watchlist", {
          method: "POST",
          body: JSON.stringify({
            exchange: name.exchange,
            symbol: name.symbol,
            orderable: name.kind !== "INDEX",
            autoEnabled: true,
          }),
        }),
      );
      setPick("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: WatchItem) {
    setBusy(true);
    setMsg(null);
    try {
      setItems(
        await api<WatchItem[]>("/api/market/watchlist/remove", {
          method: "POST",
          body: JSON.stringify({ exchange: item.exchange, symbol: item.symbol }),
        }),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "remove failed");
    } finally {
      setBusy(false);
    }
  }

  const trackedKeys = new Set(items.map((i) => `${i.exchange}:${i.symbol}`));
  const available = names.filter((n) => !trackedKeys.has(`${n.exchange}:${n.symbol}`));

  return (
    <div className="card">
      <div className="section-head">
        <h2>Tracked F&amp;O symbols</h2>
        <span className="badge ok">{items.length} live</span>
      </div>
      <p className="muted">
        Only these underlyings are scanned and trained in the background. Options page stays one-symbol.
        Removing a name hides it from Training KPIs; local history is kept for later.
      </p>
      {msg ? <p className="down">{msg}</p> : null}
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <select
          className="input"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="">Add underlying…</option>
          {available.map((n) => (
            <option key={`${n.exchange}:${n.symbol}`} value={n.symbol}>
              {n.symbol}
              {n.kind ? ` · ${n.kind}` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn primary" disabled={!pick || busy} onClick={() => void add()}>
          Add
        </button>
      </div>
      <table style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Exch</th>
            <th>LTP</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {!items.length ? (
            <tr>
              <td colSpan={4} className="muted">
                No tracked symbols yet — add NIFTY / BANKNIFTY / stocks with F&amp;O.
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={`${item.exchange}:${item.symbol}`}>
                <td>
                  <strong>{item.symbol}</strong>
                </td>
                <td className="mono">{item.exchange}</td>
                <td className="mono">{item.lastPrice ?? "—"}</td>
                <td>
                  <button type="button" className="btn" disabled={busy} onClick={() => void remove(item)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
