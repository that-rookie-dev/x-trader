import { parseRssItems } from "./extract.js";
import { assertSafeFetchUrl } from "./ssrf.js";

const GOOGLE_NEWS = "https://news.google.com/rss/search?q=";
const BING_NEWS = "https://www.bing.com/news/search?q=";

export async function fetchNewsRss(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const feeds = [
    `${GOOGLE_NEWS}${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
    `${BING_NEWS}${encodeURIComponent(query)}&format=rss`,
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol(query))}&region=IN&lang=en-IN`,
  ];
  const batches = await Promise.all(feeds.map((url) => readFeed(url)));
  const seen = new Set<string>();
  const items: Array<{ title: string; url: string; snippet: string }> = [];
  for (const batch of batches) {
    for (const item of batch) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 8) return items;
    }
  }
  return items;
}

function yahooSymbol(query: string): string {
  const symbol = query.replace(/\s+stock$/i, "").trim().toUpperCase();
  if (symbol.includes(" ") || symbol.endsWith(".NS") || symbol.endsWith(".BO")) return symbol;
  return `${symbol}.NS`;
}

async function readFeed(url: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    assertSafeFetchUrl(url);
    const res = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), 6);
  } catch {
    return [];
  }
}
