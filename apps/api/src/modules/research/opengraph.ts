import { assertSafeFetchUrl, canonicalizeUrl, extractDomain } from "./ssrf.js";

export interface LinkPreview {
  url: string;
  site: string;
  title: string;
  description: string;
  image: string;
}

const cache = new Map<string, { at: number; card: LinkPreview | null }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function linkPreview(raw: string): Promise<LinkPreview | null> {
  let canonical: string;
  try {
    canonical = canonicalizeUrl(raw);
    assertSafeFetchUrl(canonical);
  } catch {
    return null;
  }
  const hit = cache.get(canonical);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.card;
  const card = await fetchPreview(canonical);
  cache.set(canonical, { at: Date.now(), card });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return card;
}

async function fetchPreview(canonical: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(canonical, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; xTrader/1.0; +https://xtrader.local)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const finalUrl = res.url || canonical;
    try {
      assertSafeFetchUrl(finalUrl);
    } catch {
      return null;
    }
    const html = (await res.text()).slice(0, 180_000);
    const title = meta(html, "og:title") || meta(html, "twitter:title") || tag(html, "title");
    const description = meta(html, "og:description") || meta(html, "twitter:description") || meta(html, "description");
    const image = abs(finalUrl, meta(html, "og:image") || meta(html, "twitter:image"));
    const site = meta(html, "og:site_name") || extractDomain(finalUrl);
    if (!title && !description && !image) return null;
    return { url: finalUrl, site, title, description, image };
  } catch {
    return null;
  }
}

function meta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern);
    if (found?.[1]) return decode(found[1]).trim();
  }
  return "";
}

function tag(html: string, name: string): string {
  const found = html.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"));
  return found?.[1] ? decode(found[1]).trim() : "";
}

function abs(base: string, value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, base).toString();
    assertSafeFetchUrl(url);
    return url;
  } catch {
    return "";
  }
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
