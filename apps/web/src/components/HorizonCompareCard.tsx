"use client";

import { HorizonCompare, type ComparePoint } from "@/components/HorizonCompare";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

const HORIZONS = ["5m", "15m", "30m", "1h", "4h", "6h", "eod"] as const;

type Compare = {
  symbol: string | null;
  horizon: string;
  sessionDate: string;
  symbols: Array<{ exchange: string; symbol: string }>;
  points: ComparePoint[];
};

export function HorizonCompareCard() {
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>("5m");
  const [symbol, setSymbol] = useState("");
  const [compare, setCompare] = useState<Compare | null>(null);
  const [showAlgo, setShowAlgo] = useState(true);
  const [showAi, setShowAi] = useState(true);
  const [candles, setCandles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Compare>(`/api/horizon/compare?symbol=${encodeURIComponent(symbol)}&horizon=${horizon}`);
        if (cancelled) return;
        setCompare(data);
        if (data.symbol && data.symbol !== symbol) setSymbol(data.symbol);
      } catch {
        /* training page already shows a load error */
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, horizon]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
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
          <button type="button" className={showAlgo ? "on" : ""} onClick={() => setShowAlgo((on) => !on)}>
            <i className="algo" /> Algo
          </button>
          <button type="button" className={showAi ? "on" : ""} onClick={() => setShowAi((on) => !on)}>
            <i className="ai" /> AI
          </button>
          <button type="button" className={candles ? "on" : ""} onClick={() => setCandles((on) => !on)}>
            {candles ? "Candles" : "Line"}
          </button>
        </div>
      </div>
      <p className="muted compare-note">
        Market is the price that printed. Algo and AI are the model price for that horizon, drawn on the minute it was aimed at.
      </p>
      <HorizonCompare points={compare?.points ?? []} horizon={horizon} showAlgo={showAlgo} showAi={showAi} candles={candles} />
    </div>
  );
}
