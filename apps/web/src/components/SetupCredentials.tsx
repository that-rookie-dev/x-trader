"use client";

import { api } from "@/lib/api";
import { VectorAtmosphere } from "@/components/VectorAtmosphere";
import { useEffect, useState } from "react";

type Props = {
  redirectHint?: string;
  onSaved: () => void;
};

const STEPS = [
  {
    n: "01",
    title: "Open Kite Connect",
    body: "Go to developers.kite.trade and sign in with your Zerodha credentials.",
  },
  {
    n: "02",
    title: "Create an app",
    body: "Click Create new app. Choose type Connect. Give it any name (e.g. xTrader).",
  },
  {
    n: "03",
    title: "Set redirect URL",
    body: "Paste the redirect URL shown on this screen into the app’s Redirect URL field — exact match required.",
  },
  {
    n: "04",
    title: "Copy key & secret",
    body: "After creating the app, copy the API key and API secret. Paste them here. xTrader encrypts them on this machine.",
  },
];

export function SetupCredentials({ redirectHint, onSaved }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  const redirect =
    redirectHint ??
    (typeof window !== "undefined"
      ? `${window.location.origin}/zerodha/callback`
      : "http://localhost:3456/zerodha/callback");

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4200);
    return () => window.clearInterval(id);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/setup/kite", {
        method: "POST",
        body: JSON.stringify({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save credentials");
    } finally {
      setBusy(false);
    }
  }

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(redirect);
    } catch {
      /* ignore */
    }
  }

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
        <span className="badge ok">STEP 1 OF 3</span>
      </header>

      <main className="creds-stage">
        <section className="creds-panel creds-form-panel">
          <p className="eyebrow">First run</p>
          <h1>Connect your Kite app</h1>
          <p className="lede">
            Enter your Zerodha API key and secret once. They are encrypted and stored only on this
            machine — never sent to a third party. You can revoke them later from Settings.
          </p>

          <form className="creds-form" onSubmit={(e) => void submit(e)}>
            <label>
              <span>API key</span>
              <input
                className="input"
                name="apiKey"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxx"
                required
                minLength={6}
              />
            </label>
            <label>
              <span>API secret</span>
              <div className="creds-secret">
                <input
                  className="input"
                  name="apiSecret"
                  type={showSecret ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? "Hide secret" : "Show secret"}
                >
                  {showSecret ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {error ? <p className="creds-error">{error}</p> : null}

            <button className="btn primary creds-submit" type="submit" disabled={busy}>
              {busy ? "Encrypting…" : "Save & continue"}
            </button>
          </form>

          <div className="creds-redirect">
            <span className="muted">Redirect URL for your Kite app</span>
            <div className="creds-redirect-row">
              <code className="mono">{redirect}</code>
              <button type="button" className="btn" onClick={() => void copyRedirect()}>
                Copy
              </button>
            </div>
          </div>
        </section>

        <section className="creds-panel creds-help-panel">
          <p className="eyebrow">How to get keys</p>
          <h2>Zerodha Kite Connect</h2>
          <ol className="creds-steps">
            {STEPS.map((s, i) => (
              <li key={s.n} className={i === step ? "on" : ""}>
                <span className="creds-step-n">{s.n}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <a
            className="btn creds-ext"
            href="https://developers.kite.trade/"
            target="_blank"
            rel="noreferrer"
          >
            Open Kite developers →
          </a>
          <p className="creds-foot muted">
            xTrader never places orders. Keys are used only to read market data and your portfolio
            after you log in with Zerodha.
          </p>
        </section>
      </main>
    </div>
  );
}
