"use client";

import { api } from "@/lib/api";
import { showDec } from "@/lib/format";
import { useEffect, useRef, useState } from "react";

type Name = { exchange: string; symbol: string };
type Headline = { title: string; url: string; snippet: string };
type Entry = { at: string; score: number; points: number; summary: string; headlines: Headline[] };
type Feed = {
  active?: boolean;
  symbols: Name[];
  symbol: string | null;
  exchange: string | null;
  delta: { score: number; points: number; summary: string; updatedAt: string } | null;
  entries: Entry[];
};

const MEMORY = "xtrader-news-symbol";

export default function NewsPage() {
  const [symbol, setSymbol] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(MEMORY) ?? "";
    if (saved) setSymbol(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Feed>(`/api/news/feed?symbol=${encodeURIComponent(symbol)}`);
        if (cancelled) return;
        setFeed(data);
        setError(null);
        if (data.symbol && data.symbol !== symbol) setSymbol(data.symbol);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the news tape");
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed?.entries.length, feed?.symbol]);

  const delta = feed?.delta;
  const points = delta?.points ?? 0;

  if (!feed) return <div className="news-page" />;

  if (feed.active === false) {
    return (
      <div className="news-page">
        <p className="news-off">Not active. Connect an active LLM model to enable this delta.</p>
      </div>
    );
  }

  return (
    <div className="news-page">
      <div className="news-bar">
        <div>
          <p className="eyebrow">NEWS TAPE</p>
          <h1>Read</h1>
        </div>
        <label className="news-pick">
          <span>Symbol</span>
          <select
            value={feed?.symbol ?? symbol}
            onChange={(event) => {
              const next = event.target.value;
              setSymbol(next);
              localStorage.setItem(MEMORY, next);
            }}
          >
            {(feed?.symbols ?? []).map((item) => (
              <option key={`${item.exchange}:${item.symbol}`} value={item.symbol}>
                {item.symbol}
              </option>
            ))}
          </select>
        </label>
        <div className={`news-delta ${points > 0 ? "up" : points < 0 ? "down" : ""}`}>
          <span>Delta</span>
          <b>{points > 0 ? "+" : ""}{showDec(points, 1)}</b>
          <small>{delta ? `score ${showDec(delta.score, 2)}` : "waiting"}</small>
        </div>
      </div>
      {error ? <p className="news-error">{error}</p> : null}
      <div className="news-term" ref={scrollRef}>
        {(feed?.entries ?? []).length === 0 ? (
          <p className="news-line muted">Waiting for the next 15-minute read.</p>
        ) : (
          feed?.entries.map((entry) => (
            <article key={entry.at} className="news-block">
              <p className="news-line">
                <time>{clock(entry.at)}</time>
                <span className={entry.points > 0 ? "up" : entry.points < 0 ? "down" : ""}>
                  {entry.points > 0 ? "+" : ""}
                  {showDec(entry.points, 1)} pts
                </span>
                <span>score {showDec(entry.score, 2)}</span>
              </p>
              <p className="news-line llm">{entry.summary || "Model returned no summary."}</p>
              {entry.headlines.map((item) => (
                <p key={item.url || item.title} className="news-line src">
                  {item.title}
                  {item.snippet ? <span> — {item.snippet}</span> : null}
                </p>
              ))}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
