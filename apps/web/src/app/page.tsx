"use client";

import { CandleChart, type ChartLine } from "@/components/CandleChart";
import { StudyBar } from "@/components/StudyBar";
import { StudyTracePanel, type StudyPhase } from "@/components/StudyTracePanel";
import type { DeskName } from "@/components/NamePicker";
import { api } from "@/lib/api";
import { clientOptionPnl, clientOptionPnlShort, shortOptionMargin } from "@/lib/charges";
import type { AgentMark, ChainLeg, OptionsBoard, QuoteTick } from "@/lib/desk";
import { showCompactRupee, showDec, showPct, showRupee, showSignedRupee } from "@/lib/format";
import { applyHorizon, applyLiveQuotes, applyTickCandle, horizonCloseNow, mergeCandles, quotesFromBoard } from "@/lib/live";
import { readSse } from "@/lib/sse";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

function signedErrPct(predicted: number | null | undefined, actual: number | null | undefined): string | null {
  if (predicted == null || actual == null || !(Math.abs(predicted) > 0)) return null;
  const pct = ((actual - predicted) / predicted) * 100;
  return `${pct >= 0 ? "+" : ""}${showDec(pct, 3)}%`;
}

function premiumErrPct(ltp: string | null | undefined, eod: string | null | undefined): number | null {
  if (ltp == null || eod == null) return null;
  const pred = Number(eod);
  const act = Number(ltp);
  if (!(Number.isFinite(pred) && Number.isFinite(act)) || !(Math.abs(act) > 0)) return null;
  return ((act - pred) / act) * 100;
}

type OpenBuy = {
  id: string;
  exchange: string;
  symbol: string;
  quantity: number;
  entry: number;
  mark: number | null;
};

type BuyLine = OpenBuy & { live: number | null; pnl: number | null };

function liveBuyBook(buys: OpenBuy[], board: OptionsBoard | null): { lines: BuyLine[]; total: number; marked: number } {
  const lines = buys.map((buy) => {
    const leg = findLeg(board, buy.symbol);
    const fromChain = leg?.lastPrice != null ? Number(leg.lastPrice) : null;
    const live = fromChain != null && Number.isFinite(fromChain) ? fromChain : buy.mark;
    const pnl = live != null && Number.isFinite(live) && Number.isFinite(buy.entry) ? (live - buy.entry) * buy.quantity : null;
    return { ...buy, live, pnl };
  });
  const marked = lines.filter((line) => line.pnl != null);
  return { lines, total: marked.reduce((sum, line) => sum + (line.pnl ?? 0), 0), marked: marked.length };
}

