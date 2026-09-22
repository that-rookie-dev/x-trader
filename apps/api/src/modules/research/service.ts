import { desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { researchSnapshots } from "../../db/schema.js";
import { duckDuckGoSearch, type SearchResult } from "./duckduckgo.js";
import { fetchNewsRss } from "./news.js";
import { scrapePage, type ScrapedPage } from "./scrape.js";

const TTL_MS = 15 * 60 * 1000;

export interface ResearchPack {
  query: string;
  searchedAt: string;
  newsScore: number;
  headlines: Array<{ title: string; url: string; snippet: string }>;
  pages: ScrapedPage[];
  summary: string;
}

const BULL = /\b(rally|surge|upgrade|profit|beat|buy|bullish|record|growth|outperform)\b/i;
const BEAR = /\b(fall|crash|downgrade|loss|miss|sell|bearish|probe|fraud|weak|slump)\b/i;

export function newsScoreFromText(text: string): number {
  const bull = (text.match(new RegExp(BULL, "gi")) ?? []).length;
  const bear = (text.match(new RegExp(BEAR, "gi")) ?? []).length;
  if (bull + bear === 0) return 0;
  return (bull - bear) / (bull + bear);
}

export class ResearchService {
  constructor(private readonly db: Database) {}

  async study(symbol: string, extraQuery = ""): Promise<ResearchPack> {
    const query = `${symbol} NSE stock news India ${extraQuery}`.trim();
    const cached = await this.readCache(query);
    if (cached) return cached;

    let search: SearchResult[] = [];
    let news: Array<{ title: string; url: string; snippet: string }> = [];
    try {
      search = await duckDuckGoSearch(query);
    } catch {
      search = [];
    }
    try {
      news = await fetchNewsRss(`${symbol} stock`);
    } catch {
      news = [];
    }

    const urls = [...news, ...search]
      .map((r) => r.url)
      .filter((u) => /^https?:/i.test(u) && !/duckduckgo\.com|google\.com\/search/i.test(u));
    const unique = [...new Set(urls)].slice(0, 3);
    const pages: ScrapedPage[] = [];
    for (const url of unique) {
      const page = await scrapePage(url);
      if (page?.text) pages.push(page);
    }

    const headlines = [
      ...news.slice(0, 6),
      ...search.slice(0, 4).map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })),
    ].slice(0, 8);
    const blob = [...headlines.map((h) => `${h.title} ${h.snippet}`), ...pages.map((p) => p.text)].join(" ");
    const score = newsScoreFromText(blob);
    const summary =
      headlines.length === 0 && pages.length === 0
        ? "No public news/search hits in this cycle."
        : headlines
            .slice(0, 4)
            .map((h) => h.title)
            .join(" · ");

    const pack: ResearchPack = {
      query,
      searchedAt: new Date().toISOString(),
      newsScore: score,
      headlines,
      pages: pages.map((p) => ({ ...p, text: p.text.slice(0, 1200) })),
      summary,
    };
    await this.writeCache(query, pack);
    return pack;
  }

  private async readCache(query: string): Promise<ResearchPack | null> {
    const [row] = await this.db
      .select()
      .from(researchSnapshots)
      .where(eq(researchSnapshots.query, query))
      .orderBy(desc(researchSnapshots.createdAt))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > TTL_MS) return null;
    return row.payload as unknown as ResearchPack;
  }

  private async writeCache(query: string, payload: ResearchPack): Promise<void> {
    await this.db.insert(researchSnapshots).values({ query, payload: payload as unknown as Record<string, unknown> });
  }
}
