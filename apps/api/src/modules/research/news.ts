import { parseRssItems } from "./extract.js";
import { assertSafeFetchUrl } from "./ssrf.js";

const GOOGLE_NEWS = "https://news.google.com/rss/search?q=";

export async function fetchNewsRss(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `${GOOGLE_NEWS}${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  assertSafeFetchUrl(url);
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  return parseRssItems(await res.text(), 8);
}
