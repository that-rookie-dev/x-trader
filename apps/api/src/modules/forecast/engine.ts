import { and, desc, eq } from "drizzle-orm";
import {
  money,
  type Forecast,
  type InstrumentType,
  type MarketRegime,
} from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { forecasts } from "../../db/schema.js";
import type { MarketDataService } from "../market/service.js";
import type { ResearchService } from "../research/service.js";
import type { AiService } from "../ai/service.js";
import type { RiskService } from "../risk/service.js";
import { rsi, sma } from "../indicators/index.js";
import {
  buildSuggestions,
  isIndexUnderlying,
  periodReturn,
  underlyingFnoName,
} from "./levels.js";
import { applyAiStudy, predictEodSpot } from "./eod.js";
import { buildDeskModel } from "./model.js";

export class ForecastEngine {
  constructor(
    private readonly db: Database,
    private readonly market: MarketDataService,
    private readonly research: ResearchService,
    private readonly ai: AiService,
    private readonly risk: RiskService,
  ) {}

  async latest(): Promise<Array<Forecast & { updatedAt: string; autoEnabled: boolean }>> {
    const watch = await this.market.listWatchlist();
    const rows = await this.db.select().from(forecasts).orderBy(desc(forecasts.createdAt));
    const byKey = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const key = `${row.exchange}:${row.symbol}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }
    return watch.map((w) => {
      const row = byKey.get(`${w.exchange}:${w.symbol}`);
      const payload = (row?.payload ?? null) as unknown as Forecast | null;
      if (payload) {
        return { ...payload, updatedAt: row!.createdAt.toISOString(), autoEnabled: w.autoEnabled };
      }
      return {
        instrument: {
          exchange: w.exchange,
          symbol: w.symbol,
          instrumentType: w.orderable ? "EQUITY" : "INDEX",
        },
        horizon: "SESSION" as const,
        bias: "RANGE" as const,
        regime: "UNKNOWN" as const,
        confidence: 0,
        lastPrice: w.lastPrice ?? "0",
        session: {
          expectedLow: w.lastPrice ?? "0",
          expectedHigh: w.lastPrice ?? "0",
          magnet: w.lastPrice ?? "0",
          invalidation: "Waiting for Zerodha history.",
        },
        path: { until: "n/a", scenario: "No forecast yet.", supports: [], resistances: [] },
        evidence: {
          technical: "Not computed.",
          history: "Hydrate candles from Kite.",
          news: "Research not run.",
        },
        copilotAction: "Open this name after the next study cycle.",
        autoEligible: false,
        suggestions: [],
        updatedAt: new Date(0).toISOString(),
        autoEnabled: w.autoEnabled,
      };
    });
  }

  async refreshOne(
    exchange: string,
    symbol: string,
    mode: "full" | "live" | "study" = "full",
    expiryDate?: string | null,
  ): Promise<Forecast> {
    if (mode === "full") await this.market.ensureHistoryPublic(exchange, symbol);
    const daily = await this.market.listCandles(exchange, symbol, 1440, 260);
    const fifteen = await this.market.listCandles(exchange, symbol, 15, 96);
    const five = await this.market.listCandles(exchange, symbol, 5, 80);
    const series = (daily.length >= 20 ? daily : five).map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    }));
    const closes = series.map((c) => c.close);
    const last = Number((await this.market.freshLtp(exchange, symbol)) ?? closes[closes.length - 1] ?? 0);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, Math.min(50, closes.length));
    const sma200 = sma(closes, 200);
    const rsiVal = rsi(closes, 14);
    const fiveCloses = five.map((c) => c.close);
    const liveRsi = rsi(fiveCloses, 14) ?? rsiVal;
    const stored = await this.getStored(exchange, symbol);
    const research =
      mode === "live" && stored
        ? {
            newsScore: stored.bias === "BULLISH" ? 0.1 : stored.bias === "BEARISH" ? -0.1 : 0,
            headlines: [] as Array<{ title: string; url: string; snippet: string }>,
            summary: stored.evidence.news,
          }
        : await this.research.study(symbol);
    const model = buildDeskModel({
      last: last || 1,
      daily,
      fifteen,
      five,
      newsScore: research.newsScore,
    });
    const bias = model.bias;
    const confidence = model.confidence;
    const regime = model.regime;
    const session = { ...model.session, pull: model.pull };
    const liveBreak =
      last > 0 && last < Number(session.expectedLow) * 0.998
        ? ("DOWN" as const)
        : last > 0 && last > Number(session.expectedHigh) * 1.002
          ? ("UP" as const)
          : null;
    const path = { supports: model.supports, resistances: model.resistances };
    const watch = (await this.market.listWatchlist()).find((w) => w.exchange === exchange && w.symbol === symbol);
    const instrumentType: InstrumentType =
      isIndexUnderlying(symbol) || watch?.orderable === false ? "INDEX" : "EQUITY";
    const deriv = await this.market.nearestDerivatives(symbol, last, expiryDate);
    const expiry = deriv.future?.expiry ?? deriv.call?.expiry ?? null;
    const until = expiry ?? swingUntil();
    const profile = await this.risk.currentProfile().catch(() => null);
    const autoEligible = Boolean(
      confidence >= 0.58 &&
        bias !== "RANGE" &&
        (instrumentType === "EQUITY"
          ? profile?.allowEquity !== false
          : profile?.allowFutures || profile?.allowOptions),
    );

    const callPx = deriv.call ? await this.market.freshLtp("NFO", deriv.call.tradingsymbol) : null;
    const putPx = deriv.put ? await this.market.freshLtp("NFO", deriv.put.tradingsymbol) : null;
    const suggestions = buildSuggestions({
      symbol,
      instrumentType,
      bias,
      confidence,
      last,
      sma20,
      sma50: sma50 ?? null,
      sma200,
      rsi: liveRsi,
      newsScore: research.newsScore,
      ret6m: periodReturn(closes, 126),
      ret12m: periodReturn(closes, 252),
      liveBreak,
      stopUnder: session.invalidation.match(/[\d.]+/)?.[0] ?? session.expectedLow,
      future: deriv.future?.tradingsymbol ?? null,
      call: deriv.call?.tradingsymbol ?? null,
      put: deriv.put?.tradingsymbol ?? null,
      expiry,
      callPx,
      putPx,
    });
    const primary =
      suggestions.find((s) => s.action === "SELL" && s.lane === "FNO") ??
      suggestions.find((s) => s.action === "BUY" && s.primary) ??
      suggestions.find((s) => s.action === "BUY");

    const forecast: Forecast = {
      instrument: { exchange, symbol, instrumentType },
      horizon: expiry ? "EXPIRY" : "SESSION",
      bias,
      regime,
      confidence,
      lastPrice: money(last || 0, 2),
      session,
      path: {
        until,
        scenario: `${model.summary}. S ${model.supports.join("/")} R ${model.resistances.join("/")} VWAP ${model.vwap != null ? money(model.vwap, 2) : "n/a"} CPR ${model.cpr ? money(model.cpr.pivot, 2) : "n/a"}. SMA20 ${sma20 != null ? money(sma20, 2) : "n/a"}; ATR ${money(model.atr, 2)}.`,
        supports: path.supports,
        resistances: path.resistances,
      },
      derivatives: {
        expiry,
        future: deriv.future?.tradingsymbol ?? null,
        call: deriv.call?.tradingsymbol ?? null,
        put: deriv.put?.tradingsymbol ?? null,
        note: deriv.note,
      },
      evidence: {
        technical: model.summary,
        history: `${series.length} bars from Kite (${daily.length} daily, ${fifteen.length} 15m, ${five.length} 5m).`,
        news: research.summary,
      },
      copilotAction: primary
        ? `On Zerodha, search ${primary.contract}. ${primary.action} · ${primary.why}${primary.exit ? ` ${primary.exit}` : ""}`
        : bias === "RANGE"
          ? `Wait for a live break of ${session.expectedLow} / ${session.expectedHigh} on the Zerodha app. Do not chase.`
          : `No buy idea this cycle. ${bias} map only.`,
      autoEligible,
      direction: bias === "BEARISH" ? undefined : bias === "BULLISH" ? "LONG" : undefined,
      suggestions,
    };

    if (mode === "study") {
      const algoEod = predictEodSpot({
        last,
        bias,
        expectedLow: Number(session.expectedLow),
        expectedHigh: Number(session.expectedHigh),
        magnet: Number(session.magnet),
        supports: model.supports.map(Number),
        resistances: model.resistances.map(Number),
        magnets: [model.vwap, model.cpr?.pivot, model.orb?.high, model.orb?.low].filter((n): n is number => n != null),
        pull: model.pull,
      });
      const pack = research as {
        headlines?: Array<{ title: string; snippet?: string }>;
        pages?: Array<{ title?: string; text: string }>;
      };
      const result = await this.ai.studyEod({
        symbol,
        last,
        band: { low: Number(session.expectedLow), high: Number(session.expectedHigh), magnet: Number(session.magnet) },
        levels: {
          supports: model.supports,
          resistances: model.resistances,
          pivot: model.cpr?.pivot ?? null,
          priorHigh: model.cpr?.r1 ?? null,
          priorLow: model.cpr?.s1 ?? null,
          priorClose: model.cpr?.pivot ?? null,
        },
        algo: { bias, close: algoEod.close, confidence, score: model.score, signals: model.signals.map((s) => `${s.name}:${s.vote}`) },
        technical: `${forecast.evidence.technical} ${forecast.path.scenario}`,
        headlines: pack.headlines ?? [],
        pages: pack.pages ?? [],
        atm: deriv.call?.strike ?? deriv.put?.strike ?? null,
      });
      if (result.draft) {
        const priced = applyAiStudy({
          last,
          expectedLow: Number(session.expectedLow),
          expectedHigh: Number(session.expectedHigh),
          magnet: Number(session.magnet),
          direction: result.draft.direction,
          pull: result.draft.pull,
          closeHint: result.draft.closeHint,
        });
        forecast.evidence.aiStudy = {
          studiedAt: new Date().toISOString(),
          direction: result.draft.direction,
          pull: result.draft.pull,
          close: priced.close,
          confidence: result.draft.confidence,
          peStrike: result.draft.direction === "BEARISH" ? (result.draft.peStrike ?? null) : null,
          ceStrike: result.draft.direction === "BULLISH" ? (result.draft.ceStrike ?? null) : null,
          why: result.draft.why,
          catalysts: result.draft.catalysts ?? [],
          skip: result.draft.skip ?? false,
        };
        forecast.evidence.llm = result.draft.why;
        forecast.evidence.aiError = undefined;
        forecast.path.scenario = `${forecast.path.scenario} AI: ${result.draft.why}`.slice(0, 1800);
      } else {
        forecast.evidence.aiStudy = stored?.evidence.aiStudy;
        forecast.evidence.aiError = result.error ?? "Active model did not return a study.";
        forecast.evidence.llm = forecast.evidence.aiError;
      }
    } else if (stored?.evidence) {
      forecast.evidence.llm = stored.evidence.llm;
      forecast.evidence.aiStudy = stored.evidence.aiStudy;
      forecast.evidence.aiError = stored.evidence.aiError;
    }

    await this.db
      .insert(forecasts)
      .values({
        exchange,
        symbol,
        horizon: forecast.horizon,
        bias: forecast.bias,
        confidence: String(forecast.confidence),
        payload: forecast as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [forecasts.exchange, forecasts.symbol, forecasts.horizon],
        set: {
          bias: forecast.bias,
          confidence: String(forecast.confidence),
          payload: forecast as unknown as Record<string, unknown>,
          createdAt: new Date(),
        },
      });
    return forecast;
  }

  async refreshWatchlist(mode: "full" | "live" | "study" = "full"): Promise<Forecast[]> {
    const watch = await this.market.listWatchlist();
    const out: Forecast[] = [];
    for (const item of watch) {
      try {
        out.push(await this.refreshOne(item.exchange, item.symbol, mode));
      } catch {
        /* continue other names */
      }
    }
    return out;
  }

  async getStored(exchange: string, symbol: string): Promise<Forecast | null> {
    const [row] = await this.db
      .select()
      .from(forecasts)
      .where(and(eq(forecasts.exchange, exchange), eq(forecasts.symbol, symbol)))
      .orderBy(desc(forecasts.createdAt))
      .limit(1);
    return row ? (row.payload as unknown as Forecast) : null;
  }
}

function swingUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toISOString().slice(0, 10);
}

export { underlyingFnoName };
