"use client";

import { VectorAtmosphere } from "@/components/VectorAtmosphere";
import { useEffect, useState } from "react";

type Props = {
  linked?: boolean;
  onConnect: () => void;
  error?: string | null;
};

export function SetupZerodha({ linked, onConnect, error }: Props) {
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
        <span className="badge ok">STEP 2 OF 3</span>
      </header>

      <main className="creds-stage creds-stage-single">
        <section className="creds-panel creds-form-panel">
          <p className="eyebrow">First run</p>
          <h1>{linked ? "Reconnect your Zerodha account" : "Log in to Zerodha"}</h1>
          <p className="lede">
            Keys are saved. Next, sign in with Zerodha so the desk can read live prices and your book.
            xTrader stays read-only — every order still happens in the Zerodha app.
          </p>
          {error ? <p className="creds-error">{error}</p> : null}
          <button className="btn primary creds-submit" type="button" onClick={onConnect}>
            {linked ? "Reconnect Zerodha" : "Log in with Zerodha"}
          </button>
          <p className="creds-foot muted">
            You will return here after Kite login. The desk opens only after this session is linked.
          </p>
        </section>
      </main>
    </div>
  );
}
