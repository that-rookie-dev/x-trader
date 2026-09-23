"use client";

import { ExpiryPicker, type ExpiryOption } from "@/components/ExpiryPicker";
import { NamePicker, type DeskName } from "@/components/NamePicker";
import { VectorSpark } from "@/components/VectorSpark";

export type StudyVs = {
  tag: string;
  hint: string;
  tone: "yes" | "wide" | "no" | "idle";
};

/** Spot prediction vs actual — shown inside the Study bar when market is closed. */
export type PredScore = {
  actual: string;
  algoErr: string | null;
  aiErr: string | null;
  kind?: string;
};

function errTone(signed: string | null | undefined): string {
  if (!signed) return "";
  const n = Number(signed.replace(/[+%]/g, ""));
  if (!Number.isFinite(n) || n === 0) return "flat";
  return signed.startsWith("-") ? "down" : "up";
}

function shortDir(direction?: string | null) {
  const d = (direction ?? "").toUpperCase();
  if (d === "BULLISH") return "BULL";
  if (d === "BEARISH") return "BEAR";
  if (d === "RANGE") return "RNG";
  return d || null;
}

export function StudyBar({
  names,
  symbol,
  onNameChange,
  expiries,
  expiry,
  onExpiryChange,
  spot,
  spotFlash,
  algoClose,
  vs,
  aiClose,
  aiConfidence,
  aiDirection,
  studying,
  aiReady = true,
  onStudy,
  predScore,
  predictionMode = "ALGO",
  learning,
}: {
  names: DeskName[];
  symbol: string;
  onNameChange: (name: DeskName) => void;
  expiries: ExpiryOption[];
  expiry: string;
  onExpiryChange: (date: string) => void;
  spot: string | number | null | undefined;
  spotFlash?: string;
  algoClose: string | number | null | undefined;
  vs: StudyVs;
  aiClose: string | number | null | undefined;
  aiConfidence?: number | null;
  aiDirection?: string | null;
  studying: boolean;
  aiReady?: boolean;
  onStudy: () => void;
  predScore?: PredScore | null;
  predictionMode?: "ALGO" | "AI";
  learning?: {
    algo?: { mae: number | null; lastTuned: string | null } | null;
    ai?: { mae: number | null; lastTuned: string | null } | null;
  } | null;
}) {
  const aiTone = (aiDirection ?? "").toLowerCase();
  const dir = shortDir(aiDirection);
  const aiClass = aiTone ? `dir-${aiTone}` : "";
  const algoErrClass = errTone(predScore?.algoErr);
  const aiErrClass = errTone(predScore?.aiErr);
  const algoMae =
    learning?.algo?.mae != null && Number.isFinite(learning.algo.mae)
      ? `${learning.algo.mae.toFixed(1)}%`
      : null;
  const aiMae =
    learning?.ai?.mae != null && Number.isFinite(learning.ai.mae)
      ? `${learning.ai.mae.toFixed(1)}%`
      : null;

  return (
    <div className="study-bar card">
      <div className="sb-controls">
        <label data-coach="und" className="sb-pick">
          <span>UND</span>
          <NamePicker names={names} value={symbol} onChange={onNameChange} />
        </label>
        <label data-coach="exp" className="sb-pick">
          <span>EXP</span>
          <ExpiryPicker options={expiries} value={expiry} onChange={onExpiryChange} />
        </label>
      </div>

      <div className="sb-ticker" data-coach="spot">
        <span className="sb-pair">
          <i>SPOT</i>
          <b className={`mono ${spotFlash ?? ""}`}>{spot ?? "—"}</b>
        </span>
        <span className="sb-rule" aria-hidden />
        <span
          className={`sb-pair sb-algo ${algoErrClass} ${predictionMode === "ALGO" ? "sb-active" : ""}`}
          title={
            predScore
              ? `Algo → actual ${predScore.actual}`
              : algoMae
                ? `ALGO MAE ${algoMae}${learning?.algo?.lastTuned ? ` · tuned ${learning.algo.lastTuned}` : ""}`
                : "Mechanical equation"
          }
        >
          <i>ALGO</i>
          <b className="mono">{algoClose ?? "—"}</b>
          {predScore?.algoErr ? <em className={algoErrClass}>{predScore.algoErr}</em> : algoMae ? <em className="idle">MAE {algoMae}</em> : null}
        </span>
        <span className="sb-rule" aria-hidden />
        <span className={`sb-vs ${vs.tone}`} title={vs.hint}>
          {vs.tag}
        </span>
        <span className="sb-rule" aria-hidden />
        <span
          className={`sb-pair sb-ai ${aiClass} ${aiErrClass} ${predictionMode === "AI" ? "sb-active" : ""}`}
          title={
            predScore
              ? `AI → actual ${predScore.actual}`
              : aiMae
                ? `AI MAE ${aiMae}${learning?.ai?.lastTuned ? ` · tuned ${learning.ai.lastTuned}` : ""}`
                : "AI equation / study"
          }
        >
          <i>AI</i>
          <b className="mono">{aiClose ?? (studying ? "…" : "—")}</b>
          {predScore?.aiErr ? (
            <em className={aiErrClass}>{predScore.aiErr}</em>
          ) : aiConfidence != null && dir ? (
            <em>
              {aiConfidence}% {dir}
            </em>
          ) : aiMae ? (
            <em className="idle">MAE {aiMae}</em>
          ) : (
            <em className="idle">{studying ? "SCAN" : "IDLE"}</em>
          )}
        </span>
        {predScore ? (
          <>
            <span className="sb-rule" aria-hidden />
            <span className="sb-pair sb-score" title={`${predScore.kind ?? "PRED"} actual close`}>
              <i>ACT</i>
              <b className="mono">{predScore.actual}</b>
            </span>
          </>
        ) : null}
      </div>

      <button
        type="button"
        className="btn primary sb-go"
        data-coach="study"
        disabled={studying || !aiReady}
        title={aiReady ? undefined : "Add an LLM in Settings to run AI study"}
        onClick={onStudy}
      >
        <VectorSpark />
        {studying ? "SCAN…" : "STUDY"}
      </button>
    </div>
  );
}
