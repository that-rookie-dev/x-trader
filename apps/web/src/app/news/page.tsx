"use client";

import { api } from "@/lib/api";
import { showDec } from "@/lib/format";
import { useEffect, useRef, useState } from "react";

type Name = { exchange: string; symbol: string };
type Headline = { title: string; url: string; snippet: string; note?: string; image?: string };
type Entry = { at: string; score: number; points: number; summary: string; headlines: Headline[] };
type Feed = {
  active?: boolean;
  symbols: Name[];
  symbol: string | null;
  exchange: string | null;
  delta: { score: number; points: number; summary: string; updatedAt: string } | null;
  entries: Entry[];
  work?: { running: boolean; phase: "idle" | "scraping" | "reading" | "scoring"; symbol: string };
};
type Preview = { url: string; site: string; title: string; description: string; image: string };

const MEMORY = "xtrader-news-symbol";
const SLOT_MS = 15 * 60 * 1000;
const previews = new Map<string, Preview | null>();

const DELTA_TIP =
  "Points added to every horizon close, the same amount on Algo and AI. A positive delta lifts the predicted price. A negative delta pulls it down. A score of 1 or −1 moves the close by 0.15% of the last price, and never more than 0.4%. Zero leaves the close on the other inputs.";
const SCORE_TIP =
  "The model’s read of whether current news can move this name this session, from −1 to +1. That score becomes the delta. Near zero, news stays out of the forecast. Toward +1 the close rises. Toward −1 it falls.";

