"use client";

import { CandleChart, type ChartLine } from "@/components/CandleChart";
import { NamePicker, type DeskName } from "@/components/NamePicker";
import { api } from "@/lib/api";
import { clientOptionPnl } from "@/lib/charges";
import type { AgentMark, AlgoSignal, ChainLeg, OptionsBoard, Play, QuoteTick } from "@/lib/desk";
import { applyLiveQuotes, applyTickCandle, mergeCandles, quotesFromBoard } from "@/lib/live";
import { useEffect, useMemo, useRef, useState } from "react";

type Name = DeskName;
type Expiry = { date: string; label: string };
type Candle = { time: number; open: number; high: number; low: number; close: number };

export default function OptionsPage() {
  const [names, setNames] = useState<Name[]>([]);
  const [expiries, setExpiries] = useState<Expiry[]>([]);
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [expiry, setExpiry] = useState("");
  const [board, setBoard] = useState<OptionsBoard | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [selected, setSelected] = useState<{ symbol: string; kind: "CE" | "PE" | "FUT" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [lots, setLots] = useState(1);
  const [studying, setStudying] = useState(false);
  const [stage, setStage] = useState<"chain" | "chart">("chain");
  const [signals, setSignals] = useState<AlgoSignal[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);

  useEffect(() => {
    void api<{ names: Name[]; desk?: { exchange: string; symbol: string; expiry: string | null } | null }>(
      "/api/options/names",
    )
      .then((data) => {
        setNames(data.names);
        const desk = data.desk ?? data.names.find((n) => n.kind === "INDEX") ?? data.names[0];
        if (desk) {
          setSymbol(desk.symbol);
          setExchange(desk.exchange);
          const next = "expiry" in desk ? desk.expiry : desk.nextExpiry;
          if (next) setExpiry(next);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load names"));
  }, []);

  useEffect(() => {
    if (!symbol) return;
    void api<{ expiries: Expiry[] }>(`/api/options/expiries?symbol=${encodeURIComponent(symbol)}`)
      .then((data) => {
        setExpiries(data.expiries);
        setExpiry((cur) => (cur && data.expiries.some((item) => item.date === cur) ? cur : (data.expiries[0]?.date ?? "")));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load expiries"));
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !expiry) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await api<OptionsBoard>(
          `/api/options/board?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`,
        );
        if (cancelled) return;
        setBoard((prev) => {
          if (!prev || prev.symbol !== data.symbol || prev.expiry !== data.expiry) return data;
          return applyLiveQuotes(
            { ...data, ai: data.ai ?? prev.ai, aiError: data.aiError ?? prev.aiError },
            quotesFromBoard(prev),
          );
        });
        if (data.plays) setPlays(data.plays);
        setError(null);
        setSelected((cur) => cur ?? pickDefault(data));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load option chain");
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, exchange, expiry]);

  useEffect(() => {
    if (!board) return;
    const keys = quoteKeys(board);
    let cancelled = false;
    async function tick() {
      try {
        const data = await api<{ quotes: QuoteTick[] }>(`/api/options/quotes?keys=${encodeURIComponent(keys)}`);
        if (cancelled || !data.quotes.length) return;
        setBoard((prev) => (prev ? applyLiveQuotes(prev, data.quotes) : prev));
      } catch {
        /* keep last board */
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [board?.symbol, board?.expiry]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    async function load() {
      try {
        const rows = await api<Candle[]>(
          `/api/market/candles?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&interval=5`,
        );
        if (cancelled) return;
        setCandles((prev) => mergeCandles(prev, rows));
      } catch {
        /* keep last candles */
      }
    }
    setCandles([]);
    void load();
    const id = window.setInterval(() => void load(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, exchange]);

  const liveKeys = useRef<Set<string>>(new Set());
  liveKeys.current = new Set(board ? quoteKeys(board).split(",") : []);

  useEffect(() => {
    if (!symbol || !expiry) return;
    let cancelled = false;
    void api<{ signals: AlgoSignal[]; plays?: Play[] }>(
      `/api/options/signals?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`,
    )
      .then((data) => {
        if (!cancelled) {
          setSignals(data.signals ?? []);
          setPlays(data.plays ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, expiry]);

  useEffect(() => {
    if (!symbol) return;
    const source = new EventSource("/api/market/stream");
    const onTick = (ev: MessageEvent) => {
      let tick: QuoteTick & { receivedAt?: string };
      try {
        tick = JSON.parse(String(ev.data)) as QuoteTick & { receivedAt?: string };
      } catch {
        return;
      }
      if (!tick?.exchange || !tick.symbol || !tick.lastPrice) return;
      const key = `${tick.exchange}:${tick.symbol}`;
      if (liveKeys.current.has(key)) {
        setBoard((prev) => (prev ? applyLiveQuotes(prev, [tick]) : prev));
      }
      if (tick.exchange === exchange && tick.symbol === symbol) {
        const at = tick.receivedAt ? Date.parse(tick.receivedAt) : Date.now();
        setCandles((prev) => applyTickCandle(prev, Number(tick.lastPrice), at));
      }
    };
    const onSignal = (ev: MessageEvent) => {
      let row: AlgoSignal;
      try {
        row = JSON.parse(String(ev.data)) as AlgoSignal;
      } catch {
        return;
      }
      if (!row?.contract || row.underlying !== symbol) return;
      if (expiry && row.expiry && row.expiry !== expiry) return;
      setSignals((prev) => [row, ...prev.filter((item) => item.id !== row.id)].slice(0, 30));
    };
    const onPlay = (ev: MessageEvent) => {
      let row: Play;
      try {
        row = JSON.parse(String(ev.data)) as Play;
      } catch {
        return;
      }
      if (!row?.id || row.underlying !== symbol) return;
      setPlays((prev) => [row, ...prev.filter((item) => item.id !== row.id)].slice(0, 20));
    };
    source.addEventListener("tick", onTick);
    source.addEventListener("signal", onSignal);
    source.addEventListener("play", onPlay);
    return () => {
      source.removeEventListener("tick", onTick);
      source.removeEventListener("signal", onSignal);
      source.removeEventListener("play", onPlay);
      source.close();
    };
  }, [symbol, exchange, expiry]);

  async function tryPaper(idea: { symbol: string; exchange?: string; mark: AgentMark; canPaper: boolean }) {
    if (!board?.paperMode || !idea.canPaper) return;
    setBusy(true);
    setNote(null);
    try {
      await api("/api/paper/try", {
        method: "POST",
        body: JSON.stringify({
          exchange: idea.exchange ?? "NFO",
          symbol: idea.symbol,
          side: idea.mark === "SELL" ? "SELL" : "BUY",
          instrumentType: idea.symbol.endsWith("FUT") ? "FUTURE" : "OPTION",
        }),
      });
      setNote("Paper fill saved. Check My trades.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Paper order failed");
    } finally {
      setBusy(false);
    }
  }

  async function dismissPlay(id: string) {
    try {
      const data = await api<{ play: Play }>(`/api/plays/${id}/dismiss`, { method: "POST", body: "{}" });
      setPlays((prev) => prev.map((row) => (row.id === id ? data.play : row)));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not dismiss");
    }
  }

  const focusLeg = useMemo(() => findLeg(board, selected?.symbol ?? null), [board, selected]);

  async function runStudy() {
    if (!symbol || studying) return;
    setStudying(true);
    setNote(null);
    try {
      const result = await api<{
        ok: boolean;
        eod?: OptionsBoard["eod"];
        ai?: OptionsBoard["ai"];
        compare?: OptionsBoard["compare"];
        error?: string | null;
      }>("/api/options/study", {
        method: "POST",
        body: JSON.stringify({ exchange, symbol, expiry }),
      });
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              eod: result.eod ?? prev.eod,
              ai: result.ai ?? prev.ai ?? null,
              compare: result.compare ?? prev.compare ?? null,
              aiError: result.error ?? null,
            }
          : prev,
      );
      setNote(result.ai ? "AI study updated." : (result.error ?? "Study finished without an AI view."));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Study failed");
    } finally {
      setStudying(false);
    }
  }

  const vs = vsView(board?.compare);
  const studyNote = error ?? board?.aiError ?? board?.ai?.why ?? note ?? null;
  const markKey = [
    board?.levels?.supports.join(),
    board?.levels?.resistances.join(),
    board?.levels?.magnet,
    board?.eod?.close,
    board?.eod?.low,
    board?.eod?.high,
    board?.ai?.close,
    board?.ai?.low,
    board?.ai?.high,
    board?.desk?.vwap,
    board?.desk?.orbHigh,
    board?.desk?.orbLow,
    board?.session?.invalidation,
  ].join("|");
  const marks = useMemo(() => chartLines(board), [markKey]);

  return (
    <div className="desk-fit">
      <div className="hud card">
        <label data-coach="und">
          <span>UND</span>
          <NamePicker
            names={names}
            value={symbol}
            onChange={(next) => {
              setSymbol(next.symbol);
              setExchange(next.exchange);
              setExpiries([]);
              setExpiry(next.nextExpiry ?? "");
              setBoard(null);
              setSelected(null);
            }}
          />
        </label>
        <label data-coach="exp">
          <span>EXP</span>
          <select className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {expiries.map((item) => (
              <option key={item.date} value={item.date}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="hud-metric" data-coach="spot">
          <span>SPOT</span>
          <strong className={`mono ${flashClass(board?.change)}`}>{board?.lastPrice ?? "—"}</strong>
          <em>
            {board
              ? [
                  board.desk?.clock ?? null,
                  board.desk?.pcr != null ? `PCR ${board.desk.pcr}` : null,
                  board.desk?.maxPain != null ? `PAIN ${board.desk.maxPain}` : null,
                  board.desk?.ivRank != null ? `IVR ${(board.desk.ivRank * 100).toFixed(0)}` : null,
                  board.desk?.adx != null ? `ADX ${board.desk.adx.toFixed(0)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || `${board.trust}% ${board.bias}`
              : "…"}
          </em>
        </div>
        <div className="hud-metric algo">
          <span>ALGO EOD</span>
          <strong className="mono">{board?.eod?.close ?? "—"}</strong>
          <em>{board?.eod ? `${board.eod.low}–${board.eod.high}` : "band"}</em>
        </div>
        <div className={`hud-metric hud-vs ${vs.tone}`}>
          <span>VS</span>
          <strong>{vs.tag}</strong>
          <em>{vs.hint}</em>
        </div>
        <div className={`hud-metric ai ${board?.ai?.direction.toLowerCase() ?? ""}`}>
          <span>AI EOD</span>
          <strong className="mono">{board?.ai?.close ?? (studying ? "…" : "—")}</strong>
          <em>{board?.ai ? `${board.ai.confidence}% ${board.ai.direction}` : studying ? "STUDY" : "IDLE"}</em>
        </div>
        <button type="button" className="btn primary hud-study" data-coach="study" disabled={studying} onClick={() => void runStudy()}>
          {studying ? "SCAN…" : "STUDY"}
        </button>
      </div>

      <div className="hud-sub card">
        {board?.desk?.votes?.length ? (
          <div className="vote-strip" data-coach="votes">
            {board.desk.votes.map((vote) => (
              <span key={vote.name} className={vote.vote > 0 ? "up" : vote.vote < 0 ? "down" : ""} title={vote.detail}>
                {vote.name.replace("DAILY ", "D ").replace("INTRADAY ", "I ")}
                {vote.vote > 0 ? "+" : vote.vote < 0 ? "−" : "·"}
              </span>
            ))}
            {board.desk.vwap ? <span>VWAP {board.desk.vwap}</span> : null}
            {board.desk.orbHigh ? <span>ORB {board.desk.orbLow}–{board.desk.orbHigh}</span> : null}
          </div>
        ) : null}
        <div className="hud-main">
        <div className="chip-row" data-coach="buy-meaning">
          {(board?.buys ?? []).map((idea) => (
            <button
              key={idea.contract}
              className={`idea-pill ${idea.kind.toLowerCase()} ${selected?.symbol === idea.contract ? "on" : ""}`}
              onClick={() => setSelected({ symbol: idea.contract, kind: asChainKind(idea.kind) })}
            >
              <span className={`kind-tag ${idea.kind.toLowerCase()}`}>{idea.label}</span>
              <b>{idea.title.replace(/^Buy (CE|PE) /, "")}</b>
              {idea.premium ? <span className="mono">₹{idea.premium}</span> : null}
            </button>
          ))}
          {(board?.sells ?? []).map((idea) => (
            <button key={idea.contract} className="idea-pill sell" onClick={() => setSelected({ symbol: idea.contract, kind: asChainKind(idea.kind) })}>
              <span className="kind-tag pe">SELL</span>
              <b>{idea.contract}</b>
            </button>
          ))}
          {board && board.buys.length === 0 ? <span className="muted">No cheap-side buy</span> : null}
        </div>
        {studyNote ? <p className={`hud-note ${error || board?.aiError ? "down" : ""}`}>{studyNote}</p> : null}
        </div>
        {plays.length || signals.length ? (
          <ul className="signal-tape" data-coach="tape">
            {plays.slice(0, 4).map((row, i) => (
              <li key={row.id} className={row.status === "FILLED" ? "up" : row.status === "MISSED" || row.status === "EXPIRED" ? "down" : ""}>
                <time>{tapeTime(row.at)}</time>
                <b>{row.status}</b>
                <span>
                  {row.side} {row.contract.replace(row.underlying, "").slice(-8)}
                </span>
                {row.edgeAfterCost ? <em className="mono">net ₹{Number(row.edgeAfterCost).toFixed(0)}</em> : null}
                {row.expectancyNote ? <em>{row.expectancyNote}</em> : null}
                {row.status === "OPEN" ? (
                  <button
                    type="button"
                    className="tape-dismiss"
                    data-coach={i === 0 ? "dismiss" : undefined}
                    onClick={() => void dismissPlay(row.id)}
                  >
                    Dismiss
                  </button>
                ) : null}
              </li>
            ))}
            {plays.length === 0
              ? signals.slice(0, 4).map((row) => (
                  <li key={row.id} className={row.toMark === "BUY" ? "up" : row.toMark === "SELL" ? "down" : ""}>
                    <time>{tapeTime(row.at)}</time>
                    <b>{row.toMark}</b>
                    <span>
                      {row.strike} {row.kind}
                    </span>
                    {row.net != null ? <em className="mono">net ₹{Number(row.net).toFixed(0)}</em> : null}
                  </li>
                ))
              : null}
          </ul>
        ) : null}
      </div>

      <div className="desk-body">
        <div className="card chain-wrap">
          <div className="stage-bar">
            <button type="button" className={`pill ${stage === "chain" ? "on" : ""}`} onClick={() => setStage("chain")}>
              CHAIN
            </button>
            <button type="button" className={`pill ${stage === "chart" ? "on" : ""}`} data-coach="chart" onClick={() => setStage("chart")}>
              CHART
            </button>
            {stage === "chart" ? (
              <span className="stage-legend">
                <i className="lg-s" /> S
                <i className="lg-r" /> R
                <i className="lg-algo" /> ALGO
                <i className="lg-ai" /> AI
                <i className="lg-vwap" /> VWAP
              </span>
            ) : null}
          </div>
          {stage === "chart" ? (
            <div className="stage-chart">
              <CandleChart candles={candles} fill lines={marks} />
            </div>
          ) : (
          <div className="chain-scroll">
          <table className="chain" data-coach="chain">
            <colgroup>
              <col className="c-ltp" />
              <col className="c-eod" />
              <col className="c-net" />
              <col className="c-mark" />
              <col className="c-strike" />
              <col className="c-mark" />
              <col className="c-net" />
              <col className="c-eod" />
              <col className="c-ltp" />
            </colgroup>
            <thead>
              <tr className="chain-groups">
                <th colSpan={4} className="ce-head">
                  CALLS
                </th>
                <th className="strike-head">STRIKE</th>
                <th colSpan={4} className="pe-head">
                  PUTS
                </th>
              </tr>
              <tr>
                <th className="num">LTP</th>
                <th className="num">EOD</th>
                <th className="num">NET</th>
                <th />
                <th />
                <th />
                <th className="num">NET</th>
                <th className="num">EOD</th>
                <th className="num">LTP</th>
              </tr>
            </thead>
            <tbody>
              {(board?.rows ?? []).map((row) => (
                <tr
                  key={row.strike}
                  className={`${row.atm ? "atm" : ""} ${board?.aiPick?.strike === row.strike ? "ai-pick" : ""} ${
                    selected?.symbol === row.ce?.symbol ? "sel-ce" : ""
                  } ${selected?.symbol === row.pe?.symbol ? "sel-pe" : ""}`}
                >
                  <LegCells
                    leg={row.ce}
                    side="CE"
                    onSelect={() => row.ce && setSelected({ symbol: row.ce.symbol, kind: "CE" })}
                  />
                  <td className="strike">
                    <span>{row.strike}</span>
                    {row.atm ? <i>ATM</i> : null}
                    {board?.aiPick?.strike === row.strike ? <i className="ai-tag">AI {board.aiPick.kind}</i> : null}
                  </td>
                  <LegCells
                    leg={row.pe}
                    side="PE"
                    onSelect={() => row.pe && setSelected({ symbol: row.pe.symbol, kind: "PE" })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {!board ? <p className="muted pad">Loading chain…</p> : null}
          </div>
          )}
        </div>

        {focusLeg ? (
          <PnlBox
            leg={focusLeg}
            kind={selected?.kind ?? "CE"}
            lots={lots}
            onLots={setLots}
            paperMode={Boolean(board?.paperMode)}
            busy={busy}
            onPaper={() => void tryPaper(focusLeg)}
          />
        ) : (
          <div className="card pnl-card empty-pnl">
            <p className="eyebrow">P&L</p>
            <p className="muted">Select a strike.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LegCells({
  leg,
  side,
  onSelect,
}: {
  leg: ChainLeg | null;
  side: "CE" | "PE";
  onSelect: () => void;
}) {
  const tone = (leg?.moneyness ?? "OTM").toLowerCase();
  const cls = `${side.toLowerCase()}-cell ${tone}`;
  const net = leg?.pnl ? Number(leg.pnl.net) : null;
  const ltp = (
    <td className={`${cls} pick num`} onClick={onSelect}>
      <button type="button" className="ltp" disabled={!leg}>
        {leg?.lastPrice ?? "—"}
      </button>
    </td>
  );
  const eod = (
    <td className={`${cls} pick num mono`} onClick={onSelect}>
      {leg?.eodPremium ?? "—"}
    </td>
  );
  const netCell = (
    <td className={`${cls} pick num mono ${flashClass(net)}`} onClick={onSelect}>
      {leg?.pnl ? compactRupee(leg.pnl.net) : "—"}
    </td>
  );
  const mark = (
    <td className={`${cls} pick mark-cell`} onClick={onSelect}>
      {leg ? <Mark mark={leg.mark} /> : null}
    </td>
  );
  return side === "CE" ? (
    <>
      {ltp}
      {eod}
      {netCell}
      {mark}
    </>
  ) : (
    <>
      {mark}
      {netCell}
      {eod}
      {ltp}
    </>
  );
}

function PnlBox({
  leg,
  kind,
  lots,
  onLots,
  paperMode,
  busy,
  onPaper,
}: {
  leg: ChainLeg;
  kind: string;
  lots: number;
  onLots: (n: number) => void;
  paperMode: boolean;
  busy: boolean;
  onPaper: () => void;
}) {
  const entry = Number(leg.lastPrice ?? leg.pnl?.entry ?? 0);
  const exit = Number(leg.eodPremium ?? leg.pnl?.exit ?? 0);
  const lotSize = Math.max(1, leg.lotSize ?? leg.pnl?.qty ?? 1);
  const qty = lotSize * Math.max(1, lots);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || exit <= 0) {
    return (
      <div className="card pnl-card empty-pnl">
        <p className="eyebrow">P&L</p>
        <p className="muted">Waiting for a live premium on this strike.</p>
      </div>
    );
  }
  const pnl = clientOptionPnl({ entry, exit, qty });
  const net = Number(pnl.net);
  const spend = Number(pnl.buyNotional) + Number(pnl.charges.buy.total);
  const back = Number(pnl.sellNotional) - Number(pnl.charges.sell.total);
  const margin = spend > 0 ? (net / spend) * 100 : 0;
  const brokerage = Number(pnl.charges.buy.brokerage) + Number(pnl.charges.sell.brokerage);
  const gst = Number(pnl.charges.buy.gst) + Number(pnl.charges.sell.gst);
  return (
    <aside className={`card pnl-card ${kind.toLowerCase()}`} data-coach="pnl">
      <div className="pnl-top">
        <div>
          <p className="eyebrow">MONEY FLOW</p>
          <div className="pnl-title">
            <span className={`kind-tag ${kind.toLowerCase()}`}>{kind}</span>
            <strong>{strikeFromSymbol(leg.symbol)}</strong>
            <span className={`mny ${ (leg.moneyness ?? "").toLowerCase()}`}>{leg.moneyness ?? ""}</span>
          </div>
          <p className="pnl-sym mono">{leg.symbol}</p>
          {leg.why ? <p className="pnl-why">{leg.why}</p> : null}
        </div>
        <div className="lot-step">
          <span className="muted">Lots</span>
          <div>
            <button type="button" onClick={() => onLots(Math.max(1, lots - 1))} disabled={lots <= 1}>
              −
            </button>
            <b>{lots}</b>
            <button type="button" onClick={() => onLots(lots + 1)}>
              +
            </button>
          </div>
          <em>
            {lots === 1 ? "1 lot" : `${lots} lots`} × {lotSize}
          </em>
        </div>
      </div>

      <div className="pnl-ledger">
        <div className="pnl-row">
          <span>SPEND</span>
          <b className="mono">{rupee(spend)}</b>
          <em>
            {rupee(pnl.buyNotional)} premium + {rupee(pnl.charges.buy.total)} buy fees
          </em>
        </div>
        <div className="pnl-row">
          <span>BACK</span>
          <b className="mono">{rupee(back)}</b>
          <em>
            {rupee(pnl.sellNotional)} exit − {rupee(pnl.charges.sell.total)} sell fees
          </em>
        </div>
        <div className="pnl-pair">
          <div className={`pnl-row ${flashClass(Number(pnl.gross))}`}>
            <span>GROSS</span>
            <b className="mono">{signedRupee(pnl.gross)}</b>
            <em>before commission & taxes</em>
          </div>
          <div className={`pnl-row ${flashClass(net)}`}>
            <span>NET</span>
            <b className="mono">{signedRupee(net)}</b>
            <em>
              after fees {rupee(pnl.charges.total)} · {signedPct(margin)}
            </em>
          </div>
        </div>
      </div>
      <div className="pnl-path">
        <div>
          <span>NOW</span>
          <b className="mono">{pnl.entry}</b>
        </div>
        <i />
        <div>
          <span>EOD</span>
          <b className="mono">{pnl.exit}</b>
        </div>
      </div>
      <div className="pnl-charges">
        <span>
          Fees <b className="mono down">{rupee(pnl.charges.total)}</b>
        </span>
        <span>
          Brk <b className="mono">{rupee(brokerage.toFixed(2))}</b>
        </span>
        <span>
          STT <b className="mono">{rupee(pnl.charges.sell.stt)}</b>
        </span>
        <span>
          GST <b className="mono">{rupee(gst.toFixed(2))}</b>
        </span>
      </div>
      {paperMode && leg.canPaper ? (
        <button type="button" className="btn primary pnl-paper" disabled={busy} onClick={onPaper}>
          {leg.mark === "SELL" ? "PAPER SELL" : "PAPER BUY"}
        </button>
      ) : null}
    </aside>
  );
}

function chartLines(board: OptionsBoard | null): ChartLine[] {
  if (!board) return [];
  const out: ChartLine[] = [];
  const add = (raw: string | number | null | undefined, title: string, color: string, dashed = false) => {
    const price = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(price) || price <= 0) return;
    out.push({ price, title, color, dashed });
  };
  board.levels?.supports.forEach((value, i) => add(value, `S${i + 1}`, "#3dd68c"));
  board.levels?.resistances.forEach((value, i) => add(value, `R${i + 1}`, "#ff5c7a"));
  add(board.levels?.magnet, "MAG", "#8b96a8");
  add(board.desk?.vwap, "VWAP", "#f0b429");
  add(board.desk?.orbHigh, "ORB H", "#8b7cff", true);
  add(board.desk?.orbLow, "ORB L", "#8b7cff", true);
  const inv = board.session?.invalidation?.match(/[\d.]+/)?.[0];
  add(inv, "INV", "#f07178", true);
  add(board.eod?.low, "ALGO L", "#4c8dff", true);
  add(board.eod?.high, "ALGO H", "#4c8dff", true);
  add(board.eod?.close, "ALGO", "#4c8dff");
  add(board.ai?.low, "AI L", "#2ec8b8", true);
  add(board.ai?.high, "AI H", "#2ec8b8", true);
  add(board.ai?.close, "AI", "#2ec8b8");
  return out;
}

function vsView(compare?: OptionsBoard["compare"]) {
  if (!compare) return { tag: "IDLE", hint: "study first", tone: "idle" };
  const tag = compare.tag ?? (compare.agree ? "MATCH" : "CLASH");
  const hint = compare.hint ?? (compare.agree ? "same call" : "opposite call");
  const tone = tag === "MATCH" || tag === "NEAR" ? "yes" : tag === "WIDE" ? "wide" : "no";
  return { tag, hint, tone };
}

function rupee(value: string | number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `₹${n.toFixed(2)}`;
}

function signedRupee(value: string | number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toFixed(2)}`;
}

function signedPct(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function tapeTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function compactRupee(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function strikeFromSymbol(symbol: string) {
  const m = symbol.match(/(\d{4,5})(CE|PE)$/);
  return m ? m[1] : symbol.slice(-10);
}

function Mark({ mark }: { mark: AgentMark }) {
  const label = mark === "NO_BUY" ? "NO BUY" : mark;
  return <span className={`mark ${mark.toLowerCase()}`}>{label}</span>;
}

function flashClass(change?: number | null) {
  if (change == null || change === 0) return "";
  return change > 0 ? "up" : "down";
}

function pickDefault(board: OptionsBoard): { symbol: string; kind: "CE" | "PE" | "FUT" } | null {
  const buy = board.buys[0];
  if (buy) return { symbol: buy.contract, kind: asChainKind(buy.kind) };
  const atm = board.rows.find((row) => row.atm);
  if (atm?.pe) return { symbol: atm.pe.symbol, kind: "PE" };
  if (atm?.ce) return { symbol: atm.ce.symbol, kind: "CE" };
  return null;
}

function fnoKey(exchange: string | undefined, symbol: string) {
  return `${exchange ?? "NFO"}:${symbol}`;
}

function quoteKeys(board: OptionsBoard): string {
  const keys = [`${board.exchange}:${board.symbol}`];
  if (board.future) keys.push(fnoKey(board.future.exchange, board.future.symbol));
  for (const row of board.rows) {
    if (row.ce) keys.push(fnoKey(row.ce.exchange, row.ce.symbol));
    if (row.pe) keys.push(fnoKey(row.pe.exchange, row.pe.symbol));
  }
  return keys.join(",");
}

function asChainKind(kind: "CE" | "PE" | "FUT" | "EQ"): "CE" | "PE" | "FUT" {
  return kind === "EQ" ? "CE" : kind;
}

function findLeg(board: OptionsBoard | null, symbol: string | null): ChainLeg | null {
  if (!board || !symbol) return null;
  for (const row of board.rows) {
    if (row.ce?.symbol === symbol) return row.ce;
    if (row.pe?.symbol === symbol) return row.pe;
  }
  return null;
}