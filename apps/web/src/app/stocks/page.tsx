"use client";

import { AdviceCard } from "@/components/AdviceCard";
import { CandleChart } from "@/components/CandleChart";
import { api } from "@/lib/api";
import type { PlainIdea, Play, QuoteTick, StocksDesk } from "@/lib/desk";
import { applyTickCandle, mergeCandles } from "@/lib/live";
import { useEffect, useState } from "react";

function tapeTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

type Candle = { time: number; open: number; high: number; low: number; close: number };

function patchIdeas(ideas: PlainIdea[], quotes: QuoteTick[]): PlainIdea[] {
  if (!quotes.length) return ideas;
  const map = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));
  return ideas.map((idea) => {
    const q = map.get(`${idea.exchange}:${idea.contract}`) ?? map.get(`NSE:${idea.contract}`);
    if (!q?.lastPrice) return idea;
    return { ...idea, lastPrice: q.lastPrice, premium: idea.kind === "EQ" ? q.lastPrice : (idea.premium ?? q.lastPrice) };
  });
}

export default function StocksPage() {
  const [desk, setDesk] = useState<StocksDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<StocksDesk>("/api/stocks/desk");
      setDesk(data);
      const focus = data.buys[0]?.contract ?? data.sells[0]?.contract ?? null;
      if (focus && focus !== chartSymbol) setChartSymbol(focus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load stocks");
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!desk) return;
    const keys = [...desk.buys, ...desk.sells]
      .map((idea) => `${idea.exchange}:${idea.contract}`)
      .filter(Boolean)
      .join(",");
    if (!keys) return;
    let cancelled = false;
    async function tick() {
      try {
        const data = await api<{ quotes: QuoteTick[] }>(`/api/options/quotes?keys=${encodeURIComponent(keys)}`);
        if (cancelled || !data.quotes.length) return;
        setDesk((prev) =>
          prev
            ? { ...prev, buys: patchIdeas(prev.buys, data.quotes), sells: patchIdeas(prev.sells, data.quotes) }
            : prev,
        );
      } catch {
        /* keep last desk */
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [desk?.buys.map((i) => i.contract).join(), desk?.sells.map((i) => i.contract).join()]);

  useEffect(() => {
    if (!chartSymbol) return;
    let cancelled = false;
    async function loadCandles() {
      try {
        const rows = await api<Candle[]>(`/api/market/candles?exchange=NSE&symbol=${encodeURIComponent(chartSymbol!)}&interval=5`);
        if (cancelled) return;
        setCandles((prev) => mergeCandles(prev, rows));
      } catch {
        /* keep last candles */
      }
    }
    setCandles([]);
    void loadCandles();
    const id = window.setInterval(() => void loadCandles(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [chartSymbol]);

  useEffect(() => {
    if (!chartSymbol) return;
    const source = new EventSource("/api/market/stream");
    const onTick = (ev: MessageEvent) => {
      let tick: QuoteTick & { receivedAt?: string };
      try {
        tick = JSON.parse(String(ev.data)) as QuoteTick & { receivedAt?: string };
      } catch {
        return;
      }
      if (!tick?.lastPrice) return;
      if (tick.symbol === chartSymbol) {
        const at = tick.receivedAt ? Date.parse(tick.receivedAt) : Date.now();
        setCandles((prev) => applyTickCandle(prev, Number(tick.lastPrice), at));
      }
      setDesk((prev) => {
        if (!prev) return prev;
        const quotes = [tick];
        return { ...prev, buys: patchIdeas(prev.buys, quotes), sells: patchIdeas(prev.sells, quotes) };
      });
    };
    source.addEventListener("tick", onTick);
    return () => {
      source.removeEventListener("tick", onTick);
      source.close();
    };
  }, [chartSymbol]);

  async function tryPaper(idea: PlainIdea) {
    setBusy(true);
    try {
      await api("/api/paper/try", {
        method: "POST",
        body: JSON.stringify({
          exchange: idea.exchange,
          symbol: idea.contract,
          side: idea.action === "SELL" ? "SELL" : "BUY",
          instrumentType: idea.instrumentType,
        }),
      });
      setNotes((prev) => ({ ...prev, [idea.contract]: "Saved as a play-money try. Open My trades to see how it goes." }));
    } catch (e) {
      setNotes((prev) => ({
        ...prev,
        [idea.contract]: e instanceof Error ? e.message : "Could not place play-money order",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function dismissPlay(id: string) {
    try {
      const data = await api<{ play: Play }>(`/api/plays/${id}/dismiss`, { method: "POST", body: "{}" });
      setDesk((prev) =>
        prev
          ? { ...prev, plays: (prev.plays ?? []).map((p) => (p.id === data.play.id ? data.play : p)) }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss");
    }
  }

  return (
    <div className="guide">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Stocks</p>
          <h1>Swing book, same-day overlay</h1>
          <p className="lede">Swing and positional ranks are the main list. TODAY is only a same-session breakout. You still place the order on Zerodha.</p>
        </div>
      </div>
      {error ? <p className="down">{error}</p> : null}
      {(desk?.plays ?? []).length ? (
        <ul className="signal-tape" data-coach="tape">
          {(desk?.plays ?? []).slice(0, 4).map((row) => (
            <li key={row.id} className={row.status === "FILLED" ? "up" : row.status === "MISSED" || row.status === "EXPIRED" ? "down" : ""}>
              <time>{tapeTime(row.at)}</time>
              <b>{row.status}</b>
              <span>{row.contract}</span>
              {row.expectancyNote ? <em>{row.expectancyNote}</em> : null}
              {row.status === "OPEN" ? (
                <button type="button" className="tape-dismiss" onClick={() => void dismissPlay(row.id)}>
                  Dismiss
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {chartSymbol ? (
        <div className="card">
          <p className="eyebrow">{chartSymbol}</p>
          <CandleChart candles={candles} />
        </div>
      ) : null}
      <div className="lane-col">
        <section data-coach="today">
          <h2>TODAY</h2>
          {(desk?.today ?? []).map((idea) => (
            <AdviceCard
              key={`today:${idea.contract}`}
              idea={idea}
              paperMode={Boolean(desk?.paperMode)}
              busy={busy}
              note={notes[idea.contract]}
              onPaper={(row) => void tryPaper(row)}
            />
          ))}
          {desk && (desk.today ?? []).length === 0 ? <div className="empty">No same-day volume breakout right now.</div> : null}
        </section>
        <section data-coach="swing">
          <h2>Swing / positional</h2>
          {(desk?.buys ?? []).map((idea) => (
            <AdviceCard
              key={`buy:${idea.contract}`}
              idea={idea}
              paperMode={Boolean(desk?.paperMode)}
              busy={busy}
              note={notes[idea.contract]}
              onPaper={(row) => void tryPaper(row)}
            />
          ))}
          {desk && desk.buys.length === 0 ? <div className="empty">Nothing looks worth buying today.</div> : null}
        </section>
        <section>
          <h2>Sell today</h2>
          {(desk?.sells ?? []).map((idea) => (
            <AdviceCard
              key={`sell:${idea.contract}`}
              idea={idea}
              paperMode={Boolean(desk?.paperMode)}
              busy={busy}
              note={notes[idea.contract]}
              onPaper={(row) => void tryPaper(row)}
            />
          ))}
          {desk && desk.sells.length === 0 ? (
            <div className="empty">No sell advice. The helper only talks about selling when you already own something.</div>
          ) : null}
        </section>
      </div>
      {!desk && !error ? <div className="card muted">Reading today’s list…</div> : null}
    </div>
  );
}
