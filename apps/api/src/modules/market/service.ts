import { EventEmitter } from "node:events";
import { and, eq } from "drizzle-orm";
import { AppError, money, type InstrumentRef, type Tick } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { candles, instruments, quotesCache, users, watchlistItems, watchlists } from "../../db/schema.js";
import type { Logger } from "../../config/logger.js";
import type { Env } from "../../config/env.js";
import type { KiteGateway } from "../brokers/zerodha/kite-gateway.js";
import type { ZerodhaAuthService } from "../brokers/zerodha/auth-service.js";
import { KiteTicker } from "kiteconnect";
import { collectFnoNames, INDEX_FNO_ORDER, spotRefForUnderlying, underlyingFnoName } from "../forecast/levels.js";

const DEFAULT_WATCH = [
  { exchange: "NSE", symbol: "NIFTY 50", orderable: false },
  { exchange: "NSE", symbol: "RELIANCE", orderable: true },
  { exchange: "NSE", symbol: "HDFCBANK", orderable: true },
  { exchange: "NSE", symbol: "ICICIBANK", orderable: true },
  { exchange: "NSE", symbol: "INFY", orderable: true },
  { exchange: "NSE", symbol: "TCS", orderable: true },
];

export class MarketDataService extends EventEmitter {
  private ticker: InstanceType<typeof KiteTicker> | null = null;
  private lastTick = new Map<string, Tick>();
  private prevPrice = new Map<string, string>();
  private hydrated = new Set<string>();
  private hydrating = new Set<string>();
  private subscribedTokens = new Set<number>();
  private tokenIndex = new Map<string, { id: string; symbol: string; exchange: string }>();
  private lastLtpRestAt = 0;

  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly auth: ZerodhaAuthService,
    private readonly kite: KiteGateway,
    private readonly log: Logger,
  ) {
    super();
    this.setMaxListeners(50);
  }

  async listWatchlist() {
    const [wl] = await this.db.select().from(watchlists).limit(1);
    if (!wl) return DEFAULT_WATCH.map((w) => ({ ...w, autoEnabled: false, lastPrice: null, ageMs: null, source: null }));
    const items = await this.db.select().from(watchlistItems).where(eq(watchlistItems.watchlistId, wl.id));
    const quotes = await this.db.select().from(quotesCache);
    const qmap = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));
    return items.map((item) => {
      const q = qmap.get(`${item.exchange}:${item.symbol}`);
      return {
        exchange: item.exchange,
        symbol: item.symbol,
        orderable: item.orderable,
        autoEnabled: item.autoEnabled,
        lastPrice: q ? String(q.lastPrice) : null,
        bid: q?.bid ? String(q.bid) : null,
        ask: q?.ask ? String(q.ask) : null,
        source: q?.source ?? null,
        receivedAt: q?.receivedAt?.toISOString() ?? null,
        ageMs: q ? Date.now() - q.receivedAt.getTime() : null,
        stale: q ? Date.now() - q.receivedAt.getTime() > this.env.MARKET_DATA_MAX_AGE_MS : true,
      };
    });
  }

  async refreshQuotes(): Promise<void> {
    const access = await this.auth.getAccessToken();
    if (!access) return;
    const [wl] = await this.db.select().from(watchlists).limit(1);
    if (!wl) return;
    const items = await this.db.select().from(watchlistItems).where(eq(watchlistItems.watchlistId, wl.id));
    if (items.length === 0) return;
    const keys = items.map((i) => `${i.exchange}:${i.symbol}`);
    const quotes = await this.kite.getQuote(access.token, keys);
    const now = new Date();
    for (const item of items) {
      const q = quotes[`${item.exchange}:${item.symbol}`];
      if (!q?.last_price) continue;
      const token = String(q.instrument_token ?? `${item.exchange}:${item.symbol}`);
      await this.db
        .insert(instruments)
        .values({
          broker: "zerodha",
          brokerInstrumentToken: token,
          exchange: item.exchange,
          symbol: item.symbol,
          name: item.symbol,
          instrumentType: item.orderable ? "EQUITY" : "INDEX",
          tickSize: "0.05",
          lotSize: 1,
          tradable: item.orderable,
        })
        .onConflictDoUpdate({
          target: [instruments.broker, instruments.brokerInstrumentToken],
          set: { symbol: item.symbol, exchange: item.exchange, updatedAt: now },
        });
      await this.db
        .insert(quotesCache)
        .values({
          exchange: item.exchange,
          symbol: item.symbol,
          lastPrice: money(q.last_price, 4),
          bid: q.depth?.buy?.[0]?.price != null ? money(q.depth.buy[0].price, 4) : null,
          ask: q.depth?.sell?.[0]?.price != null ? money(q.depth.sell[0].price, 4) : null,
          volume: q.volume != null ? String(q.volume) : null,
          source: "LIVE",
          receivedAt: now,
        })
        .onConflictDoUpdate({
          target: [quotesCache.exchange, quotesCache.symbol],
          set: {
            lastPrice: money(q.last_price, 4),
            bid: q.depth?.buy?.[0]?.price != null ? money(q.depth.buy[0].price, 4) : null,
            ask: q.depth?.sell?.[0]?.price != null ? money(q.depth.sell[0].price, 4) : null,
            volume: q.volume != null ? String(q.volume) : null,
            receivedAt: now,
          },
        });
      this.ingestTick({
        instrumentId: `${item.exchange}:${item.symbol}`,
        brokerInstrumentToken: String(q.instrument_token ?? ""),
        symbol: item.symbol,
        exchange: item.exchange,
        lastPrice: money(q.last_price, 4),
        receivedAt: now.toISOString(),
        cumulativeDayVolume: q.volume != null ? String(q.volume) : undefined,
        ohlc: q.ohlc
          ? {
              open: money(q.ohlc.open ?? q.last_price),
              high: money(q.ohlc.high ?? q.last_price),
              low: money(q.ohlc.low ?? q.last_price),
              previousClose: money(q.ohlc.close ?? q.last_price),
            }
          : undefined,
        source: "LIVE",
      });
      void this.ensureHistory(item.exchange, item.symbol, token);
    }
  }

  async addWatchItem(input: { exchange: string; symbol: string; orderable?: boolean }) {
    const exchange = input.exchange.trim().toUpperCase() || "NSE";
    const symbol = input.symbol.trim().toUpperCase();
    if (!symbol) throw new Error("Symbol is required");
    const watchlist = (await this.ensureWatchlist())[0];
    if (!watchlist) throw new AppError("NO_WATCHLIST", "Watchlist is missing.", 500);
    const orderable = input.orderable ?? symbol !== "NIFTY 50";
    await this.db
      .insert(watchlistItems)
      .values({ watchlistId: watchlist.id, exchange, symbol, orderable, sortOrder: Date.now() % 10_000 })
      .onConflictDoNothing();
    await this.refreshQuotes();
    return this.listWatchlist();
  }

  async removeWatchItem(exchange: string, symbol: string) {
    const [wl] = await this.db.select().from(watchlists).limit(1);
    if (!wl) return this.listWatchlist();
    await this.db
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.watchlistId, wl.id),
          eq(watchlistItems.exchange, exchange),
          eq(watchlistItems.symbol, symbol),
        ),
      );
    return this.listWatchlist();
  }

  private async ensureWatchlist() {
    const existing = await this.db.select().from(watchlists).limit(1);
    if (existing[0]) return existing;
    const [user] = await this.db.select().from(users).limit(1);
    if (!user) throw new AppError("NO_OWNER", "Connect Zerodha before editing the watchlist.", 401);
    const [wl] = await this.db.insert(watchlists).values({ userId: user.id, name: "Default" }).returning();
    return [wl!];
  }

  async setAutoEnabled(exchange: string, symbol: string, autoEnabled: boolean) {
    const [wl] = await this.db.select().from(watchlists).limit(1);
    if (!wl) return this.listWatchlist();
    await this.db
      .update(watchlistItems)
      .set({ autoEnabled })
      .where(
        and(
          eq(watchlistItems.watchlistId, wl.id),
          eq(watchlistItems.exchange, exchange),
          eq(watchlistItems.symbol, symbol),
        ),
      );
    return this.listWatchlist();
  }

  async listFnoUnderlyings() {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [rows, cash] = await Promise.all([this.listDerivatives(), this.cashKeys()]);
    const names = collectFnoNames(rows, today, cash);
    if (names.length) return names;
    return INDEX_FNO_ORDER.map((fno) => spotRefForUnderlying(fno));
  }

  async ensureHistoryPublic(exchange: string, symbol: string): Promise<void> {
    const inst = await this.ensureUnderlyingInstrument(exchange, symbol);
    if (!inst) return;
    await this.hydrateIntervals(exchange, symbol, inst.brokerInstrumentToken);
  }

  private async ensureHistory(exchange: string, symbol: string, token: string): Promise<void> {
    await this.hydrateIntervals(exchange, symbol, token);
  }

  private async hydrateIntervals(exchange: string, symbol: string, token: string): Promise<void> {
    const key = `${exchange}:${symbol}`;
    if (this.hydrating.has(key) || !token || Number.isNaN(Number(token))) return;
    this.hydrating.add(key);
    try {
      const [inst] = await this.db
        .select()
        .from(instruments)
        .where(and(eq(instruments.exchange, exchange), eq(instruments.symbol, symbol)))
        .limit(1);
      if (!inst) return;
      const access = await this.auth.getAccessToken();
      if (!access) return;
      const specs = [
        { minutes: 5, kite: "5minute", days: 5, minBars: 20 },
        { minutes: 15, kite: "15minute", days: 12, minBars: 16 },
        { minutes: 60, kite: "60minute", days: 30, minBars: 16 },
        { minutes: 1440, kite: "day", days: 180, minBars: 30 },
      ] as const;
      const to = new Date();
      for (const spec of specs) {
        const existing = await this.db
          .select({ id: candles.id })
          .from(candles)
          .where(and(eq(candles.instrumentId, inst.id), eq(candles.intervalMinutes, spec.minutes)))
          .limit(spec.minBars);
        if (existing.length >= spec.minBars) continue;
        const from = new Date(to.getTime() - spec.days * 24 * 60 * 60 * 1000);
        const rows = await this.kite.getHistoricalData(access.token, token, spec.kite, from, to);
        for (const row of rows) {
          await this.db
            .insert(candles)
            .values({
              instrumentId: inst.id,
              intervalMinutes: spec.minutes,
              bucketStart: new Date(row.date),
              open: money(row.open, 4),
              high: money(row.high, 4),
              low: money(row.low, 4),
              close: money(row.close, 4),
              volume: String(row.volume ?? 0),
              closed: true,
              source: "HISTORICAL",
            })
            .onConflictDoNothing();
        }
        this.log.info({ symbol, interval: spec.kite, count: rows.length }, "hydrated historical candles");
      }
      this.hydrated.add(key);
    } catch (err) {
      this.log.warn({ err, symbol }, "historical hydrate failed");
    } finally {
      this.hydrating.delete(key);
    }
  }

  async freshLtp(exchange: string, symbol: string): Promise<string | null> {
    const key = `${exchange}:${symbol}`;
    const tick = this.lastTick.get(key);
    if (tick?.lastPrice && Date.now() - new Date(tick.receivedAt).getTime() <= 2000) return tick.lastPrice;
    const cached = await this.lastPrice(exchange, symbol);
    const access = await this.auth.getAccessToken();
    if (!access) return cached;
    try {
      const quotes = await this.kite.getLTP(access.token, [key]);
      const px = quotes[key]?.last_price;
      if (px == null) return cached;
      const marked = money(px, 2);
      await this.rememberQuote(exchange, symbol, marked);
      return marked;
    } catch {
      return cached;
    }
  }

  async rememberQuote(exchange: string, symbol: string, lastPrice: string): Promise<void> {
    const key = `${exchange}:${symbol}`;
    const prev = this.lastTick.get(key)?.lastPrice;
    if (prev && prev !== lastPrice) this.prevPrice.set(key, prev);
    const now = new Date();
    await this.db
      .insert(quotesCache)
      .values({
        exchange,
        symbol,
        lastPrice,
        source: "LIVE",
        receivedAt: now,
      })
      .onConflictDoUpdate({
        target: [quotesCache.exchange, quotesCache.symbol],
        set: { lastPrice, receivedAt: now },
      });
    this.lastTick.set(`${exchange}:${symbol}`, {
      instrumentId: `${exchange}:${symbol}`,
      brokerInstrumentToken: "",
      symbol,
      exchange,
      lastPrice,
      receivedAt: now.toISOString(),
      source: "LIVE",
    });
  }

  async listExpiries(symbol: string): Promise<Array<{ date: string; label: string }>> {
    const name = underlyingFnoName(symbol);
    const chain = await this.listDerivatives(name);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const dates = [
      ...new Set(chain.map((row) => row.expiry).filter((expiry): expiry is string => Boolean(expiry && expiry >= today))),
    ].sort();
    return dates.slice(0, 24).map((date) => ({ date, label: expiryLabel(date) }));
  }

  async nearestDerivatives(
    symbol: string,
    spot: number,
    expiryDate?: string | null,
  ): Promise<{
    future: { tradingsymbol: string; expiry: string; lotSize: number } | null;
    call: { tradingsymbol: string; expiry: string; strike: number } | null;
    put: { tradingsymbol: string; expiry: string; strike: number } | null;
    note: string;
  }> {
    const name = underlyingFnoName(symbol);
    const chain = await this.listDerivatives(name);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const futs = chain
      .filter((r) => r.instrumentType === "FUT" && r.expiry)
      .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
    const expiry =
      expiryDate ||
      futs.find((row) => row.expiry && row.expiry >= today)?.expiry ||
      futs[0]?.expiry ||
      null;
    const futureRow = futs.find((row) => row.expiry === expiry) ?? null;
    const future = futureRow
      ? { tradingsymbol: futureRow.tradingsymbol, expiry: futureRow.expiry!, lotSize: futureRow.lotSize }
      : null;
    const opts = chain.filter((r) => (r.instrumentType === "CE" || r.instrumentType === "PE") && r.expiry === expiry);
    const atm = opts.reduce<typeof opts[0] | null>((best, row) => {
      if (!best) return row;
      return Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best;
    }, null);
    const strike = atm?.strike;
    const call = strike != null
      ? opts.find((r) => r.instrumentType === "CE" && r.strike === strike)
      : undefined;
    const put = strike != null
      ? opts.find((r) => r.instrumentType === "PE" && r.strike === strike)
      : undefined;
    return {
      future,
      call: call ? { tradingsymbol: call.tradingsymbol, expiry: call.expiry!, strike: call.strike } : null,
      put: put ? { tradingsymbol: put.tradingsymbol, expiry: put.expiry!, strike: put.strike } : null,
      note: expiry
        ? `Contracts for ${name} until ${expiry}.`
        : `No contracts cached yet for ${name}.`,
    };
  }

  async listOptionChain(symbol: string, expiryDate: string | null, spot: number, width = 7): Promise<{
    expiry: string | null;
    atm: number | null;
    future: { tradingsymbol: string; expiry: string; lotSize: number; token: string; exchange: string } | null;
    rows: Array<{
      strike: number;
      atm: boolean;
      ce: { tradingsymbol: string; token: string; lotSize: number; exchange: string } | null;
      pe: { tradingsymbol: string; token: string; lotSize: number; exchange: string } | null;
    }>;
  }> {
    const name = underlyingFnoName(symbol);
    const chain = await this.listDerivatives(name);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const futs = chain
      .filter((r) => r.instrumentType === "FUT" && r.expiry)
      .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
    const expiry =
      expiryDate ||
      futs.find((row) => row.expiry && row.expiry >= today)?.expiry ||
      chain
        .map((row) => row.expiry)
        .filter((value): value is string => Boolean(value && value >= today))
        .sort()[0] ||
      null;
    const opts = chain.filter((r) => (r.instrumentType === "CE" || r.instrumentType === "PE") && r.expiry === expiry);
    const strikes = [...new Set(opts.map((row) => row.strike).filter((strike) => strike > 0))].sort((a, b) => a - b);
    const atm =
      strikes.reduce<number | null>((best, strike) => {
        if (best == null) return strike;
        return Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best;
      }, null);
    const atmIdx = atm == null ? -1 : strikes.indexOf(atm);
    const window = atmIdx < 0 ? strikes.slice(0, width * 2 + 1) : strikes.slice(Math.max(0, atmIdx - width), atmIdx + width + 1);
    const futureRow = futs.find((row) => row.expiry === expiry) ?? null;
    const persist: NfoRow[] = [];
    const rows = window.map((strike) => {
      const ce = opts.find((row) => row.instrumentType === "CE" && row.strike === strike) ?? null;
      const pe = opts.find((row) => row.instrumentType === "PE" && row.strike === strike) ?? null;
      if (ce) persist.push(ce);
      if (pe) persist.push(pe);
      return {
        strike,
        atm: strike === atm,
        ce: ce ? { tradingsymbol: ce.tradingsymbol, token: ce.token, lotSize: ce.lotSize, exchange: ce.exchange || "NFO" } : null,
        pe: pe ? { tradingsymbol: pe.tradingsymbol, token: pe.token, lotSize: pe.lotSize, exchange: pe.exchange || "NFO" } : null,
      };
    });
    if (futureRow) persist.push(futureRow);
    await this.rememberNfoInstruments(persist);
    this.subscribeTokens(persist.map((row) => row.token));
    const und =
      (await this.ensureUnderlyingInstrument("NSE", symbol)) ??
      (await this.ensureUnderlyingInstrument("BSE", symbol));
    if (und?.brokerInstrumentToken) this.subscribeTokens([und.brokerInstrumentToken]);
    return {
      expiry,
      atm,
      future: futureRow
        ? {
            tradingsymbol: futureRow.tradingsymbol,
            expiry: futureRow.expiry!,
            lotSize: futureRow.lotSize,
            token: futureRow.token,
            exchange: futureRow.exchange || "NFO",
          }
        : null,
      rows,
    };
  }

  async quoteMany(items: Array<{ exchange: string; symbol: string }>): Promise<
    Array<{ exchange: string; symbol: string; lastPrice: string | null; prevPrice: string | null; change: number | null }>
  > {
    const unique = new Map(items.map((item) => [`${item.exchange}:${item.symbol}`, item]));
    const keys = [...unique.keys()];
    const access = await this.auth.getAccessToken();
    const live = new Map<string, number>();
    const stale: string[] = [];
    const now = Date.now();
    for (const key of keys) {
      const tick = this.lastTick.get(key);
      const age = tick ? now - new Date(tick.receivedAt).getTime() : Number.POSITIVE_INFINITY;
      if (tick?.lastPrice && age <= 2000) live.set(key, Number(tick.lastPrice));
      else stale.push(key);
    }
    if (access && stale.length && now - this.lastLtpRestAt >= 1000) {
      this.lastLtpRestAt = now;
      for (let i = 0; i < stale.length; i += 40) {
        const chunk = stale.slice(i, i + 40);
        try {
          const quotes = await this.kite.getLTP(access.token, chunk);
          for (const key of chunk) {
            const px = quotes[key]?.last_price;
            if (px != null) live.set(key, px);
          }
        } catch (err) {
          this.log.warn({ err, count: chunk.length }, "batch LTP failed");
        }
      }
    }
    const out = [];
    for (const [key, item] of unique) {
      const prev = this.lastTick.get(key)?.lastPrice ?? this.prevPrice.get(key) ?? (await this.lastPrice(item.exchange, item.symbol));
      const livePx = live.get(key);
      const lastPrice = livePx != null ? money(livePx, 2) : prev;
      if (livePx != null) await this.rememberQuote(item.exchange, item.symbol, lastPrice!);
      const change =
        lastPrice != null && prev != null && Number(prev) > 0 ? Number(((Number(lastPrice) - Number(prev)) / Number(prev)).toFixed(4)) : null;
      out.push({ exchange: item.exchange, symbol: item.symbol, lastPrice, prevPrice: prev ?? null, change });
    }
    return out;
  }

  subscribeTokens(tokens: string[]): void {
    const nums = tokens.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length === 0) return;
    for (const n of nums) this.subscribedTokens.add(n);
    if (!this.ticker) return;
    try {
      this.ticker.subscribe(nums);
      this.ticker.setMode("ltp", nums);
    } catch (err) {
      this.log.warn({ err }, "ticker subscribe failed");
    }
  }

  asQuote(tick: { exchange: string; symbol: string; lastPrice: string; receivedAt?: string }): {
    exchange: string;
    symbol: string;
    lastPrice: string;
    prevPrice: string | null;
    change: number | null;
    receivedAt: string;
  } {
    const key = `${tick.exchange}:${tick.symbol}`;
    const prev = this.prevPrice.get(key) ?? null;
    const last = Number(tick.lastPrice);
    const prevN = prev != null ? Number(prev) : NaN;
    return {
      exchange: tick.exchange,
      symbol: tick.symbol,
      lastPrice: tick.lastPrice,
      prevPrice: prev,
      change: Number.isFinite(prevN) && prevN > 0 ? Number(((last - prevN) / prevN).toFixed(4)) : null,
      receivedAt: tick.receivedAt ?? new Date().toISOString(),
    };
  }

  private async rememberNfoInstruments(rows: NfoRow[]): Promise<void> {
    const now = new Date();
    for (const row of rows) {
      if (!row.token) continue;
      const type = row.instrumentType === "FUT" ? "FUTURE" : "OPTION";
      this.tokenIndex.set(row.token, {
        id: `${row.exchange || "NFO"}:${row.tradingsymbol}`,
        symbol: row.tradingsymbol,
        exchange: row.exchange || "NFO",
      });
      await this.db
        .insert(instruments)
        .values({
          broker: "zerodha",
          brokerInstrumentToken: row.token,
          exchange: row.exchange || "NFO",
          symbol: row.tradingsymbol,
          name: row.name,
          instrumentType: type,
          tickSize: "0.05",
          lotSize: row.lotSize || 1,
          tradable: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [instruments.broker, instruments.brokerInstrumentToken],
          set: { symbol: row.tradingsymbol, exchange: row.exchange || "NFO", updatedAt: now },
        });
    }
  }

  private nfoCache: { at: number; rows: NfoRow[] } | null = null;
  private cashCache: { at: number; keys: Set<string>; tokens: Map<string, { token: string; type: string }> } | null = null;

  private async listDerivatives(name?: string): Promise<NfoRow[]> {
    if (!this.nfoCache || Date.now() - this.nfoCache.at > 6 * 60 * 60 * 1000) {
      const access = await this.auth.getAccessToken();
      if (!access) return this.nfoCache?.rows ?? [];
      try {
        const nfo = parseNfo(await this.kite.getInstruments(access.token, "NFO"));
        let bfo: NfoRow[] = [];
        try {
          bfo = parseNfo(await this.kite.getInstruments(access.token, "BFO"));
        } catch (err) {
          this.log.warn({ err }, "BFO instrument download failed");
        }
        this.nfoCache = { at: Date.now(), rows: [...nfo, ...bfo] };
        this.log.info({ nfo: nfo.length, bfo: bfo.length }, "cached F&O instruments");
      } catch (err) {
        this.log.warn({ err }, "NFO instrument download failed");
        if (!this.nfoCache) return [];
      }
    }
    const rows = this.nfoCache?.rows ?? [];
    return name ? rows.filter((r) => r.name === name) : rows;
  }

  private async cashKeys(): Promise<Set<string>> {
    await this.ensureCashCache();
    return this.cashCache?.keys ?? new Set();
  }

  private async ensureCashCache(): Promise<void> {
    if (this.cashCache && Date.now() - this.cashCache.at <= 6 * 60 * 60 * 1000) return;
    const access = await this.auth.getAccessToken();
    if (!access) return;
    const keys = new Set<string>();
    const tokens = new Map<string, { token: string; type: string }>();
    for (const exchange of ["NSE", "BSE"] as const) {
      try {
        const raw = await this.kite.getInstruments(access.token, exchange);
        for (const item of raw) {
          const row = item as Record<string, unknown>;
          const symbol = String(row.tradingsymbol ?? "");
          const token = String(row.instrument_token ?? "");
          const type = String(row.instrument_type ?? "");
          if (!symbol || !token) continue;
          const keep = type === "EQ" || type === "INDEX" || type === "BE" || symbol === "SENSEX" || symbol === "BANKEX";
          if (!keep) continue;
          const key = `${exchange}:${symbol}`;
          keys.add(key);
          tokens.set(key, { token, type: type === "INDEX" ? "INDEX" : "EQUITY" });
        }
      } catch (err) {
        this.log.warn({ err, exchange }, "cash instrument download failed");
      }
    }
    if (keys.size) this.cashCache = { at: Date.now(), keys, tokens };
  }

  private async ensureUnderlyingInstrument(exchange: string, symbol: string) {
    const [existing] = await this.db
      .select()
      .from(instruments)
      .where(and(eq(instruments.exchange, exchange), eq(instruments.symbol, symbol)))
      .limit(1);
    if (existing) {
      if (existing.brokerInstrumentToken) {
        this.tokenIndex.set(existing.brokerInstrumentToken, {
          id: existing.id,
          symbol: existing.symbol,
          exchange: existing.exchange,
        });
      }
      return existing;
    }
    await this.ensureCashCache();
    const key = `${exchange}:${symbol}`;
    let token = this.cashCache?.tokens.get(key)?.token;
    let type = this.cashCache?.tokens.get(key)?.type ?? (spotRefForUnderlying(symbol).kind === "INDEX" ? "INDEX" : "EQUITY");
    if (!token) {
      const access = await this.auth.getAccessToken();
      if (!access) return null;
      try {
        const quotes = await this.kite.getLTP(access.token, [key]);
        const hit = quotes[key];
        if (hit?.instrument_token) token = String(hit.instrument_token);
      } catch {
        /* quote lookup failed */
      }
    }
    if (!token) return null;
    const now = new Date();
    const [saved] = await this.db
      .insert(instruments)
      .values({
        broker: "zerodha",
        brokerInstrumentToken: token,
        exchange,
        symbol,
        name: symbol,
        instrumentType: type,
        tickSize: "0.05",
        lotSize: 1,
        tradable: type === "EQUITY",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [instruments.broker, instruments.brokerInstrumentToken],
        set: { symbol, exchange, updatedAt: now },
      })
      .returning();
    if (saved) this.tokenIndex.set(token, { id: saved.id, symbol: saved.symbol, exchange: saved.exchange });
    return saved ?? null;
  }

  ingestTick(tick: Tick): void {
    const key = `${tick.exchange}:${tick.symbol}`;
    const prev = this.lastTick.get(key)?.lastPrice;
    if (prev && prev !== tick.lastPrice) this.prevPrice.set(key, prev);
    this.lastTick.set(key, tick);
    this.emit("tick", tick);
    void this.applyCandles(tick).catch((err) => this.log.warn({ err }, "candle ingest failed"));
  }

  getLastTick(ref: InstrumentRef): Tick | undefined {
    return this.lastTick.get(`${ref.exchange}:${ref.symbol}`);
  }

  async lastPrice(exchange: string, symbol: string): Promise<string | null> {
    const tick = this.lastTick.get(`${exchange}:${symbol}`);
    if (tick?.lastPrice) return tick.lastPrice;
    const [row] = await this.db
      .select()
      .from(quotesCache)
      .where(and(eq(quotesCache.exchange, exchange), eq(quotesCache.symbol, symbol)))
      .limit(1);
    return row ? String(row.lastPrice) : null;
  }

  async listCandles(exchange: string, symbol: string, intervalMinutes = 5, limit = 120) {
    const [inst] = await this.db
      .select()
      .from(instruments)
      .where(and(eq(instruments.exchange, exchange), eq(instruments.symbol, symbol)))
      .limit(1);
    if (!inst) return [];
    const rows = await this.db
      .select()
      .from(candles)
      .where(and(eq(candles.instrumentId, inst.id), eq(candles.intervalMinutes, intervalMinutes)))
      .orderBy(candles.bucketStart);
    return rows.slice(-limit).map((c) => ({
      time: Math.floor(c.bucketStart.getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0),
    })).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1]?.time);
  }

  isFresh(ref: InstrumentRef): boolean {
    const tick = this.getLastTick(ref);
    if (!tick) return false;
    return Date.now() - new Date(tick.receivedAt).getTime() <= this.env.MARKET_DATA_MAX_AGE_MS;
  }

  async connectStream(): Promise<void> {
    const access = await this.auth.getAccessToken();
    if (!access || !this.env.KITE_API_KEY) return;
    if (this.ticker) return;
    try {
      const ticker = new KiteTicker({
        api_key: this.env.KITE_API_KEY,
        access_token: access.token,
      });
      ticker.on("connect", () => {
        const all = [...this.subscribedTokens];
        this.log.info({ tokens: all.length }, "kite ticker connected");
        if (all.length) {
          try {
            ticker.subscribe(all);
            ticker.setMode("ltp", all);
          } catch (err) {
            this.log.warn({ err }, "ticker resubscribe failed");
          }
        }
        void this.subscribeWatchlist().catch((err) => this.log.warn({ err }, "watchlist subscribe failed"));
      });
      ticker.on("ticks", (ticks: Array<Record<string, unknown>>) => {
        for (const raw of ticks) {
          const token = String(raw.instrument_token ?? "");
          const lastPrice = Number(raw.last_price ?? 0);
          if (!lastPrice) continue;
          void this.resolveToken(token).then((inst) => {
            if (!inst) return;
            this.ingestTick({
              instrumentId: inst.id,
              brokerInstrumentToken: token,
              symbol: inst.symbol,
              exchange: inst.exchange,
              lastPrice: money(lastPrice, 4),
              receivedAt: new Date().toISOString(),
              cumulativeDayVolume: raw.volume != null ? String(raw.volume) : undefined,
              source: "LIVE",
            });
          });
        }
      });
      ticker.on("error", (err: unknown) => this.log.warn({ err }, "kite ticker error"));
      ticker.on("close", () => {
        this.ticker = null;
        this.log.warn("kite ticker closed");
      });
      ticker.connect();
      this.ticker = ticker;
      this.log.info("Kite ticker connecting");
    } catch (error) {
      this.log.warn({ err: error }, "failed to start kite ticker");
    }
  }

  async disconnectStream(): Promise<void> {
    try {
      this.ticker?.disconnect();
    } catch {
      /* ignore */
    }
    this.ticker = null;
  }

  private async subscribeWatchlist(): Promise<void> {
    const items = await this.listWatchlist();
    for (const item of items) {
      const inst = await this.ensureUnderlyingInstrument(item.exchange, item.symbol);
      if (inst?.brokerInstrumentToken) this.subscribeTokens([inst.brokerInstrumentToken]);
    }
  }

  private async resolveToken(token: string) {
    const cached = this.tokenIndex.get(token);
    if (cached) return cached;
    const [row] = await this.db
      .select()
      .from(instruments)
      .where(eq(instruments.brokerInstrumentToken, token))
      .limit(1);
    if (row) this.tokenIndex.set(token, { id: row.id, symbol: row.symbol, exchange: row.exchange });
    return row ?? null;
  }

  private async applyCandles(tick: Tick): Promise<void> {
    const [inst] = await this.db
      .select()
      .from(instruments)
      .where(and(eq(instruments.exchange, tick.exchange), eq(instruments.symbol, tick.symbol)))
      .limit(1);
    if (!inst) return;
    for (const minutes of [1, 5, 15]) {
      const bucket = bucketStart(new Date(tick.receivedAt), minutes);
      const price = tick.lastPrice;
      const existing = await this.db
        .select()
        .from(candles)
        .where(
          and(
            eq(candles.instrumentId, inst.id),
            eq(candles.intervalMinutes, minutes),
            eq(candles.bucketStart, bucket),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const row = existing[0];
        const high = Number(row.high) > Number(price) ? row.high : price;
        const low = Number(row.low) < Number(price) ? row.low : price;
        await this.db
          .update(candles)
          .set({ high, low, close: price })
          .where(eq(candles.id, row.id));
      } else {
        await this.db.insert(candles).values({
          instrumentId: inst.id,
          intervalMinutes: minutes,
          bucketStart: bucket,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.cumulativeDayVolume ?? "0",
          closed: false,
          source: tick.source,
        });
      }
    }
  }
}

function expiryLabel(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function bucketStart(date: Date, minutes: number): Date {
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

type NfoRow = {
  tradingsymbol: string;
  name: string;
  expiry: string | null;
  strike: number;
  instrumentType: string;
  lotSize: number;
  token: string;
  exchange: string;
};

function parseNfo(raw: unknown[]): NfoRow[] {
  const out: NfoRow[] = [];
  for (const item of raw) {
    const row = item as Record<string, unknown>;
    const tradingsymbol = String(row.tradingsymbol ?? "");
    const name = String(row.name ?? "");
    if (!tradingsymbol || !name) continue;
    const expiryRaw = row.expiry;
    let expiry: string | null = null;
    if (expiryRaw instanceof Date) expiry = expiryRaw.toISOString().slice(0, 10);
    else if (typeof expiryRaw === "string" && expiryRaw) expiry = expiryRaw.slice(0, 10);
    out.push({
      tradingsymbol,
      name,
      expiry,
      strike: Number(row.strike ?? 0),
      instrumentType: String(row.instrument_type ?? ""),
      lotSize: Number(row.lot_size ?? 1),
      token: String(row.instrument_token ?? ""),
      exchange: String(row.exchange ?? "NFO"),
    });
  }
  return out;
}
