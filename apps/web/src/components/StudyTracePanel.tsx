"use client";

import { useEffect, useRef } from "react";

export type StudyPhase = { label: string; detail?: string };

export function StudyTracePanel({
  open,
  studying,
  phases,
  prompt,
  modelLabel,
  llmText,
  status,
  onClose,
}: {
  open: boolean;
  studying: boolean;
  phases: StudyPhase[];
  prompt: { system: string; prompt: string } | null;
  modelLabel: string | null;
  llmText: string;
  status: string | null;
  onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [open, phases, llmText, status, prompt]);

  if (!open) return null;

  return (
    <div className="study-drawer-root" role="dialog" aria-label="Study trace">
      <button type="button" className="study-drawer-scrim" aria-label="Close study panel" onClick={onClose} />
      <aside className="study-drawer">
        <header className="study-drawer-head">
          <div>
            <p className="eyebrow">Agent desk</p>
            <h2>{studying ? "Studying…" : "Study trace"}</h2>
            {modelLabel ? <p className="muted mono">{modelLabel}</p> : null}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="study-drawer-body">
          <section className="study-trace-block">
            <h3>Work log</h3>
            <ul className="study-phase-list">
              {phases.map((phase, i) => (
                <li key={`${phase.label}-${i}`}>
                  <b>{phase.label}</b>
                  {phase.detail ? <span className="muted">{phase.detail}</span> : null}
                </li>
              ))}
              {!phases.length ? <li className="muted">Waiting for the first step…</li> : null}
            </ul>
          </section>

          {prompt ? (
            <section className="study-trace-block">
              <h3>Sent to model</h3>
              <details open={studying}>
                <summary>System</summary>
                <pre className="study-pre">{prompt.system}</pre>
              </details>
              <details open={studying}>
                <summary>Prompt payload</summary>
                <pre className="study-pre">{prompt.prompt}</pre>
              </details>
            </section>
          ) : null}

          <section className="study-trace-block">
            <h3>Model stream</h3>
            <pre className={`study-pre study-llm ${studying ? "live" : ""}`}>
              {llmText || (studying ? "…" : "No model text yet.")}
            </pre>
          </section>

          {status ? <p className={`study-status ${studying ? "" : "done"}`}>{status}</p> : null}
          <div ref={endRef} />
        </div>
      </aside>
    </div>
  );
}
