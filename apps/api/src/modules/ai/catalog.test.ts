import { describe, expect, it } from "vitest";
import { parseModelCatalog } from "./transport.js";
import { AVAILABLE_PROVIDERS, buildLocalBaseUrl } from "./catalog.js";

describe("AI provider catalog", () => {
  it("includes cloud and local providers like Agent-X", () => {
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "openai" && p.requiresApiKey)).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "ollama" && !p.requiresApiKey)).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "lmstudio")).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "commandcode")).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "opencode")).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "opencode-zen")).toBe(true);
    expect(AVAILABLE_PROVIDERS.some((p) => p.id === "custom")).toBe(true);
  });

  it("builds local OpenAI-compat URLs", () => {
    expect(buildLocalBaseUrl("ollama", "127.0.0.1", "11434")).toBe("http://127.0.0.1:11434/v1");
    expect(buildLocalBaseUrl("lmstudio", "localhost", "1234")).toBe("http://localhost:1234/v1");
  });
});

describe("parseModelCatalog", () => {
  it("reads OpenAI { data: [] } lists", () => {
    expect(parseModelCatalog({ data: [{ id: "gpt-4.1" }, { id: "gpt-4o-mini", name: "Mini" }] })).toEqual([
      { id: "gpt-4.1", name: "gpt-4.1" },
      { id: "gpt-4o-mini", name: "Mini" },
    ]);
  });

  it("reads Together/Ollama { models: [] } lists", () => {
    expect(parseModelCatalog({ models: [{ name: "llama3.2" }] })[0]?.id).toBe("llama3.2");
  });
});
