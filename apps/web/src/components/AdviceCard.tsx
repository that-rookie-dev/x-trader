"use client";

import { CopyQuiet } from "@/components/CopyQuiet";
import type { PlainIdea } from "@/lib/desk";

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
}: {
  idea: PlainIdea;
  note?: string | null;
}) {
  return (
    <article className={`advice ${idea.action === "SELL" ? "sell" : idea.action === "HOLD" ? "hold" : "buy"}`} data-coach="card">
      <p className="eyebrow">{idea.label}{idea.rank != null ? ` · #${idea.rank}` : ""}</p>
      <h3>{idea.contract}</h3>
      <p className="advice-action">{idea.title}</p>
      <p>{idea.why}</p>
      {idea.when ? <p className="muted">{idea.action === "BUY" ? `If you buy on Zerodha: ${idea.when}` : idea.when}</p> : null}
      {idea.rsVsNifty != null || idea.atrStop ? (
        <p className="muted" data-coach="rs">
          {idea.rsVsNifty != null ? `RS vs Nifty ${(idea.rsVsNifty * 100).toFixed(1)}%. ` : ""}
          {idea.atrStop ? `ATR stop ₹${idea.atrStop}.` : ""}
          {idea.target ? ` First target ₹${idea.target}.` : ""}
        </p>
      ) : null}
      {idea.premium ? <p className="muted">About ₹{idea.premium} right now.</p> : null}
      {idea.lastPrice && idea.kind === "EQ" ? <p className="muted">About ₹{idea.lastPrice} right now.</p> : null}
      <p className="muted" data-coach="instruct">
        Order instruction — copy and place on Zerodha. This app never sends the order.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        <CopyQuiet text={instructionText(idea)} label="Copy instruction" />
        <CopyQuiet text={idea.contract} />
      </div>
      {note ? <p className="muted">{note}</p> : null}
    </article>
  );
}
