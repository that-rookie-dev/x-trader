export type ProviderType = "cloud" | "local";

export interface ProviderInfo {
  id: string;
  name: string;
  type: ProviderType;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
}

/** Catalog aligned with Agent-X (`AVAILABLE_PROVIDERS`). */
export const AVAILABLE_PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.anthropic.com" },
  { id: "google", name: "Google (Gemini)", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "moonshot", name: "Moonshot AI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.moonshot.ai/v1" },
  { id: "deepseek", name: "DeepSeek", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "groq", name: "Groq", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", name: "Mistral AI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.mistral.ai/v1" },
  { id: "together", name: "Together AI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.together.xyz/v1" },
  { id: "xai", name: "xAI (Grok)", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.x.ai/v1" },
  { id: "fireworks", name: "Fireworks AI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "perplexity", name: "Perplexity", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.perplexity.ai" },
  { id: "azure", name: "Azure OpenAI", type: "cloud", requiresApiKey: true, defaultBaseUrl: "" },
  { id: "cohere", name: "Cohere", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.cohere.com/v2" },
  { id: "commandcode", name: "CommandCode", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://api.commandcode.ai/provider/v1" },
  { id: "opencode", name: "OpenCode Go", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://opencode.ai/zen/go/v1" },
  { id: "opencode-zen", name: "OpenCode Zen", type: "cloud", requiresApiKey: true, defaultBaseUrl: "https://opencode.ai/zen/v1" },
  { id: "custom", name: "Custom Provider", type: "cloud", requiresApiKey: true, defaultBaseUrl: "" },
  { id: "ollama", name: "Ollama", type: "local", requiresApiKey: false, defaultBaseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", name: "LM Studio", type: "local", requiresApiKey: false, defaultBaseUrl: "http://127.0.0.1:1234/v1" },
];

export function getProvider(id: string): ProviderInfo | undefined {
  return AVAILABLE_PROVIDERS.find((p) => p.id === id);
}

export function defaultLocalPort(providerId: string): string {
  if (providerId === "lmstudio") return "1234";
  return "11434";
}

export function buildLocalBaseUrl(providerId: string, host: string, port: string): string {
  const h = (host.trim() || "127.0.0.1").replace(/\/+$/, "");
  const p = (port.trim() || defaultLocalPort(providerId)).replace(/^:/, "");
  if (providerId === "lmstudio" || providerId === "ollama") return `http://${h}:${p}/v1`;
  return `http://${h}:${p}`;
}

export function parseLocalEndpoint(baseUrl: string | undefined, providerId: string): { host: string; port: string } {
  const fallback = { host: "127.0.0.1", port: defaultLocalPort(providerId) };
  if (!baseUrl?.trim()) return fallback;
  try {
    const raw = baseUrl.includes("://") ? baseUrl : `http://${baseUrl}`;
    const u = new URL(raw);
    return { host: u.hostname || "127.0.0.1", port: u.port || defaultLocalPort(providerId) };
  } catch {
    return fallback;
  }
}

export function nativeOllamaBase(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}
