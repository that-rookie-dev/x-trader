import { describe, expect, it } from "vitest";
import { extractResultsFromHtml } from "./duckduckgo.js";

describe("DuckDuckGo HTML parser", () => {
  it("extracts result links from Agent-X style markup", () => {
    const html = `
      <a class="result__a" href="https://example.com/reliance">Reliance jumps</a>
      <a class="result__snippet" href="#">Stock rallies on volume</a>
      <a class="result__a" href="https://example.com/nifty">Nifty futures</a>
    `;
    const rows = extractResultsFromHtml(html);
    expect(rows[0]?.url).toBe("https://example.com/reliance");
    expect(rows[0]?.title).toContain("Reliance");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
