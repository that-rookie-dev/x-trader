/** DuckDuckGo HTML/Lite search ported from Agent-X (no API key). */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "html" | "lite";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function decodeDdgRedirect(href: string): string {
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(absolute);
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return absolute;
  } catch {
    return href;
  }
}

function extractResultsFromHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 8) {
    const href = decodeEntities(decodeDdgRedirect(m[1] ?? ""));
    const title = decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    if (!href.startsWith("http") || seen.has(href) || !title) continue;
    seen.add(href);
    const snippetMatch = html.slice(m.index, m.index + 2500).match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|td|div)>/i);
    const snippet = decodeEntities((snippetMatch?.[1] ?? "").replace(/<[^>]+>/g, "")).trim();
    results.push({ title, url: href, snippet, source: "html" });
  }
  return results;
}

function extractResultsFromLite(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 8) {
    const href = decodeEntities(decodeDdgRedirect(m[1] ?? ""));
    const title = decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    if (!href.startsWith("http") || seen.has(href) || !title) continue;
    if (/duckduckgo\.com/i.test(href)) continue;
    seen.add(href);
    results.push({ title, url: href, snippet: "", source: "lite" });
  }
  return results;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; xTrader/1.0; +https://xtrader.local)",
      Accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return res.text();
}

export async function duckDuckGoSearch(query: string): Promise<SearchResult[]> {
  const q = encodeURIComponent(query);
  try {
    const html = await fetchText(`https://html.duckduckgo.com/html/?q=${q}`);
    const htmlResults = extractResultsFromHtml(html);
    if (htmlResults.length) return htmlResults;
  } catch {
    /* fall through to lite */
  }
  const lite = await fetchText(`https://lite.duckduckgo.com/lite/?q=${q}`);
  return extractResultsFromLite(lite);
}

export { extractResultsFromHtml, extractResultsFromLite };
