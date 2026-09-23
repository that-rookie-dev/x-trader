"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type ProviderInfo = {
  id: string;
  name: string;
  type: "cloud" | "local";
  requiresApiKey: boolean;
  defaultBaseUrl: string;
};

export type AiProfile = {
  id: string;
  name: string;
  kind: string;
  providerName: string;
  type: string;
  modelId: string;
  baseUrl?: string | null;
  isActive: boolean;
  hasKey: boolean;
};

type ListedModel = { id: string; name: string };
type Probe = { ok: boolean; message: string; sample?: string; latencyMs?: number; model?: string };

function probeKey(profileId: string, modelId: string) {
  return `${profileId}:${modelId}`;
}

function defaultPort(id: string) {
  return id === "lmstudio" ? "1234" : "11434";
}

function localUrl(id: string, host: string, port: string) {
  const h = host.trim() || "127.0.0.1";
  const p = (port.trim() || defaultPort(id)).replace(/^:/, "");
  return `http://${h}:${p}/v1`;
}

export function AiProvidersPanel() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    label: "",
    providerId: "",
    apiKey: "",
    baseUrl: "",
    host: "127.0.0.1",
    port: "",
  });
  const [picker, setPicker] = useState<AiProfile | null>(null);
  const [models, setModels] = useState<ListedModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [manual, setManual] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [probe, setProbe] = useState<Record<string, Probe>>({});

  const selected = useMemo(
    () => providers.find((p) => p.id === draft.providerId),
    [providers, draft.providerId],
  );

  async function load() {
    const cat = await api<{ providers: ProviderInfo[] }>("/api/ai/providers/available");
    setProviders(cat.providers);
    setProfiles(await api<AiProfile[]>("/api/ai/profiles"));
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load providers"));
  }, []);

  function openAdd() {
    setDraft({ label: "", providerId: "", apiKey: "", baseUrl: "", host: "127.0.0.1", port: "" });
    setAddOpen(true);
    setError("");
  }

  async function saveProfile() {
    if (!draft.providerId || !draft.label.trim()) {
      setError("Name the profile and pick a provider.");
      return;
    }
    const isLocal = selected?.type === "local";
    const isCustom = draft.providerId === "custom" || draft.providerId === "azure";
    if (!isLocal && !draft.apiKey.trim()) {
      setError("Enter your API key.");
      return;
    }
    if (isCustom && !draft.baseUrl.trim()) {
      setError("Custom / Azure needs a base URL.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const baseUrl = isLocal
        ? localUrl(draft.providerId, draft.host, draft.port)
        : draft.baseUrl || selected?.defaultBaseUrl || undefined;
      const check = await api<{ valid: boolean; error?: string }>("/api/ai/providers/validate", {
        method: "POST",
        body: JSON.stringify({
          providerId: draft.providerId,
          apiKey: isLocal ? "no-key-needed" : draft.apiKey,
          baseUrl,
        }),
      }).catch(async (e) => ({ valid: false, error: e instanceof Error ? e.message : "unreachable" }));
      if (!check.valid) {
        setError(check.error ?? "Provider is unreachable.");
        return;
      }
      const list = await api<AiProfile[]>("/api/ai/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: draft.label.trim(),
          kind: draft.providerId,
          apiKey: isLocal ? undefined : draft.apiKey,
          baseUrl,
          modelId: "",
          activate: false,
        }),
      });
      setProfiles(list);
      setAddOpen(false);
      const created = list.find((p) => p.name === draft.label.trim() && p.kind === draft.providerId);
      if (created) await openPicker(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add profile");
    } finally {
      setSaving(false);
    }
  }

  async function openPicker(profile: AiProfile) {
    setPicker(profile);
    setModelId(profile.modelId);
    setManual(profile.modelId);
    setModels([]);
    setLoadingModels(true);
    setError("");
    try {
      const res = await api<{ models: ListedModel[] }>("/api/ai/providers/models", {
        method: "POST",
        body: JSON.stringify({ providerId: profile.kind, profileId: profile.id }),
      });
      setModels(res.models);
      if (!profile.modelId && res.models[0]) setModelId(res.models[0].id);
    } catch (e) {
      if (profile.kind === "custom") setError("");
      else setError(e instanceof Error ? e.message : "Failed to list models");
    } finally {
      setLoadingModels(false);
    }
  }

  async function confirmModel() {
    if (!picker) return;
    const chosen = (modelId || manual).trim();
    if (!chosen) {
      setError("Select or type a model id.");
      return;
    }
    setProfiles(await api<AiProfile[]>(`/api/ai/profiles/${picker.id}/model`, {
      method: "POST",
      body: JSON.stringify({ modelId: chosen }),
    }));
    setPicker((p) => (p ? { ...p, modelId: chosen } : p));
  }

  function resultFor(profileId: string, model: string) {
    return probe[probeKey(profileId, model)];
  }

  async function activatePicker() {
    if (!picker) return;
    const chosen = (modelId || manual).trim();
    if (!chosen) {
      setError("Select or type a model id.");
      return;
    }
    const hit = resultFor(picker.id, chosen);
    if (!hit?.ok) {
      setError("Live-test this model first. Activate stays locked until it replies.");
      return;
    }
    await confirmModel();
    setProfiles(await api<AiProfile[]>(`/api/ai/profiles/${picker.id}/activate`, { method: "POST", body: "{}" }));
    setPicker(null);
  }

  async function switchProfile(profile: AiProfile) {
    if (!profile.modelId) {
      await openPicker(profile);
      return;
    }
    if (!resultFor(profile.id, profile.modelId)?.ok) {
      setError("Live-test this model first. Activate stays locked until it replies.");
      await openPicker(profile);
      return;
    }
    setProfiles(await api<AiProfile[]>(`/api/ai/profiles/${profile.id}/activate`, { method: "POST", body: "{}" }));
  }

  async function deleteProfile(profile: AiProfile) {
    if (!confirm(`Delete profile “${profile.name}”?`)) return;
    setProfiles(await api<AiProfile[]>(`/api/ai/profiles/${profile.id}/delete`, { method: "POST", body: "{}" }));
  }

  async function rename(profile: AiProfile) {
    const name = editName.trim();
    if (!name) return;
    setProfiles(await api<AiProfile[]>(`/api/ai/profiles/${profile.id}/rename`, { method: "POST", body: JSON.stringify({ name }) }));
    setEditing(null);
  }

  async function testProfile(profile: AiProfile, modelOverride?: string) {
    const chosen = (modelOverride || profile.modelId || "").trim();
    if (!chosen) {
      setError("Pick a model, then run a live test.");
      return;
    }
    setTesting(profile.id);
    setError("");
    try {
      const res = await api<{ ok: boolean; message: string; sample?: string; latencyMs?: number; model?: string }>(
        `/api/ai/profiles/${profile.id}/test`,
        {
          method: "POST",
          body: JSON.stringify({ modelId: chosen }),
        },
      );
      setProbe((cur) => ({
        ...cur,
        [probeKey(profile.id, chosen)]: {
          ok: res.ok,
          message: res.message,
          sample: res.sample,
          latencyMs: res.latencyMs,
          model: res.model ?? chosen,
        },
      }));
      if (!res.ok) setError(res.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "test failed";
      setProbe((cur) => ({
        ...cur,
        [probeKey(profile.id, chosen)]: { ok: false, message, model: chosen },
      }));
      setError(message);
    } finally {
      setTesting(null);
    }
  }

  function ProbeCard({ hit }: { hit?: Probe }) {
    if (!hit) return <p className="muted">Run a live test before activating. This actually calls the model with “PONG”.</p>;
    return (
      <div className={`probe ${hit.ok ? "ok" : "fail"}`}>
        <strong>{hit.ok ? "Live test passed" : "Live test failed"}</strong>
        <div>{hit.message}</div>
        {hit.sample ? <div className="sample">Reply · {hit.sample}</div> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>AI providers</h2>
        <button className="btn primary" onClick={openAdd}>
          Add profile
        </button>
      </div>
      <p className="muted">
        Add a profile, pick a model, run a live ping, then activate. API keys are encrypted and never shown again.
      </p>
      {error ? <p className="down">{error}</p> : null}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 10 }}>
        {profiles.map((p) => (
          <div key={p.id} className={`card profile-card ${p.isActive ? "active" : ""}`} style={{ margin: 0 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              {editing === p.id ? (
                <div className="row">
                  <input className="input" style={{ maxWidth: 160 }} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <button className="btn primary" onClick={() => void rename(p)}>
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <strong>{p.name}</strong>
                  {p.isActive ? <span className="badge ok">ACTIVE</span> : null}
                </>
              )}
            </div>
            <p className="muted">
              Provider · {p.providerName}
              {p.hasKey ? " · key saved" : p.type === "local" ? " · local" : ""}
            </p>
            <p className="mono">
              {p.modelId || "No model"}
            </p>
            <ProbeCard hit={p.modelId ? resultFor(p.id, p.modelId) : undefined} />
            <div className="row">
              <button className="btn" onClick={() => void openPicker(p)}>
                {p.modelId ? "Models" : "Pick model"}
              </button>
              <button className="btn test" onClick={() => void testProfile(p)} disabled={testing === p.id || !p.modelId}>
                {testing === p.id ? "Pinging…" : "Live test"}
              </button>
              <button
                className="btn primary"
                disabled={p.isActive || !(p.modelId && resultFor(p.id, p.modelId)?.ok)}
                title={p.isActive ? "Already active" : !(p.modelId && resultFor(p.id, p.modelId)?.ok) ? "Live-test this model first" : undefined}
                onClick={() => void switchProfile(p)}
              >
                {p.isActive ? "Active" : "Activate"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setEditing(p.id);
                  setEditName(p.name);
                }}
              >
                Rename
              </button>
              <button className="btn danger" onClick={() => void deleteProfile(p)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {profiles.length === 0 ? (
        <p className="muted">No profiles yet. Add OpenAI, Anthropic, Ollama, LM Studio, or a custom OpenAI-compatible endpoint.</p>
      ) : null}

      {addOpen ? (
        <div className="modal" onClick={() => setAddOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>New profile</h2>
            <label className="muted">Profile name</label>
            <input className="input" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Work OpenAI" />
            <label className="muted">Provider</label>
            <select
              className="input"
              value={draft.providerId}
              onChange={(e) => {
                const id = e.target.value;
                const info = providers.find((p) => p.id === id);
                setDraft({
                  ...draft,
                  providerId: id,
                  baseUrl: info?.defaultBaseUrl ?? "",
                  port: defaultPort(id),
                });
              }}
            >
              <option value="">Select…</option>
              <optgroup label="Cloud">
                {providers
                  .filter((p) => p.type === "cloud")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Local">
                {providers
                  .filter((p) => p.type === "local")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            </select>
            {selected?.type === "local" ? (
              <div className="row">
                <input className="input" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="host" />
                <input className="input" style={{ maxWidth: 100 }} value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} placeholder="port" />
              </div>
            ) : (
              <>
                {(draft.providerId === "custom" || draft.providerId === "azure" || selected?.defaultBaseUrl === "") && (
                  <input className="input" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                )}
                <label className="muted">API key (encrypted, never shown again)</label>
                <input className="input" type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" />
              </>
            )}
            {error ? <p className="down">{error}</p> : null}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" disabled={saving} onClick={() => void saveProfile()}>
                {saving ? "Validating…" : "Validate & add"}
              </button>
              <button className="btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <div className="modal" onClick={() => setPicker(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Select a model for {picker.name}</h2>
            <p className="muted">Models are listed live from the provider. A profile cannot be activated without a model.</p>
            {loadingModels ? <p className="muted">Loading models…</p> : null}
            {!loadingModels && models.length > 0 ? (
              <select className="input" value={modelId} onChange={(e) => {
                setModelId(e.target.value);
                setManual(e.target.value);
              }}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="muted">Or type a model id</label>
            <input
              className="input"
              value={manual}
              onChange={(e) => {
                setManual(e.target.value);
                setModelId(e.target.value);
              }}
              placeholder="gpt-4.1-mini / llama3.2"
            />
            <p className="muted">Save is optional. Live-test the selected id — that actually calls the model. Activate stays locked until the ping passes.</p>
            <ProbeCard hit={resultFor(picker.id, (modelId || manual).trim())} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => void confirmModel()}>
                Save model
              </button>
              <button
                className="btn test"
                disabled={testing === picker.id || !(modelId || manual).trim()}
                onClick={() => void testProfile({ ...picker, modelId: (modelId || manual).trim() }, (modelId || manual).trim())}
              >
                {testing === picker.id ? "Pinging…" : "Live test"}
              </button>
              <button
                className="btn primary"
                disabled={!resultFor(picker.id, (modelId || manual).trim())?.ok}
                onClick={() => void activatePicker()}
              >
                Activate
              </button>
              <button className="btn" onClick={() => setPicker(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