export default function NewsPage() {
  const [symbol, setSymbol] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState("");
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const saved = localStorage.getItem(MEMORY) ?? "";
    if (saved) setSymbol(saved);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
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
    const id = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  useEffect(() => {
    const entries = feed?.entries ?? [];
    const keys = entries.map((entry) => entry.at);
    if (seen.current == null) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = entries.filter((entry) => !seen.current?.has(entry.at));
    for (const entry of fresh) seen.current.add(entry.at);
    const latest = fresh.at(-1);
    if (!latest) return;
    setStreamKey(latest.at);
    setTyped("");
    const text = latest.summary || "Model returned no summary.";
    let index = 0;
    const timer = window.setInterval(() => {
      index += Math.max(1, Math.ceil(text.length / 80));
      setTyped(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
  }, [(feed?.entries ?? []).map((entry) => entry.at).join("|")]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = 0;
  }, [feed?.entries.length, feed?.symbol, typed]);

  const delta = feed?.delta;
  const points = delta?.points ?? 0;
  const score = delta?.score ?? 0;
  const nextAt = Math.ceil(now / SLOT_MS) * SLOT_MS;
  const remain = Math.max(0, nextAt - now);

  if (!feed) return <div className="news-page" />;

  if (feed.active === false) {
    return (
      <div className="news-page">
        <div className="news-thread">
          <article className="news-bubble">
            <p className="news-off">Not active. Connect an active LLM model to enable this delta.</p>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="news-page">
      <div className="news-bar">
        <div>
          <p className="eyebrow">NEWS</p>
          <h1>{feed.symbol ?? "Read"}</h1>
        </div>
        <label className="news-pick">
          <span>Symbol</span>
          <select
            value={feed.symbol ?? symbol}
            onChange={(event) => {
              const next = event.target.value;
              seen.current = null;
              setStreamKey(null);
              setSymbol(next);
              localStorage.setItem(MEMORY, next);
            }}
          >
            {feed.symbols.map((item) => (
              <option key={`${item.exchange}:${item.symbol}`} value={item.symbol}>
                {item.symbol}
              </option>
            ))}
          </select>
        </label>
        <div className="news-next">
          <span>Next read</span>
          <b className="mono">{clockRemain(remain)}</b>
        </div>
        <Stat label="Delta" value={`${points > 0 ? "+" : ""}${showDec(points, 1)}`} tone={tone(points)} tip={DELTA_TIP} />
        <Stat label="Score" value={`${score > 0 ? "+" : ""}${showDec(score, 2)}`} tone={tone(score)} tip={SCORE_TIP} />
      </div>
      {error ? <p className="news-error">{error}</p> : null}
      <div
        className="news-thread"
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollTop < 80;
        }}
      >
        {feed.work?.running ? (
          <article className="news-bubble live">
            <header>
              <time>{clock(new Date(now).toISOString())}</time>
              <span>{phaseLabel(feed.work.phase)}</span>
            </header>
            <p className="news-say">{phaseLine(feed.work.phase, feed.work.symbol || feed.symbol || "")}<i className="news-caret" /></p>
          </article>
        ) : null}
        <article className="news-bubble">
          <header>
            <time>{clock(new Date(nextAt).toISOString())}</time>
            <span>NEXT READ</span>
          </header>
          <p>The next pass runs in {clockRemain(remain)}. Until then this delta stays as it is.</p>
        </article>
        {feed.entries.length === 0 ? (
          <article className="news-bubble">
            <header>
              <time>{clock(new Date(now).toISOString())}</time>
              <span>STANDING BY</span>
            </header>
            <p>Waiting for the next 15-minute read. The forecast keeps running without a news shift until one arrives.</p>
          </article>
        ) : (
          feed.entries.map((entry) => {
            const live = entry.at === streamKey;
            const summary = live ? typed || "…" : entry.summary || "Model returned no summary.";
            return (
              <article key={entry.at} className={`news-bubble${live ? " live" : ""}`}>
                <header>
                  <time>{clock(entry.at)}</time>
                  <span className={tone(entry.points)}>
                    {entry.points > 0 ? "+" : ""}
                    {showDec(entry.points, 1)} pts
                  </span>
                  <span className={tone(entry.score)}>score {showDec(entry.score, 2)}</span>
                </header>
                <p className="news-say">
                  <b>{feed.symbol}. </b>
                  {summary}
                  {live && typed.length < (entry.summary || "").length ? <i className="news-caret" /> : null}
                </p>
                {entry.headlines.length > 0 ? (
                  <div className="news-cards">
                    {entry.headlines.map((item) => (
                      <LinkCard key={item.url || item.title} item={item} symbol={feed.symbol ?? ""} />
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone: toneName, tip }: { label: string; value: string; tone: string; tip: string }) {
  return (
    <div className={`news-stat ${toneName}`} tabIndex={0}>
      <span>{label}</span>
      <b className="mono">{value}</b>
      <p className="news-tip">{tip}</p>
    </div>
  );
}

function LinkCard({ item, symbol }: { item: Headline; symbol: string }) {
  const [card, setCard] = useState<Preview | null | undefined>(previews.get(item.url));
  const [imageOk, setImageOk] = useState(true);

  useEffect(() => {
    if (!item.url || previews.has(item.url)) {
      setCard(previews.get(item.url) ?? null);
      return;
    }
    let cancelled = false;
    api<Preview>(`/api/news/preview?url=${encodeURIComponent(item.url)}`)
      .then((data) => {
        const next = data.title || data.description || data.image ? data : null;
        previews.set(item.url, next);
        if (!cancelled) setCard(next);
      })
      .catch(() => {
        previews.set(item.url, null);
        if (!cancelled) setCard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.url]);

  const title = card?.title || item.title;
  const description = card?.description || item.snippet;
  const site = card?.site || host(item.url);
  const remote = (imageOk ? card?.image || item.image : "") || "";
  const image = remote ? `/api/news/image?url=${encodeURIComponent(remote)}` : "";

  return (
    <a className="news-card" href={item.url} target="_blank" rel="noreferrer">
      {image ? (
        <img src={image} alt="" onError={() => setImageOk(false)} />
      ) : (
        <span className="news-shot" aria-hidden="true" />
      )}
      <div>
        <small>{site || "SOURCE"}</small>
        <strong>{title || "Untitled"}</strong>
        {description ? <span>{description}</span> : null}
        {item.note ? <em>{symbol ? `${symbol}: ` : ""}{item.note}</em> : null}
      </div>
    </a>
  );
}

function phaseLabel(phase: string): string {
  if (phase === "scoring") return "MODEL";
  if (phase === "reading") return "READING";
  return "SCRAPING";
}

function phaseLine(phase: string, symbol: string): string {
  if (phase === "scoring") return `Asking the model whether this news affects ${symbol}.`;
  if (phase === "reading") return `Reading pages for ${symbol}.`;
  return `Scraping Google News, Bing, Yahoo, and the open web for ${symbol}.`;
}

function tone(value: number): string {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function clockRemain(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
