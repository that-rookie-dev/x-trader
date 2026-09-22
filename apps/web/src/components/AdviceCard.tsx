"use client";

import { CopyQuiet } from "@/components/CopyQuiet";
import type { PlainIdea } from "@/lib/desk";

export function AdviceCard({
  idea,
  paperMode,
  busy,
  note,
  onPaper,
}: {
  idea: PlainIdea;
  paperMode: boolean;
  busy?: boolean;
  note?: string | null;
  onPaper: (idea: PlainIdea) => void;
}) {
  return (
    <article className={`advice ${idea.action === "SELL" ? "sell" : idea.action === "HOLD" ? "hold" : "buy"}`}>
      <p className="eyebrow">{idea.label}</p>
      <h3>{idea.kind === "EQ" ? idea.contract : idea.contract}</h3>
      <p className="advice-action">{idea.title}</p>
      <p>{idea.why}</p>
      {idea.when ? <p className="muted">{idea.action === "BUY" ? `If you buy: ${idea.when}` : idea.when}</p> : null}
      {idea.premium ? <p className="muted">About ₹{idea.premium} right now.</p> : null}
      {idea.lastPrice && idea.kind === "EQ" ? <p className="muted">About ₹{idea.lastPrice} right now.</p> : null}
      <div className="row" style={{ marginTop: 14 }}>
        {paperMode && idea.canPaper ? (
          <button className="btn primary" disabled={busy} onClick={() => onPaper(idea)}>
            {idea.action === "SELL" ? "Sell with play money" : "Try with play money"}
          </button>
        ) : null}
        <CopyQuiet text={idea.contract} />
      </div>
      {note ? <p className="muted">{note}</p> : null}
    </article>
  );
}
