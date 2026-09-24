import { parseRssItems } from "./extract.js";
import { assertSafeFetchUrl } from "./ssrf.js";

const GOOGLE_NEWS = "https://news.google.com/rss/search?q=";
const BING_NEWS = "https://www.bing.com/news/search?q=";

export type NewsItem = { title: string; url: string; snippet: string; image?: string; source?: string; sourceUrl?: string };

const AGGREGATORS = /google|bing\.com|yahoo\.com|duckduckgo/i;

export function publisherKey(item: { url: string; source?: string; sourceUrl?: string }): string {
  const named = (item.source ?? "").trim().toLowerCase();
  const fromSource = hostOf(item.sourceUrl ?? "");
  if (fromSource && !AGGREGATORS.test(fromSource)) return fromSource;
  if (named && !AGGREGATORS.test(named)) return named;
  const fromLink = hostOf(item.url);
  if (fromLink && !AGGREGATORS.test(fromLink)) return fromLink;
  return named || fromLink || "other";
}

export function publisherLabel(item: { url: string; source?: string; sourceUrl?: string }): string {
  const named = (item.source ?? "").trim();
  if (named && !AGGREGATORS.test(named)) return named;
  const fromSource = hostOf(item.sourceUrl ?? "");
  if (fromSource && !AGGREGATORS.test(fromSource)) return fromSource.replace(/^www\./, "");
  const fromLink = hostOf(item.url);
  return (fromLink || "source").replace(/^www\./, "");
}

/** At most `perSite` stories from one publisher, rotating so one feed cannot fill the list. */
export function pickDiverse<T extends { title: string; url: string; source?: string; sourceUrl?: string }>(
  items: T[],
  limit = 8,
  perSite = 3,
): T[] {
  const seen = new Set<string>();
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const site = publisherKey(item);
    const list = groups.get(site) ?? [];
    list.push(item);
    groups.set(site, list);
  }
  const keys = [...groups.keys()];
  const counts = new Map<string, number>();
  const out: T[] = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const key of keys) {
      if ((counts.get(key) ?? 0) >= perSite) continue;
      const next = groups.get(key)?.shift();
      if (!next) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      out.push(next);
      added = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export async function fetchNewsRss(query: string): Promise<NewsItem[]> {
  const feeds = [
    `${GOOGLE_NEWS}${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
    `${BING_NEWS}${encodeURIComponent(query)}&format=rss`,
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol(query))}&region=IN&lang=en-IN`,
  ];
  const batches = await Promise.all(feeds.map((url) => readFeed(url)));
  return pickDiverse(batches.flat(), 8, 3);
}

function yahooSymbol(query: string): string {
  const symbol = query.replace(/\s+stock$/i, "").trim().toUpperCase();
  if (symbol.includes(" ") || symbol.endsWith(".NS") || symbol.endsWith(".BO")) return symbol;
  return `${symbol}.NS`;
}

async function readFeed(url: string): Promise<NewsItem[]> {
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
