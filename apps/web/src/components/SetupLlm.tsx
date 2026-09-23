"use client";

import { AiProvidersPanel } from "@/components/AiProvidersPanel";
import { VectorAtmosphere } from "@/components/VectorAtmosphere";
import { useEffect, useState } from "react";

type Props = {
  onDone: () => void;
  onSkip: () => void;
};

export function SetupLlm({ onDone, onSkip }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className={`creds-gate${ready ? " on" : ""}`}>
      <VectorAtmosphere />
      <div className="creds-bg" aria-hidden="true" />

      <header className="creds-top">
        <div className="creds-brand">
          <span className="creds-mark">XT</span>
          <div>
            <strong>xTrader</strong>
            <span>Analysis terminal · read-only</span>
          </div>
        </div>
        <span className="badge ok">STEP 3 OF 3</span>
      </header>

      <main className="creds-stage creds-stage-single">
        <section className="creds-panel creds-form-panel">
          <p className="eyebrow">First run</p>
          <h1>Add a language model</h1>
          <p className="lede">
            Optional. A paid provider or a local model (Ollama, LM Studio) powers AI study.
            Skip this and the desk still trains on live data with the algo equation — AI jobs stay off until you add one later in Settings.
          </p>
          <AiProvidersPanel variant="setup" onActivated={onDone} />
          <div className="creds-llm-actions">
            <button className="btn" type="button" onClick={onSkip}>
              Skip for now — algo only
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
