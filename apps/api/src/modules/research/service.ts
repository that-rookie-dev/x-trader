import { and, desc, eq, lt } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { newsDeltas, newsTape, researchSnapshots } from "../../db/schema.js";
import type { AiService } from "../ai/service.js";
import { duckDuckGoSearch, type SearchResult } from "./duckduckgo.js";
import { fetchNewsRss } from "./news.js";
import { scrapePage, type ScrapedPage } from "./scrape.js";

const NEWS_SLOT_MS = 15 * 60 * 1000;

/** Same shift for Algo and AI: a full score moves the close by 0.15% of spot, capped at 0.4%. */
export function newsPointsFromScore(score: number, last: number): number {
  if (!(last > 0) || !Number.isFinite(score)) return 0;
  const capped = Math.max(-1, Math.min(1, score));
  const points = capped * last * 0.0015;
  const limit = last * 0.004;
  return Math.max(-limit, Math.min(limit, points));
}

export interface ResearchPack {
  query: string;
  searchedAt: string;
  newsScore: number;
  headlines: Array<{ title: string; url: string; snippet: string; note?: string; image?: string }>;
  pages: ScrapedPage[];
  summary: string;
}

const GATHER_AT_ONCE = 3;

type WatchItem = { exchange: string; symbol: string; last: number };
type Gathered = WatchItem & { headlines: ResearchPack["headlines"]; pages: ScrapedPage[] };

export type NewsPhase = "idle" | "scraping" | "reading" | "scoring";

export class ResearchService {
  private running = false;
  private phase: NewsPhase = "idle";
  private phaseSymbol = "";
  private worldSlot = -1;
  private worldHeadlines: ResearchPack["headlines"] = [];

  constructor(
    private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  /**
   * One background pass per 15-minute slot. Fetches a few symbols at a time, then asks the model
   * for one symbol at a time so a long watchlist cannot stampede the provider or stall the desk.
   */
  async runBackground(items: WatchItem[]): Promise<number> {
    if (this.running || items.length === 0) return 0;
    if (!(await this.ai.modelReady())) return 0;
    const slotStart = Math.floor(Date.now() / NEWS_SLOT_MS) * NEWS_SLOT_MS;
    const due = await this.dueItems(items, slotStart);
    if (due.length === 0) return 0;
    this.running = true;
    this.phase = "scraping";
    this.phaseSymbol = due[0]?.symbol ?? "";
    try {
      await this.worldForSlot(slotStart);
      const gathered: Gathered[] = [];
      await this.pool(due, GATHER_AT_ONCE, async (item) => {
        this.phase = "scraping";
        this.phaseSymbol = item.symbol;
        const sources = await this.gather(item.symbol, slotStart);
        this.phase = "reading";
        gathered.push({ ...item, ...sources });
      });
      let saved = 0;
      for (const item of gathered) {
        this.phase = "scoring";
        this.phaseSymbol = item.symbol;
        const analysed =
          item.headlines.length === 0 && item.pages.length === 0
            ? { ok: true as const, newsScore: 0, summary: "No headlines this slot.", notes: [] }
            : await this.ai.analyzeNews({ symbol: item.symbol, headlines: item.headlines, pages: item.pages });
        if (!analysed.ok) break;
        const points = newsPointsFromScore(analysed.newsScore, item.last);
        const headlines = item.headlines.map((headline, index) => ({
          ...headline,
          note: analysed.notes.find((note) => note.index === index)?.line.trim() ?? "",
        }));
        await this.writeDelta(item, analysed.newsScore, points, analysed.summary);
        await this.saveTape({
          exchange: item.exchange,
          symbol: item.symbol,
          slotStart: new Date(slotStart),
          score: analysed.newsScore,
          points,
          summary: analysed.summary,
          headlines,
        });
        saved += 1;
      }
      return saved;
    } finally {
      this.running = false;
      this.phase = "idle";
      this.phaseSymbol = "";
    }
  }

  workStatus(): { running: boolean; phase: NewsPhase; symbol: string } {
    return { running: this.running, phase: this.phase, symbol: this.phaseSymbol };
  }

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
    const trimmedPages = pages.map((p) => ({ ...p, text: p.text.slice(0, 1200) }));
    const analysed = await this.ai.analyzeNews({ symbol, headlines, pages: trimmedPages });
    const pack: ResearchPack = {
      query,
      searchedAt: new Date().toISOString(),
      newsScore: analysed.ok ? analysed.newsScore : 0,
      headlines,
      pages: trimmedPages,
      summary: analysed.summary,
    };
    if (!analysed.ok) return pack;
    await this.writeCache(query, pack);
    return pack;
  }

