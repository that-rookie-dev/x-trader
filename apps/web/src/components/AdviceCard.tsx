"use client";

import { CopyQuiet } from "@/components/CopyQuiet";
import type { PlainIdea } from "@/lib/desk";
import { api } from "@/lib/api";
import { showPct, showRupee } from "@/lib/format";
import { useState } from "react";

function instructionText(idea: PlainIdea): string {
  const lines = [
    `${idea.action} ${idea.contract} on Zerodha (${idea.exchange})`,
    idea.stop ? `Stop: ${idea.stop}` : null,
    idea.target ? `Target: ${idea.target}` : null,
    idea.atrStop ? `ATR stop: ${idea.atrStop}` : null,
    idea.when ? `Hold: ${idea.when}` : null,
    idea.why,
    "Place this on Zerodha. This app will not send the order.",
  ].filter(Boolean);
  return lines.join("\n");
}

export function AdviceCard({
  idea,
  note,
  onTrained,
}: {
  idea: PlainIdea;
  note?: string | null;
  onTrained?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function trainBuy() {
    const px = idea.lastPrice ?? idea.premium;
    if (!px) {
      setMsg("No price yet");
      return;
    }
    const budget = 2500;
    const qty = Math.max(1, Math.floor(budget / Number(px)));
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/paper/buy", {
        method: "POST",
        body: JSON.stringify({
          exchange: idea.exchange,
          symbol: idea.contract,
          quantity: qty,
          lane: "CASH",
          kind: idea.kind,
          prediction: {
            eodSpot: idea.target ?? null,
            entrySpot: px,
            why: idea.why,
          },
        }),
      });
      setMsg("Paper BUY recorded");
      onTrained?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Train buy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`advice ${idea.action === "SELL" ? "sell" : idea.action === "HOLD" ? "hold" : "buy"}`} data-coach="card">
      <p className="eyebrow">
        <span className="eyebrow-dot" aria-hidden="true" />
        {idea.label}
        {idea.rank != null ? ` · #${idea.rank}` : ""}
      </p>
      <h3>{idea.contract}</h3>
      <p className="advice-action">{idea.title}</p>
      <p>{idea.why}</p>
      {idea.when ? <p className="muted">{idea.action === "BUY" ? `If you buy on Zerodha: ${idea.when}` : idea.when}</p> : null}
      {idea.rsVsNifty != null || idea.atrStop ? (
        <p className="muted" data-coach="rs">
          {idea.rsVsNifty != null ? `RS vs Nifty ${showPct(idea.rsVsNifty * 100)}. ` : ""}
          {idea.atrStop ? `ATR stop ${showRupee(idea.atrStop)}.` : ""}
          {idea.target ? ` First target ${showRupee(idea.target)}.` : ""}
        </p>
      ) : null}
      {idea.premium ? <p className="muted">About {showRupee(idea.premium)} right now.</p> : null}
      {idea.lastPrice && idea.kind === "EQ" ? <p className="muted">About {showRupee(idea.lastPrice)} right now.</p> : null}
      <p className="muted" data-coach="instruct">
        Order instruction — copy and place on Zerodha. This app never sends the order.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        <CopyQuiet text={instructionText(idea)} label="Copy instruction" />
        <CopyQuiet text={idea.contract} />
        {idea.action === "BUY" && idea.canPaper ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void trainBuy()}>
            TRAIN BUY
          </button>
        ) : null}
      </div>
      {msg ? <p className="muted">{msg}</p> : null}
      {note ? <p className="muted">{note}</p> : null}
    </article>
  );
}
