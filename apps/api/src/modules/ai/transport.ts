import { AppError } from "@xtrader/domain";
import { getProvider, nativeOllamaBase } from "./catalog.js";
import { isOpencodeFamily, opencodeHeaders } from "./opencode-route.js";

export interface ListedModel {
  id: string;
  name: string;
}

export function parseModelCatalog(json: unknown): ListedModel[] {
  if (!json || typeof json !== "object") return [];
  const rec = json as Record<string, unknown>;
  const arrays = [rec.data, rec.models, rec.results, rec.data === undefined && Array.isArray(json) ? json : null];
  const items = arrays.find((a) => Array.isArray(a)) as Array<Record<string, unknown>> | undefined;
  if (!items) return [];
  return items
    .map((m) => {
      const id = String(m.id ?? m.name ?? m.model ?? "");
      if (!id) return null;
      return { id, name: String(m.display_name ?? m.name ?? id) };
    })
    .filter((m): m is ListedModel => m != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveBase(providerId: string, baseUrl?: string): string {
  const info = getProvider(providerId);
  const url = (baseUrl || info?.defaultBaseUrl || "").replace(/\/+$/, "");
  if (!url) throw new AppError("PROVIDER_BASE_URL", "This provider needs a base URL.", 422);
  return url;
}

export async function validateProvider(input: {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<{ valid: true; name: string } | { valid: false; error: string }> {
  try {
    await listProviderModels(input);
    return { valid: true, name: getProvider(input.providerId)?.name ?? input.providerId };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "provider-unreachable" };
  }
}

export async function listProviderModels(input: {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  profileId?: string;
}): Promise<ListedModel[]> {
  const info = getProvider(input.providerId);
  const key = input.apiKey?.trim() ?? "";
  if (info?.requiresApiKey && !key) {
    throw new AppError("API_KEY_REQUIRED", `Enter an API key for ${info.name}.`, 422);
  }

  if (input.providerId === "ollama") {
    const native = nativeOllamaBase(resolveBase(input.providerId, input.baseUrl));
    const res = await fetch(`${native}/api/tags`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    }
  }

  if (input.providerId === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      throw new Error("Unable to reach Anthropic. Check your connection.");
    });
    if (!res.ok) throw new Error(statusError("Anthropic", res.status));
    return parseModelCatalog(await res.json());
  }

  const base = resolveBase(input.providerId, input.baseUrl);
  const headers: Record<string, string> = { "User-Agent": "xTrader/1.0" };
  if (key && key !== "no-key-needed") headers.Authorization = `Bearer ${key}`;
  if (isOpencodeFamily(input.providerId)) {
    Object.assign(headers, opencodeHeaders(input.profileId || "catalog"));
  }
  const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => {
    throw new Error(`Unable to reach ${info?.name ?? input.providerId}. Check the base URL.`);
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`${info?.name ?? input.providerId} does not list models via /models. Enter a model id manually.`);
    }
    throw new Error(statusError(info?.name ?? input.providerId, res.status));
  }
  return parseModelCatalog(await res.json());
}

function statusError(name: string, status: number): string {
  if (status === 401 || status === 403) return `Invalid API key for ${name}.`;
  return `${name} API error: ${status}`;
}
