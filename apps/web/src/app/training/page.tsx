"use client";

import { HorizonCompareCard } from "@/components/HorizonCompareCard";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { showDec } from "@/lib/format";
import { useEffect, useState } from "react";

type Desk = {
  live: {
    phase: string;
    marketOpen: boolean;
    lastTickAt: string | null;
    cursor: number;
    trackedCount: number;
    message: string | null;
    recentScans: Array<{ at: string; exchange: string; symbol: string; ok: boolean; detail?: string }>;
    recentTunes: Array<{
      at: string;
      exchange: string;
      symbol: string;
      tuned: boolean;
      reason: string;
      mae?: number | null;
    }>;
    progress: {
      kind: string;
      cycle: number;
      done: number;
      total: number;
      pct: number;
      label: string;
    };
  };
  kpis: {
    trackedSymbols: number;
    paramModels: number;
    predictionsTotal: number;
    predictionsResolved: number;
    predictionsOpen: number;
    eodAlgo: number;
    eodAi: number;
    paperTrades: number;
    candleBars: number;
    quoteCacheRows: number;
    estimatedLedgerKb: number;
    archivedSymbols?: number;
    archivedPredictions?: number;
  };
  symbols: Array<{
    exchange: string;
    symbol: string;
    predictions: number;
    resolved: number;
    open: number;
    mae: number | null;
    algoMae: number | null;
    aiMae: number | null;
    algoLastTuned: string | null;
    aiLastTuned: string | null;
    paramsVersion: number | null;
    algoDeltaKeys: number;
    aiDeltaKeys: number;
  }>;
};