  async read(exchange: string, symbol: string): Promise<{ score: number; points: number; summary: string; updatedAt: string } | null> {
    const [row] = await this.db
      .select()
      .from(newsDeltas)
      .where(and(eq(newsDeltas.exchange, exchange.toUpperCase()), eq(newsDeltas.symbol, symbol.toUpperCase())))
      .limit(1);
    if (!row) return null;
    return {
      score: Number(row.score),
      points: Number(row.points),
      summary: row.summary,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async tape(exchange: string, symbol: string) {
    const rows = await this.db
      .select()
      .from(newsTape)
      .where(and(eq(newsTape.exchange, exchange.toUpperCase()), eq(newsTape.symbol, symbol.toUpperCase())))
      .orderBy(desc(newsTape.slotStart))
      .limit(48);
    return rows.map((row) => ({
      at: row.slotStart.toISOString(),
      score: Number(row.score),
      points: Number(row.points),
      summary: row.summary,
      headlines: row.headlines ?? [],
    }));
  }

  private async saveTape(input: {
    exchange: string;
    symbol: string;
    slotStart: Date;
    score: number;
    points: number;
    summary: string;
    headlines: ResearchPack["headlines"];
  }) {
    const exchange = input.exchange.toUpperCase();
    const symbol = input.symbol.toUpperCase();
    await this.db
      .insert(newsTape)
      .values({
        exchange,
        symbol,
        slotStart: input.slotStart,
        score: String(input.score),
        points: String(input.points),
        summary: input.summary,
        headlines: input.headlines.slice(0, 8),
      })
      .onConflictDoUpdate({
        target: [newsTape.exchange, newsTape.symbol, newsTape.slotStart],
        set: {
          score: String(input.score),
          points: String(input.points),
          summary: input.summary,
          headlines: input.headlines.slice(0, 8),
        },
      });
    const keep = new Date(input.slotStart.getTime() - 48 * NEWS_SLOT_MS);
    await this.db.delete(newsTape).where(and(eq(newsTape.exchange, exchange), eq(newsTape.symbol, symbol), lt(newsTape.slotStart, keep)));
  }

  private async dueItems(items: WatchItem[], slotStart: number): Promise<WatchItem[]> {
    const rows = await this.db.select().from(newsDeltas);
    const fresh = new Map(rows.map((row) => [`${row.exchange}:${row.symbol}`, row.updatedAt.getTime()]));
    return items.filter((item) => {
      const at = fresh.get(`${item.exchange.toUpperCase()}:${item.symbol.toUpperCase()}`);
      return at == null || at < slotStart;
    });
  }

  private async gather(symbol: string, slotStart: number): Promise<Pick<Gathered, "headlines" | "pages">> {
    const world = await this.worldForSlot(slotStart);
    let news: Array<{ title: string; url: string; snippet: string }> = [];
    let search: SearchResult[] = [];
    try {
      news = await fetchNewsRss(`${symbol} stock India`);
    } catch {
      news = [];
    }
    try {
      search = await duckDuckGoSearch(`${symbol} stock news India`);
    } catch {
      search = [];
    }
    const headlines = [
      ...news,
      ...search.slice(0, 4).map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
      ...world,
    ].filter((item, index, all) => all.findIndex((other) => other.title === item.title) === index).slice(0, 8);
    const page = headlines[0]?.url ? await scrapePage(headlines[0].url) : null;
    const pages = page?.text ? [{ ...page, text: page.text.slice(0, 900) }] : [];
    return { headlines, pages };
  }

  private async worldForSlot(slotStart: number): Promise<ResearchPack["headlines"]> {
    if (this.worldSlot === slotStart) return this.worldHeadlines;
    let search: SearchResult[] = [];
    let news: Array<{ title: string; url: string; snippet: string }> = [];
    try {
      search = await duckDuckGoSearch("India stock market world news");
    } catch {
      search = [];
    }
    try {
      news = await fetchNewsRss("Indian stock market");
    } catch {
      news = [];
    }
    this.worldSlot = slotStart;
    this.worldHeadlines = [
      ...news.slice(0, 4),
      ...search.slice(0, 4).map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
    ].slice(0, 6);
    return this.worldHeadlines;
  }

  private async writeDelta(item: WatchItem, score: number, points: number, summary: string) {
    await this.db
      .insert(newsDeltas)
      .values({
        exchange: item.exchange.toUpperCase(),
        symbol: item.symbol.toUpperCase(),
        score: String(score),
        points: String(points),
        summary,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [newsDeltas.exchange, newsDeltas.symbol],
        set: { score: String(score), points: String(points), summary, updatedAt: new Date() },
      });
  }

  private async pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item == null) continue;
        try {
          await run(item);
        } catch {
          /* one symbol must not stop the slot */
        }
      }
    });
    await Promise.all(workers);
  }

  private async readCache(query: string): Promise<ResearchPack | null> {
    const [row] = await this.db
      .select()
      .from(researchSnapshots)
      .where(eq(researchSnapshots.query, query))
      .orderBy(desc(researchSnapshots.createdAt))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > NEWS_SLOT_MS) return null;
    return row.payload as unknown as ResearchPack;
  }

  private async writeCache(query: string, payload: ResearchPack): Promise<void> {
    await this.db.insert(researchSnapshots).values({ query, payload: payload as unknown as Record<string, unknown> });
  }
}
