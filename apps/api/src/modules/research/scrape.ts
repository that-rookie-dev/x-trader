import { htmlToText } from "./extract.js";
import { assertSafeFetchUrl, canonicalizeUrl, extractDomain } from "./ssrf.js";

export interface ScrapedPage {
  url: string;
  domain: string;
  text: string;
}

export async function scrapePage(url: string): Promise<ScrapedPage | null> {
  try {
    const canonical = canonicalizeUrl(url);
    assertSafeFetchUrl(canonical);
    const res = await fetch(canonical, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; xTrader/1.0; +https://xtrader.local)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const finalUrl = res.url || canonical;
    if (!finalUrl.startsWith("http")) return null;
    try {
      assertSafeFetchUrl(finalUrl);
    } catch {
      return null;
    }
    const html = await res.text();
    return { url: finalUrl, domain: extractDomain(finalUrl), text: htmlToText(html) };
  } catch {
    return null;
  }
}