function OpenPnl({
  book,
  cash,
  notice,
}: {
  book: { lines: BuyLine[]; total: number; marked: number };
  cash: string | null;
  notice: string | null;
}) {
  const live = book.marked > 0;
  const tone = !live ? "" : book.total > 0 ? "up" : book.total < 0 ? "down" : "";
  const low = cash != null && Number(cash) < 500;
  const figure = notice ?? (live ? showSignedRupee(book.total) : "No open buy");
  return (
    <div className="pnl-book" data-coach="votes">
      <section className={`pnl-book-cell ${low ? "down" : ""}`} title="Paper wallet">
        <span>WALLET</span>
        <strong className="mono">
          {cash != null && Number.isFinite(Number(cash)) ? `₹${Number(cash).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
        </strong>
      </section>
      <section className={`pnl-book-cell ${tone}`} title="Live value of open paper buys. Each tick reprices the contract.">
        <span>OPEN P&L</span>
        <strong className={`mono ${live ? "" : "idle"}`}>{figure}</strong>
      </section>
    </div>
  );
}

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
  const [horizonId, setHorizonId] = useState("15m");
  const view = useMemo(() => (board ? applyHorizon(board, horizonId) : null), [board, horizonId]);
  const horizon = board?.horizons?.find((row) => row.id === horizonId) ?? null;

  useEffect(() => {
    const current = board?.horizons?.find((row) => row.id === horizonId);
    if (current && current.id !== "eod" && current.clamped) setHorizonId("eod");
  }, [board?.horizons, horizonId]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [selected, setSelected] = useState<{ symbol: string; kind: "CE" | "PE" | "FUT" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lots, setLots] = useState(1);
  const [flowMode, setFlowMode] = useState<"BUY" | "SELL">("BUY");
  const [studying, setStudying] = useState(false);
  const [stage, setStage] = useState<"chain" | "chart">("chain");
  const [autopilot, setAutopilot] = useState(false);
  const [autopilotLock, setAutopilotLock] = useState<{ exchange: string; symbol: string } | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [tracePhases, setTracePhases] = useState<StudyPhase[]>([]);
  const [tracePrompt, setTracePrompt] = useState<{ system: string; prompt: string } | null>(null);
  const [traceModel, setTraceModel] = useState<string | null>(null);
  const [traceLlm, setTraceLlm] = useState("");
  const [traceStatus, setTraceStatus] = useState<string | null>(null);
  const [openBuys, setOpenBuys] = useState<OpenBuy[]>([]);
  const [paperCash, setPaperCash] = useState<string | null>(null);

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
          void api("/api/options/focus", {
            method: "POST",
            body: JSON.stringify({ exchange: desk.exchange, symbol: desk.symbol }),
          }).catch(() => undefined);
          const next = "expiry" in desk ? desk.expiry : desk.nextExpiry;
          if (next) setExpiry(next);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load names"));
  }, []);

  useEffect(() => {
    void api<{ settings?: { paperAutopilot?: boolean; autopilotExchange?: string | null; autopilotSymbol?: string | null } }>("/api/bootstrap")
      .then((data) => {
        setAutopilot(Boolean(data.settings?.paperAutopilot));
        const locked = data.settings?.autopilotExchange && data.settings?.autopilotSymbol;
        setAutopilotLock(locked ? { exchange: data.settings!.autopilotExchange!, symbol: data.settings!.autopilotSymbol! } : null);
      })
      .catch(() => undefined);
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
    const onMode = () => {
      if (!symbol || !expiry) return;
      void api<OptionsBoard>(
        `/api/options/board?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`,
      )
        .then((data) => setBoard(data))
        .catch(() => undefined);
    };
    window.addEventListener("xtrader-prediction-mode", onMode);
    return () => window.removeEventListener("xtrader-prediction-mode", onMode);
  }, [symbol, exchange, expiry]);

  useEffect(() => {
    if (!board) return;
    const keys = quoteKeys(board);
    let cancelled = false;
    async function tick() {
      try {
        const extra = [...heldKeys.current].filter((key) => !keys.split(",").includes(key));
        const all = extra.length ? `${keys},${extra.join(",")}` : keys;
        const data = await api<{ quotes: QuoteTick[] }>(`/api/options/quotes?keys=${encodeURIComponent(all)}`);
        if (cancelled || !data.quotes.length) return;
        setBoard((prev) => (prev ? applyLiveQuotes(prev, data.quotes) : prev));
        setOpenBuys((prev) =>
          prev.map((buy) => {
            const hit = data.quotes.find((quote) => quote.exchange === buy.exchange && quote.symbol === buy.symbol && quote.lastPrice);
            return hit?.lastPrice ? { ...buy, mark: Number(hit.lastPrice) } : buy;
          }),
        );
        const spot = data.quotes.find((quote) => quote.exchange === exchange && quote.symbol === symbol);
        if (spot?.lastPrice) setCandles((prev) => applyTickCandle(prev, Number(spot.lastPrice), Date.now()));
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
  const heldKeys = useRef<Set<string>>(new Set());
  liveKeys.current = new Set(board ? quoteKeys(board).split(",") : []);
  heldKeys.current = new Set(openBuys.map((buy) => `${buy.exchange}:${buy.symbol}`));

  useEffect(() => {
    let alive = true;
    const load = () => {
      api<{
        cash?: string;
        positions: Array<{ id: string; exchange: string; symbol: string; direction: string; quantity: string; averageEntry: string; currentPrice?: string | null }>;
      }>("/api/paper")
        .then((state) => {
          if (!alive) return;
          if (state.cash != null) setPaperCash(state.cash);
          setOpenBuys(
            state.positions
              .filter((row) => row.direction === "LONG")
              .map((row) => ({
                id: row.id,
                exchange: row.exchange,
                symbol: row.symbol,
                quantity: Number(row.quantity),
                entry: Number(row.averageEntry),
                mark: row.currentPrice != null ? Number(row.currentPrice) : null,
              })),
          );
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

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
      if (heldKeys.current.has(key) && tick.lastPrice) {
        const px = Number(tick.lastPrice);
        setOpenBuys((prev) => prev.map((buy) => (buy.exchange === tick.exchange && buy.symbol === tick.symbol ? { ...buy, mark: px } : buy)));
      }
      if (tick.exchange === exchange && tick.symbol === symbol) {
        const at = tick.receivedAt ? Date.parse(tick.receivedAt) : Date.now();
        setCandles((prev) => applyTickCandle(prev, Number(tick.lastPrice), at));
      }
    };
    source.addEventListener("tick", onTick);
    return () => {
      source.removeEventListener("tick", onTick);
      source.close();
    };
  }, [symbol, exchange, expiry]);

  const focusLeg = useMemo(() => findLeg(view, selected?.symbol ?? null), [view, selected]);

  async function runStudy() {
    if (!symbol || studying || !board?.aiReady) return;
    setStudying(true);
    setTraceOpen(true);
    setTracePhases([]);
    setTracePrompt(null);
    setTraceModel(null);
    setTraceLlm("");
    setTraceStatus("Starting study…");
    try {
      const res = await fetch("/api/options/study/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ exchange, symbol, expiry }),
      });
      await readSse(res, (event, data) => {
        const row = data as Record<string, unknown>;
        if (event === "phase") {
          setTracePhases((prev) => [...prev, { label: String(row.label ?? "Step"), detail: row.detail ? String(row.detail) : undefined }]);
          setTraceStatus(String(row.label ?? "Working…"));
        } else if (event === "prompt") {
          setTracePrompt({ system: String(row.system ?? ""), prompt: String(row.prompt ?? "") });
          const model = row.model ? String(row.model) : null;
          const provider = row.provider ? String(row.provider) : null;
          setTraceModel([provider, model].filter(Boolean).join(" · ") || null);
          setTraceStatus("Prompt sent — waiting for tokens…");
        } else if (event === "llm") {
          setTraceLlm((prev) => prev + String(row.delta ?? ""));
          setTraceStatus("Model streaming…");
        } else if (event === "raw") {
          if (row.text) setTraceLlm(String(row.text));
        } else if (event === "parsed") {
          setTraceStatus(row.ok ? `Parsed · ${String(row.detail ?? "ok")}` : `Parse issue · ${String(row.detail ?? "")}`);
        } else if (event === "done") {
          const result = data as {
            ok: boolean;
            eod?: OptionsBoard["eod"];
            ai?: OptionsBoard["ai"];
            compare?: OptionsBoard["compare"];
            error?: string | null;
          };
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
          setTraceStatus(result.ai ? "Study complete." : (result.error ?? "Finished without AI view."));
        } else if (event === "error") {
          const message = String(row.message ?? "Study failed");
          setTraceStatus(message);
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Study failed";
      setTraceStatus(message);
    } finally {
      setStudying(false);
    }
  }

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const vs = vsView(board?.compare);
  const marks = useMemo(() => chartLines(board, horizon, clock), [board?.lastPrice, board?.eod?.close, horizon?.id, horizon?.targetAt, clock]);
  const book = useMemo(() => liveBuyBook(openBuys, board), [openBuys, board]);

  const actualClose =
    board?.predictionScore?.actual ??
    (board?.marketClosed && board.lastPrice != null ? Number(board.lastPrice) : null);

  const predScore =
    board?.marketClosed && actualClose != null
      ? {
          actual: showDec(actualClose),
          algoErr: signedErrPct(board.eod?.close != null ? Number(board.eod.close) : null, actualClose),
          aiErr: signedErrPct(
            board.ai?.close != null
              ? Number(board.ai.close)
              : board.eodAi?.close != null
                ? Number(board.eodAi.close)
                : null,
            actualClose,
          ),
          kind: board.predictionScore?.kind,
        }
      : null;

  const showChainErr = Boolean(board?.marketClosed);
  const lockedHere = Boolean(
    autopilot && autopilotLock && autopilotLock.symbol.toUpperCase() === symbol.toUpperCase() && autopilotLock.exchange.toUpperCase() === exchange.toUpperCase(),
  );
  const lockedElsewhere = Boolean(autopilot && autopilotLock && !lockedHere);

  return (
    <div className="desk-fit">
      <StudyBar
        names={names}
        symbol={symbol}
        onNameChange={(next) => {
          setSymbol(next.symbol);
          setExchange(next.exchange);
          void api("/api/options/focus", {
            method: "POST",
            body: JSON.stringify({ exchange: next.exchange, symbol: next.symbol }),
          }).catch(() => undefined);
          setExpiries([]);
          setExpiry(next.nextExpiry ?? "");
          setBoard(null);
          setSelected(null);
        }}
        expiries={expiries}
        expiry={expiry}
        onExpiryChange={setExpiry}
        spot={showDec(board?.lastPrice)}
        spotFlash={flashClass(board?.change)}
        algoClose={showDec(horizon?.close ?? board?.eod?.close)}
        vs={vs}
        aiClose={
          board?.ai?.close != null
            ? showDec(board.ai.close)
            : board?.eodAi?.close != null
              ? showDec(board.eodAi.close)
              : null
        }
        aiConfidence={board?.ai?.confidence}
        aiDirection={board?.ai?.direction}
        studying={studying}
        aiReady={Boolean(board?.aiReady)}
        onStudy={() => void runStudy()}
        predScore={predScore}
        predictionMode={board?.predictionMode ?? "ALGO"}
        learning={board?.learning}
      />

      <StudyTracePanel
        open={traceOpen}
        studying={studying}
        phases={tracePhases}
        prompt={tracePrompt}
        modelLabel={traceModel}
        llmText={traceLlm}
        status={traceStatus}
        onClose={() => setTraceOpen(false)}
      />

      <div className="desk-body">
        <div className="desk-main">
          <div className="card chain-wrap">
            <div className="stage-bar">
              <div className="stage-tabs">
                <button type="button" className={`stage-tab ${stage === "chain" ? "on" : ""}`} onClick={() => setStage("chain")}>
                  CHAIN
                </button>
                <button type="button" className={`stage-tab ${stage === "chart" ? "on" : ""}`} data-coach="chart" onClick={() => setStage("chart")}>
                  CHART
                </button>
              </div>
              {board?.horizons?.length ? (
                <div className="stage-tabs horizon-tabs">
                  {board.horizons.map((item) => {
                    const pastClose = item.id !== "eod" && item.clamped;
                    return (
                    <button
                      key={item.id}
                      type="button"
                      className={`stage-tab ${horizonId === item.id ? "on" : ""}`}
                      disabled={pastClose}
                      title={
                        pastClose
                          ? "This horizon would pass 15:30 IST"
                          : item.samples
                          ? `${item.label}: within ${showDec(item.within, 0)} points on ${item.samples} resolves`
                          : item.abstain
                            ? "Wait — short and long paths disagree"
                            : item.label
                      }
                      onClick={() => {
                        if (!pastClose) setHorizonId(item.id);
                      }}
                    >
                      {item.id === "eod" ? "EOD" : item.id}
                    </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="stage-side">
              {stage === "chart" ? (
                <span className="stage-legend">
                  <i className="lg-mkt" /> MKT {showDec(board?.lastPrice)}
                  <i className="lg-algo" /> {horizon?.label ?? "EOD"} {showDec(marks.find((line) => line.title !== "MKT")?.price)}
                </span>
              ) : null}
              <button
                type="button"
                className={`stage-tab ${lockedHere ? "on" : ""}`}
                disabled={lockedElsewhere}
                title={
                  lockedElsewhere
                    ? `Autopilot is on for ${autopilotLock?.symbol}. Turn it off there before using another symbol.`
                    : "Paper buys only, on this symbol. Stays here until you turn it off."
                }
                onClick={() => {
                  if (lockedElsewhere || !symbol || !exchange) return;
                  const enabled = !lockedHere;
                  setAutopilot(enabled);
                  setAutopilotLock(enabled ? { exchange, symbol } : null);
                  void api("/api/settings/autopilot", {
                    method: "POST",
                    body: JSON.stringify({ enabled, exchange, symbol }),
                  }).catch(() => {
                    setAutopilot(!enabled);
                    setAutopilotLock(lockedHere ? { exchange, symbol } : autopilotLock);
                  });
                }}
              >
                {lockedHere ? "AUTOPILOT ON" : lockedElsewhere ? `ON ${autopilotLock?.symbol}` : "AUTOPILOT"}
              </button>
              </div>
            </div>
            {stage === "chart" ? (
              <div className="stage-chart">
                <CandleChart candles={candles} fill lines={marks} />
              </div>
            ) : (
              <div
                className="chain-scroll"
                style={{ ["--chain-rows" as string]: String(Math.max(1, board?.rows.length ?? 15)) }}
              >
                <table className={`chain ${showChainErr ? "with-err" : ""}`} data-coach="chain">
                  <colgroup>
                    <col className="c-ltp" />
                    <col className="c-eod" />
                    {showChainErr ? <col className="c-err" /> : null}
                    <col className="c-net" />
                    <col className="c-mark" />
                    <col className="c-strike" />
                    <col className="c-mark" />
                    <col className="c-net" />
                    {showChainErr ? <col className="c-err" /> : null}
                    <col className="c-eod" />
                    <col className="c-ltp" />
                  </colgroup>
                  <thead>
                    <tr className="chain-groups">
                      <th colSpan={showChainErr ? 5 : 4} className="ce-head">
                        CALLS
                      </th>
                      <th className="strike-head">STRIKE</th>
                      <th colSpan={showChainErr ? 5 : 4} className="pe-head">
                        PUTS
                      </th>
                    </tr>
                    <tr>
                      <th className="num">LTP</th>
                      <th className="num">{horizon?.label ?? "EOD"}</th>
                      {showChainErr ? <th className="num">ERR%</th> : null}
                      <th className="num">NET</th>
                      <th />
                      <th />
                      <th />
                      <th className="num">NET</th>
                      {showChainErr ? <th className="num">ERR%</th> : null}
                      <th className="num">{horizon?.label ?? "EOD"}</th>
                      <th className="num">LTP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(view?.rows ?? []).map((row) => (
                      <tr
                        key={row.strike}
                        className={`${row.atm ? "atm" : ""} ${board?.aiPick?.strike === row.strike ? "ai-pick" : ""} ${
                          selected?.symbol === row.ce?.symbol ? "sel-ce" : ""
                        } ${selected?.symbol === row.pe?.symbol ? "sel-pe" : ""}`}
                      >
                        <LegCells
                          leg={row.ce}
                          side="CE"
                          showErr={showChainErr}
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
                          showErr={showChainErr}
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
        </div>

        {focusLeg ? (
          <PnlBox
            leg={focusLeg}
            kind={selected?.kind ?? "CE"}
            lots={lots}
            onLots={setLots}
            mode={flowMode}
            onMode={setFlowMode}
            board={board}
            book={book}
            cash={paperCash}
            notice={error ?? status}
            onBusy={setStatus}
          />
        ) : (
          <div className="card pnl-card empty-pnl">
            <p className="eyebrow">MONEY FLOW</p>
            <p className="muted">Select a strike.</p>
          </div>
        )}
      </div>

      <p className="desk-why" title={focusLeg?.why ?? undefined}>
        {focusLeg?.why ? focusLeg.why : "\u00a0"}
      </p>
    </div>
  );
}


function LegCells({
  leg,
  side,
  showErr,
  onSelect,
}: {
  leg: ChainLeg | null;
  side: "CE" | "PE";
  showErr?: boolean;
  onSelect: () => void;
}) {
  const tone = (leg?.moneyness ?? "OTM").toLowerCase();
  const base = `${side.toLowerCase()}-cell ${tone}`;
  const net = leg?.pnl ? Number(leg.pnl.net) : null;
  const err = showErr ? premiumErrPct(leg?.lastPrice, leg?.eodPremium) : null;
  const errSigned = err != null ? `${err >= 0 ? "+" : ""}${showDec(err, 3)}%` : null;

  const cell = (extra: string, content: ReactNode, edge?: "start" | "end", title?: string) => (
    <td
      className={`${base} pick ${extra}${edge === "start" ? " leg-start" : ""}${edge === "end" ? " leg-end" : ""}`}
      onClick={onSelect}
      title={title}
    >
      {content}
    </td>
  );

  const ltp = (edge?: "start" | "end") =>
    cell(
      "num leg-ltp",
      <button type="button" className="ltp" disabled={!leg}>
        {leg?.lastPrice != null ? showDec(leg.lastPrice) : "—"}
      </button>,
      edge,
    );
  const eod = (edge?: "start" | "end") => cell("num mono", leg?.eodPremium != null ? showDec(leg.eodPremium) : "—", edge);
  const errCell = (edge?: "start" | "end") =>
    showErr
      ? cell(
          `num mono ${err == null ? "" : err >= 0 ? "up" : "down"}`,
          errSigned ?? "—",
          edge,
          err != null ? "LTP vs predicted EOD premium" : undefined,
        )
      : null;
  const netCell = (edge?: "start" | "end") =>
    cell(`num mono ${flashClass(net)}`, leg?.pnl ? showCompactRupee(leg.pnl.net) : "—", edge);
  const mark = (edge?: "start" | "end") =>
    cell("mark-cell", leg ? <Mark mark={leg.mark} closing={leg.heldSide === "LONG" && leg.mark === "SELL"} /> : null, edge);

  // Mirror: CE LTP→MARK · PE MARK→LTP
  return side === "CE" ? (
    <>
      {ltp("start")}
      {eod()}
      {errCell()}
      {netCell()}
      {mark("end")}
    </>
  ) : (
    <>
      {mark("start")}
      {netCell()}
      {errCell()}
      {eod()}
      {ltp("end")}
    </>
  );
}

function PnlBox({
  leg,
  kind,
  lots,
  onLots,
  mode,
  onMode,
  board,
  book,
  cash,
  notice,
  onBusy,
}: {
  leg: ChainLeg;
  kind: string;
  lots: number;
  onLots: (n: number) => void;
  mode: "BUY" | "SELL";
  onMode: (mode: "BUY" | "SELL") => void;
  board: OptionsBoard | null;
  book: { lines: BuyLine[]; total: number; marked: number };
  cash: string | null;
  notice: string | null;
  onBusy: (msg: string | null) => void;
}) {
  const [paperPos, setPaperPos] = useState<{ id: string; direction: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (paperPos?.direction === "LONG") onMode("BUY");
    else if (paperPos?.direction === "SHORT") onMode("SELL");
  }, [paperPos?.direction, onMode]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api<{ positions: Array<{ id: string; symbol: string; direction: string }> }>("/api/paper")
        .then((state) => {
          if (!alive) return;
          const hit = state.positions.find((p) => p.symbol === leg.symbol);
          setPaperPos(hit ? { id: hit.id, direction: hit.direction } : null);
        })
        .catch(() => {
          if (alive) setPaperPos(null);
        });
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [leg.symbol]);

  const entry = Number(leg.lastPrice ?? leg.pnl?.entry ?? 0);
  const exit = Number(leg.eodPremium ?? leg.pnl?.exit ?? 0);
  const lotSize = Math.max(1, leg.lotSize ?? leg.pnl?.qty ?? 1);
  const qty = lotSize * Math.max(1, lots);
  const ready = Number.isFinite(entry) && Number.isFinite(exit) && entry > 0 && exit > 0;
  const useShort = mode === "SELL";
  const pnl = ready
    ? useShort
      ? clientOptionPnlShort({ entry, exit, qty })
      : clientOptionPnl({ entry, exit, qty })
    : null;
  const net = pnl ? Number(pnl.net) : 0;
  const spot = Number(board?.lastPrice ?? 0);
  const strike = Number(strikeFromSymbol(leg.symbol));
  const indexName = `${board?.symbol ?? ""} ${leg.symbol}`;
  const index = /NIFTY|SENSEX|BANKEX/i.test(indexName);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiryDay = Boolean(board?.expiry && board.expiry.slice(0, 10) === today);
  const blocked =
    useShort && (kind === "CE" || kind === "PE")
      ? shortOptionMargin({
          spot,
          strike,
          kind,
          qty,
          index,
          expiryDay,
        })
      : 0;
  const spend = pnl
    ? useShort
      ? blocked + Number(pnl.charges.sell.total)
      : Number(pnl.buyNotional) + Number(pnl.charges.buy.total)
    : 0;
  const back = pnl
    ? useShort
      ? Number(pnl.buyNotional) + Number(pnl.charges.buy.total)
      : Number(pnl.sellNotional) - Number(pnl.charges.sell.total)
    : 0;
  const margin = spend > 0 ? (net / Math.abs(spend)) * 100 : 0;
  const brokerage = pnl ? Number(pnl.charges.buy.brokerage) + Number(pnl.charges.sell.brokerage) : 0;
  const gst = pnl ? Number(pnl.charges.buy.gst) + Number(pnl.charges.sell.gst) : 0;
  const modeLocked = Boolean(paperPos && paperPos.id !== "pending");
  const closed = Boolean(board?.marketClosed) || leg.mark === "CLOSED";

  async function train() {
    if (!ready || busy || closed) return;
    setBusy(true);
    onBusy(null);
    try {
      if (paperPos && paperPos.id !== "pending") {
        const covering = paperPos.direction === "SHORT";
        await api(`/api/paper/positions/${paperPos.id}/close`, {
          method: "POST",
          body: JSON.stringify({ reason: covering ? "COVER" : "MANUAL" }),
        });
        onBusy(covering ? "Covered short — learned" : "Closed long — learned");
        setPaperPos(null);
        return;
      }
      await api("/api/paper/buy", {
        method: "POST",
        body: JSON.stringify({
          exchange: leg.exchange,
          symbol: leg.symbol,
          quantity: qty,
          lane: "FNO",
          kind,
          side: mode,
          prediction: {
            eodSpot: board?.eod?.close ?? null,
            eodPremium: leg.eodPremium ?? null,
            entrySpot: board?.lastPrice ?? null,
            compareTag: board?.compare?.tag ?? null,
            aiConfidence: board?.ai?.confidence ?? null,
            why: leg.why ?? null,
            expiryDay: Boolean(board?.expiry && board.expiry.slice(0, 10) === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })),
          },
        }),
      });
      onBusy(mode === "SELL" ? "Paper SELL (write) recorded for training" : "Paper BUY recorded for training");
      setPaperPos({ id: "pending", direction: mode === "SELL" ? "SHORT" : "LONG" });
    } catch (e) {
      onBusy(e instanceof Error ? e.message : "Train failed");
    } finally {
      setBusy(false);
    }
  }

  const trainRef = useRef(train);
  trainRef.current = train;
  const modeLockedRef = useRef(modeLocked);
  modeLockedRef.current = modeLocked;
  const closedRef = useRef(closed);
  closedRef.current = closed;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === "Shift" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (modeLockedRef.current || !readyRef.current) return;
        e.preventDefault();
        onMode(modeRef.current === "BUY" ? "SELL" : "BUY");
        return;
      }
      if (e.key === "Enter" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!readyRef.current || busyRef.current || closedRef.current) return;
        e.preventDefault();
        void trainRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!ready || !pnl) {
    return (
      <div className="card pnl-card empty-pnl">
        <p className="eyebrow">MONEY FLOW</p>
        <p className="muted">Waiting for a live premium on this strike.</p>
      </div>
    );
  }

  const actionLabel =
    paperPos && paperPos.id !== "pending"
      ? paperPos.direction === "SHORT"
        ? "COVER"
        : "CLOSE"
      : mode === "SELL"
        ? "TRAIN SELL"
        : "TRAIN BUY";

  return (
    <aside className={`card pnl-card mode-${mode.toLowerCase()}`} data-coach="pnl" title="Shift = BUY/SELL · Enter = train">
      <div className="pnl-top">
        <div className="pnl-head">
          <p className="eyebrow">MONEY FLOW</p>
          <div className="pnl-title">
            <span className={`kind-tag ${kind.toLowerCase()}`}>{kind}</span>
            <strong className="mono">{strikeFromSymbol(leg.symbol)}</strong>
            <span className={`mny ${(leg.moneyness ?? "").toLowerCase()}`}>{leg.moneyness ?? "\u00a0"}</span>
          </div>
        </div>
        <div className="pnl-side">
          <div className="pnl-mode" role="group" aria-label="Buy or sell mode · Shift to toggle">
            <button
              type="button"
              className={mode === "BUY" ? "on" : ""}
              disabled={modeLocked && mode !== "BUY"}
              onClick={() => onMode("BUY")}
            >
              BUY
            </button>
            <button
              type="button"
              className={mode === "SELL" ? "on" : ""}
              disabled={modeLocked && mode !== "SELL"}
              onClick={() => onMode("SELL")}
            >
              SELL
            </button>
          </div>
          <div className="lot-step" title={`${lots} × ${lotSize} qty`}>
            <span className="muted">Lots</span>
            <div>
              <button type="button" onClick={() => onLots(Math.max(1, lots - 1))} disabled={lots <= 1}>
                −
              </button>
              <b className="mono">{lots}</b>
              <button type="button" onClick={() => onLots(lots + 1)}>
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pnl-ledger">
        <div className="pnl-row">
          <span>{useShort ? "MARGIN" : "SPEND"}</span>
          <b className="mono num-slot" title={useShort ? "SPAN + exposure blocked to sell, plus this order’s charges" : "Premium plus buy charges"}>
            {showRupee(spend)}
          </b>
        </div>
        <div className="pnl-row">
          <span>{useShort ? "BUYBACK" : "BACK"}</span>
          <b className="mono num-slot">{showRupee(back)}</b>
        </div>
        <div className="pnl-pair">
          <div className={`pnl-row ${flashClass(Number(pnl.gross))}`} title="before commission & taxes">
            <span>GROSS</span>
            <b className="mono num-slot">{showSignedRupee(pnl.gross)}</b>
          </div>
          <div
            className={`pnl-row ${flashClass(net)}`}
            title={`after fees ${showRupee(pnl.charges.total)} · ${showPct(margin)}`}
          >
            <span>NET</span>
            <b className="mono num-slot">{showSignedRupee(net)}</b>
          </div>
        </div>
      </div>
      <div className="pnl-path">
        <div>
          <span>NOW</span>
          <b className="mono num-slot">{showDec(pnl.entry)}</b>
        </div>
        <i />
        <div>
          <span>EOD</span>
          <b className="mono num-slot">{showDec(pnl.exit)}</b>
        </div>
      </div>
      <div className="pnl-charges">
        <span>
          Fees <b className="mono down num-slot">{showRupee(pnl.charges.total)}</b>
        </span>
        <span>
          Brk <b className="mono num-slot">{showRupee(brokerage)}</b>
        </span>
        <span>
          STT <b className="mono num-slot">{showRupee(pnl.charges.sell.stt)}</b>
        </span>
        <span>
          GST <b className="mono num-slot">{showRupee(gst)}</b>
        </span>
      </div>
      <div className="pnl-train">
        <button
          type="button"
          className={`btn ${mode === "SELL" ? "danger" : "primary"}`}
          disabled={busy || closed}
          title={useShort ? "Open short / write premium · Enter" : "Enter to train"}
          onClick={() => void train()}
        >
          {actionLabel}
        </button>
      </div>
      <div className="pnl-rule" />
      <OpenPnl book={book} cash={cash} notice={notice} />
    </aside>
  );
}

function chartLines(
  board: OptionsBoard | null,
  horizon: NonNullable<OptionsBoard["horizons"]>[number] | null,
  now: number,
): ChartLine[] {
  if (!board) return [];
  const last = Number(board.lastPrice);
  const lines: ChartLine[] = [];
  if (Number.isFinite(last) && last > 0) lines.push({ price: last, title: "MKT", color: "#e7edf5" });
  const eodClose = Number(board.eod?.close);
  const anchor = Number(horizon?.anchor);
  const predicted = horizon && Number.isFinite(anchor)
    ? Number(horizon.close) + (last - anchor)
    : horizon?.targetAt && Number.isFinite(eodClose)
      ? horizonCloseNow({ last, eodClose, targetAt: horizon.targetAt, now })
      : eodClose;
  if (Number.isFinite(predicted) && predicted > 0) {
    lines.push({ price: predicted, title: horizon?.label ?? "EOD", color: "#4c8dff" });
  }
  return lines;
}

function vsView(compare?: OptionsBoard["compare"]): {
  tag: string;
  hint: string;
  tone: "yes" | "wide" | "no" | "idle";
} {
  if (!compare) return { tag: "IDLE", hint: "run study", tone: "idle" };
  const tag = compare.tag ?? (compare.agree ? "ALIGNED" : "OPPOSED");
  const hint = compare.hint ?? (compare.agree ? "same direction" : "different direction");
  const tone: "yes" | "wide" | "no" | "idle" =
    tag === "ALIGNED" || tag === "LEAN" || tag === "MATCH" || tag === "NEAR"
      ? "yes"
      : tag === "STRETCH" || tag === "WIDE"
        ? "wide"
        : "no";
  return { tag, hint, tone };
}

function strikeFromSymbol(symbol: string) {
  const m = symbol.match(/(\d{4,5})(CE|PE)$/);
  return m ? m[1] : symbol.slice(-10);
}

function Mark({ mark, closing }: { mark: AgentMark; closing?: boolean }) {
  const label = closing ? "CLOSE" : mark === "NO_BUY" ? "NA" : mark;
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