function ago(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 0)) return iso;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export default function TrainingPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Desk>("/api/learning/desk");
        if (!cancelled) {
          setDesk(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load training desk");
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const k = desk?.kpis;
  const live = desk?.live;

  return (
    <div className="guide">
      <PageHeader
        kicker="Learning loop"
        title="Training"
        lede="Whitelist-only from Settings. While the market is open, each scan cycle fills 0→100% then restarts. After close, one tune cycle runs and stays at 100% until the next session."
      />
      {error ? <p className="down">{error}</p> : null}

      <HorizonCompareCard />

      <div className="card train-progress-card">
        <div className="section-head">
          <h2>Cycle progress</h2>
          <span className="mono">{showDec(live?.progress?.pct ?? 0, 3)}%</span>
        </div>
        <div className="train-progress" role="progressbar" aria-valuenow={live?.progress?.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="train-progress-fill" style={{ width: `${Math.min(100, Math.max(0, live?.progress?.pct ?? 0))}%` }} />
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {live?.progress?.label ?? "Idle"}
          {live?.progress?.total ? ` · ${live.progress.done}/${live.progress.total}` : ""}
          {live?.message ? ` — ${live.message}` : ""}
        </p>
        <p className="muted" style={{ marginTop: 4, fontSize: "var(--fs-kicker)" }}>
          {live?.marketOpen
            ? "Market open: scan cycles repeat (bar resets each pass) until 15:30 IST."
            : "Market closed: one tune cycle per session, then idle at 100% until tomorrow."}
        </p>
      </div>

      <div className="grid kpis" style={{ marginTop: 12 }}>
        <div className="card kpi">
          <div className="label">Phase</div>
          <div className="value">{live?.phase ?? "—"}</div>
          <div className="muted">{live?.marketOpen ? "Market open" : "Market closed / off hours"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Whitelist</div>
          <div className="value">{k?.trackedSymbols ?? "—"}</div>
          <div className="muted">
            cycle #{live?.progress?.cycle ?? 0}
            {(k?.archivedSymbols ?? 0) > 0 ? ` · ${k?.archivedSymbols} archived` : ""}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Predictions</div>
          <div className="value mono">{k?.predictionsTotal ?? "—"}</div>
          <div className="muted">
            {k?.predictionsResolved ?? 0} resolved · {k?.predictionsOpen ?? 0} open
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Data size</div>
          <div className="value mono">~{k?.estimatedLedgerKb ?? 0} KB</div>
          <div className="muted">
            {k?.candleBars ?? 0} bars · {k?.quoteCacheRows ?? 0} quotes
          </div>
        </div>
      </div>

      <div className="grid kpis" style={{ marginTop: 12 }}>
        <div className="card kpi">
          <div className="label">EOD ALGO</div>
          <div className="value mono">{k?.eodAlgo ?? 0}</div>
        </div>
        <div className="card kpi">
          <div className="label">EOD AI</div>
          <div className="value mono">{k?.eodAi ?? 0}</div>
        </div>
        <div className="card kpi">
          <div className="label">Paper fills</div>
          <div className="value mono">{k?.paperTrades ?? 0}</div>
        </div>
        <div className="card kpi">
          <div className="label">Param models</div>
          <div className="value mono">{k?.paramModels ?? 0}</div>
          <div className="muted">Last tick {ago(live?.lastTickAt ?? null)}</div>
        </div>
      </div>

      {live?.message && !live?.progress ? <p className="muted" style={{ marginTop: 10 }}>{live.message}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-head">
          <h2>Batch activity</h2>
          <span className="muted">Whitelist only</span>
        </div>
        <div className="train-split">
          <div>
            <h3 className="muted">Scans</h3>
            {!live?.recentScans.length ? (
              <p className="muted">Waiting for the next agent tick…</p>
            ) : (
              <ul className="train-log">
                {live.recentScans.slice(0, 16).map((ev, i) => (
                  <li key={`${ev.at}-${ev.symbol}-${i}`} className={ev.ok ? "" : "down"}>
                    <span className="mono">{ago(ev.at)}</span>{" "}
                    <strong>{ev.symbol}</strong> {ev.detail ?? (ev.ok ? "ok" : "fail")}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="muted">Tunes</h3>
            {!live?.recentTunes.length ? (
              <p className="muted">Tunes appear after 15:30 IST once actuals resolve.</p>
            ) : (
              <ul className="train-log">
                {live.recentTunes.slice(0, 16).map((ev, i) => (
                  <li key={`${ev.at}-${ev.symbol}-${i}`}>
                    <span className="mono">{ago(ev.at)}</span>{" "}
                    <strong>{ev.symbol}</strong> {ev.tuned ? "tuned" : "skip"} · {ev.reason}
                    {ev.mae != null ? ` · MAE ${showDec(ev.mae, 3)}%` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-head">
          <h2>Per-symbol ledger</h2>
          <span className="muted">Whitelist only — removed symbols stay in local DB</span>
        </div>
        {!desk?.symbols.length ? (
          <p className="muted">No prediction rows yet — keep the desk running through the session.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Pts</th>
                <th>Resolved</th>
                <th>Open</th>
                <th>MAE</th>
                <th>ALGO</th>
                <th>AI</th>
                <th>Δ keys</th>
                <th>Tuned</th>
              </tr>
            </thead>
            <tbody>
              {desk.symbols.map((row) => (
                <tr key={`${row.exchange}:${row.symbol}`}>
                  <td>
                    <strong>{row.symbol}</strong>
                  </td>
                  <td className="mono">{row.predictions}</td>
                  <td className="mono">{row.resolved}</td>
                  <td className="mono">{row.open}</td>
                  <td className="mono">{row.mae != null ? `${showDec(row.mae, 3)}%` : "—"}</td>
                  <td className="mono">{row.algoMae != null ? `${showDec(row.algoMae, 3)}%` : "—"}</td>
                  <td className="mono">{row.aiMae != null ? `${showDec(row.aiMae, 3)}%` : "—"}</td>
                  <td className="mono">
                    {row.algoDeltaKeys}/{row.aiDeltaKeys}
                  </td>
                  <td className="mono muted">{row.algoLastTuned ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
