import { sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { normalizeAgentMode, tradeIntentSchema } from "@xtrader/domain";
import { asyncHandler } from "../http/middleware.js";
import type { AppServices } from "../app/context.js";
import {
  friendlyDate,
  loadHeldKeys,
  paperHeldSymbols,
  stanceLine,
  visibleIdeas,
} from "../modules/forecast/desk.js";
import { compareEod, predictEodSpot, viewAiStudy } from "../modules/forecast/eod.js";
import { pickExpiringDesk } from "../modules/forecast/levels.js";
import { buildOptionsBoard } from "../modules/forecast/board.js";

export function registerRoutes(app: Express, s: AppServices): void {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", name: "xTrader", ts: new Date().toISOString() });
  });

  app.get(
    "/api/ready",
    asyncHandler(async (_req, res) => {
      await s.db.execute(sql`select 1`);
      res.json({ ready: true, postgres: true });
    }),
  );

  app.get(
    "/api/bootstrap",
    asyncHandler(async (req, res) => {
      const session = await s.sessions.resolve(req);
      const linked = await s.sessions.instanceLinked();
      const broker = await s.auth.status();
      const settings = await s.gate.snapshot();
      res.json({
        linked,
        authenticated: Boolean(session),
        locked: false,
        needsReconnect: linked && !session,
        broker,
        settings: {
          executionMode: settings.executionMode,
          agentMode: normalizeAgentMode(settings.agentMode),
          haltActive: settings.haltActive,
          liveReady: settings.liveReady,
          liveBlockedReason: settings.liveBlockedReason,
        },
      });
    }),
  );

  app.get(
    "/api/brokers/zerodha/login",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const url = await s.auth.startLogin(res, req.session);
      res.json({ url });
    }),
  );

  app.get(
    "/zerodha/callback",
    asyncHandler(async (req, res) => {
      await s.auth.handleCallback(req.query as Record<string, unknown>, res);
      res.redirect(`${s.env.APP_ORIGIN}/?connected=1`);
    }),
  );

  app.get(
    "/api/brokers/zerodha/status",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      res.json(await s.auth.status());
    }),
  );

  app.post(
    "/api/brokers/zerodha/disconnect",
    s.sessions.middleware("required"),
    asyncHandler(async (req, res) => {
      const result = await s.auth.disconnect(req.session!.userId);
      s.sessions.clearCookie(res);
      res.json(result);
    }),
  );

  const auth = s.sessions.middleware("required");

  app.get(
    "/api/account/profile",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.read.getProfile());
    }),
  );
  app.get(
    "/api/account/funds",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.read.getFunds());
    }),
  );
  app.get(
    "/api/account/holdings",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.read.getHoldings());
    }),
  );
  app.get(
    "/api/account/positions",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.read.getPositions());
    }),
  );

  app.get(
    "/api/market/watchlist",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      res.json(await s.market.listWatchlist());
    }),
  );

  app.post(
    "/api/market/watchlist",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          exchange: z.string().default("NSE"),
          symbol: z.string().min(1),
          orderable: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await s.market.addWatchItem(body));
    }),
  );

  app.post(
    "/api/market/watchlist/remove",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ exchange: z.string(), symbol: z.string() }).parse(req.body);
      res.json(await s.market.removeWatchItem(body.exchange, body.symbol));
    }),
  );

  app.post(
    "/api/market/watchlist/auto",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({ exchange: z.string(), symbol: z.string(), autoEnabled: z.boolean() })
        .parse(req.body);
      res.json(await s.market.setAutoEnabled(body.exchange, body.symbol, body.autoEnabled));
    }),
  );

  app.get(
    "/api/market/candles",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.query.exchange ?? "NSE");
      const symbol = String(req.query.symbol ?? "");
      const interval = Number(req.query.interval ?? 5);
      res.json(await s.market.listCandles(exchange, symbol, interval));
    }),
  );

  app.get(
    "/api/market/stream",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      send("hello", { ok: true });
      const onTick = (tick: { exchange: string; symbol: string; lastPrice: string; receivedAt: string }) =>
        send("tick", s.market.asQuote(tick));
      const onSignal = (row: unknown) => send("signal", row);
      const onPlay = (row: unknown) => send("play", row);
      s.market.on("tick", onTick);
      s.market.on("signal", onSignal);
      s.market.on("play", onPlay);
      const iv = setInterval(() => send("ping", { t: Date.now() }), 1000);
      req.on("close", () => {
        clearInterval(iv);
        s.market.off("tick", onTick);
        s.market.off("signal", onSignal);
        s.market.off("play", onPlay);
      });
    }),
  );

  app.get(
    "/api/paper",
    auth,
    asyncHandler(async (_req, res) => {
      await s.paper.markToMarket();
      res.json(await s.execution.paperState());
    }),
  );

  app.post(
    "/api/paper/orders",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          exchange: z.string().default("NSE"),
          symbol: z.string(),
          side: z.enum(["BUY", "SELL"]),
          quantity: z.number().int().positive(),
          orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
          price: z.string().optional(),
        })
        .parse(req.body);
      const result = await s.execution.paperManual({
        accountId: req.session!.userId,
        ...body,
      });
      res.json(result);
    }),
  );

  app.post(
    "/api/paper/positions/:id/close",
    auth,
    asyncHandler(async (req, res) => {
      res.json(await s.execution.closePaperAndLearn(String(req.params.id ?? ""), "USER"));
    }),
  );

  app.get(
    "/api/risk",
    auth,
    asyncHandler(async (_req, res) => {
      const profile = await s.risk.currentProfile();
      const settings = await s.gate.snapshot();
      res.json({ profile, haltActive: settings.haltActive, haltPolicy: settings.haltPolicy });
    }),
  );

  app.post(
    "/api/risk/profile",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          capital: z.string(),
          maxDailyLoss: z.string(),
          maxRiskPerTrade: z.string(),
          maxOpenPositions: z.number().int().positive(),
          maxTradesPerDay: z.number().int().positive(),
          minimumRiskReward: z.string(),
          allowEquity: z.boolean(),
          allowFutures: z.boolean(),
          allowOptions: z.boolean(),
          allowOvernight: z.boolean(),
          maxConsecutiveLosses: z.number().int().positive(),
        })
        .parse(req.body);
      const profile = await s.risk.replaceProfile(body);
      const settings = await s.gate.snapshot();
      res.json({ profile, haltActive: settings.haltActive, haltPolicy: settings.haltPolicy });
    }),
  );

  app.post(
    "/api/risk/halt",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          active: z.boolean(),
          policy: z.enum(["MAINTAIN", "CANCEL_ENTRIES", "FLATTEN"]).optional(),
          reason: z.string().optional(),
        })
        .parse(req.body);
      const settings = await s.gate.patch({
        haltActive: body.active,
        haltPolicy: body.policy,
        haltReason: body.reason ?? (body.active ? "user" : null),
      });
      res.json(settings);
    }),
  );

  app.post(
    "/api/proposals",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          source: z.string().default("manual"),
          intent: tradeIntentSchema,
        })
        .parse(req.body);
      const settings = await s.gate.snapshot();
      const result = await s.execution.propose({
        accountId: req.session!.userId,
        intent: body.intent,
        source: String(body.source),
        executionMode: settings.executionMode,
      });
      res.json(result);
    }),
  );

  app.post(
    "/api/proposals/:id/approve",
    auth,
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      const result = await s.execution.approveAndExecute(id, req.session!.userId);
      res.json(result);
    }),
  );

  app.post(
    "/api/proposals/:id/reject",
    auth,
    asyncHandler(async (req, res) => {
      res.json(await s.execution.reject(String(req.params.id ?? "")));
    }),
  );

  app.post(
    "/api/strategy/evaluate",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ exchange: z.string().default("NSE"), symbol: z.string() }).parse(req.body);
      const evaluated = await s.strategy.evaluate(body.exchange, body.symbol);
      const settings = await s.gate.snapshot();
      if (evaluated.decision === "TRADE" && settings.agentMode === "AUTO") {
        const { market: _market, ...intent } = evaluated;
        const proposed = await s.execution.propose({
          accountId: req.session!.userId,
          intent,
          source: "strategy",
          executionMode: settings.executionMode,
        });
        res.json({ decision: evaluated, proposed });
        return;
      }
      await s.journal.record({
        executionMode: settings.executionMode,
        instrument: `${body.exchange}:${body.symbol}`,
        source: "strategy",
        decision: evaluated.decision === "TRADE" ? "TRADE" : "NO_TRADE",
        snapshot: { decision: evaluated, copilotOnly: settings.agentMode !== "AUTO" },
      });
      res.json({ decision: evaluated });
    }),
  );

  app.post(
    "/api/ai/analyse",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ exchange: z.string().default("NSE"), symbol: z.string() }).parse(req.body);
      const market = await s.strategy.evaluate(body.exchange, body.symbol);
      const decision = await s.ai.analyse({
        symbol: body.symbol,
        exchange: body.exchange,
        market,
      });
      const settings = await s.gate.snapshot();
      if (decision.decision === "TRADE" && settings.agentMode === "AUTO") {
        const proposed = await s.execution.propose({
          accountId: req.session!.userId,
          intent: decision,
          source: "ai",
          executionMode: settings.executionMode,
        });
        res.json({ decision, proposed });
        return;
      }
      await s.journal.record({
        executionMode: settings.executionMode,
        instrument: `${body.exchange}:${body.symbol}`,
        source: "ai",
        decision: decision.decision === "TRADE" ? "TRADE" : "NO_TRADE",
        thesis: "decision" in decision && decision.decision === "TRADE" ? decision.thesis : undefined,
        snapshot: { decision, market, copilotOnly: settings.agentMode !== "AUTO" },
      });
      res.json({ decision });
    }),
  );

  app.get("/api/ai/providers/available", (_req, res) => {
    res.json({ providers: s.ai.catalog() });
  });

  app.post(
    "/api/ai/providers/validate",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          providerId: z.string(),
          apiKey: z.string().optional(),
          baseUrl: z.string().optional(),
          profileId: z.string().uuid().optional(),
        })
        .parse(req.body);
      const result = await s.ai.validateDraft(body);
      res.json(result);
    }),
  );

  app.post(
    "/api/ai/providers/models",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          providerId: z.string(),
          apiKey: z.string().optional(),
          baseUrl: z.string().optional(),
          profileId: z.string().uuid().optional(),
        })
        .parse(req.body);
      res.json({ models: await s.ai.modelsFor(body) });
    }),
  );

  app.get(
    "/api/ai/profiles",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.ai.list());
    }),
  );

  app.post(
    "/api/ai/profiles",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          id: z.string().uuid().optional(),
          name: z.string(),
          kind: z.string().min(1),
          modelId: z.string().optional(),
          baseUrl: z.string().optional(),
          apiKey: z.string().optional(),
          activate: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await s.ai.upsert(body));
    }),
  );

  app.post(
    "/api/ai/profiles/:id/activate",
    auth,
    asyncHandler(async (req, res) => {
      res.json(await s.ai.activate(String(req.params.id ?? "")));
    }),
  );

  app.post(
    "/api/ai/profiles/:id/model",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ modelId: z.string() }).parse(req.body);
      res.json(await s.ai.setModel(String(req.params.id ?? ""), body.modelId));
    }),
  );

  app.post(
    "/api/ai/profiles/:id/rename",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ name: z.string() }).parse(req.body);
      res.json(await s.ai.rename(String(req.params.id ?? ""), body.name));
    }),
  );

  app.post(
    "/api/ai/profiles/:id/delete",
    auth,
    asyncHandler(async (req, res) => {
      res.json(await s.ai.remove(String(req.params.id ?? "")));
    }),
  );

  app.post(
    "/api/ai/profiles/:id/test",
    auth,
    asyncHandler(async (req, res) => {
      const body = z.object({ modelId: z.string().optional() }).parse(req.body ?? {});
      res.json(await s.ai.ping(String(req.params.id ?? ""), body.modelId));
    }),
  );

  app.get(
    "/api/journal",
    auth,
    asyncHandler(async (_req, res) => {
      res.json({ entries: await s.journal.list(), memory: await s.journal.memory() });
    }),
  );

  app.get(
    "/api/brief",
    auth,
    asyncHandler(async (_req, res) => {
      res.json(await s.journal.brief());
    }),
  );

  app.get(
    "/api/forecasts",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      res.json({
        agentMode: normalizeAgentMode((await s.gate.snapshot()).agentMode),
        items: await s.forecasts.latest(),
      });
    }),
  );

  app.post(
    "/api/forecasts/refresh",
    auth,
    asyncHandler(async (_req, res) => {
      const items = await s.forecasts.refreshWatchlist();
      res.json({ items, agentMode: normalizeAgentMode((await s.gate.snapshot()).agentMode) });
    }),
  );

  app.get(
    "/api/options/names",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      const names = await s.market.listFnoUnderlyings();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const desk = pickExpiringDesk(names, today);
      res.json({
        names: names.map((item) => ({
          exchange: item.exchange,
          symbol: item.symbol,
          label: item.label,
          kind: item.kind,
          fno: item.fno,
          nextExpiry: item.nextExpiry ?? null,
        })),
        desk: desk
          ? { exchange: desk.exchange, symbol: desk.symbol, expiry: desk.nextExpiry ?? null }
          : null,
      });
    }),
  );

  app.get(
    "/api/options/expiries",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const symbol = String(req.query.symbol ?? "");
      res.json({ expiries: await s.market.listExpiries(symbol) });
    }),
  );

  app.get(
    "/api/options/board",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.query.exchange ?? "NSE");
      const symbol = String(req.query.symbol ?? "");
      const expiry = String(req.query.expiry ?? "") || null;
      res.json(await buildOptionsBoard(s, { exchange, symbol, expiry }));
    }),
  );

  app.post(
    "/api/options/study",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.body?.exchange ?? "NSE");
      const symbol = String(req.body?.symbol ?? "");
      const expiry = String(req.body?.expiry ?? "") || null;
      if (!symbol) {
        res.status(400).json({ error: { message: "symbol required" } });
        return;
      }
      const forecast = await s.forecasts.refreshOne(exchange, symbol, "study", expiry);
      const last = Number(forecast.lastPrice);
      const eod = predictEodSpot({
        last,
        bias: forecast.bias,
        expectedLow: Number(forecast.session.expectedLow),
        expectedHigh: Number(forecast.session.expectedHigh),
        magnet: Number(forecast.session.magnet),
        supports: (forecast.path.supports ?? []).map(Number),
        resistances: (forecast.path.resistances ?? []).map(Number),
        pull: forecast.session.pull,
      });
      const ai = viewAiStudy(forecast.evidence.aiStudy, {
        last,
        expectedLow: Number(forecast.session.expectedLow),
        expectedHigh: Number(forecast.session.expectedHigh),
        magnet: Number(forecast.session.magnet),
      });
      const compare = ai ? compareEod(Number(eod.close), Number(ai.close), forecast.bias, ai.direction) : null;
      res.json({
        ok: Boolean(ai),
        eod,
        ai,
        compare,
        error: forecast.evidence.aiError ?? null,
      });
    }),
  );

  app.get(
    "/api/options/quotes",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const raw = String(req.query.keys ?? "");
      const items = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((key) => {
          const idx = key.indexOf(":");
          return { exchange: key.slice(0, idx), symbol: key.slice(idx + 1) };
        })
        .filter((item) => item.exchange && item.symbol);
      res.json({ quotes: await s.market.quoteMany(items) });
    }),
  );

  app.get(
    "/api/options/signals",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const symbol = String(req.query.symbol ?? "");
      const expiry = String(req.query.expiry ?? "") || null;
      res.json({
        signals: symbol ? await s.signals.list(symbol, expiry) : [],
        plays: symbol ? await s.plays.list({ underlying: symbol, expiry, limit: 20 }) : [],
      });
    }),
  );

  app.get(
    "/api/plays",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const underlying = String(req.query.underlying ?? req.query.symbol ?? "") || undefined;
      const expiry = String(req.query.expiry ?? "") || undefined;
      res.json({ plays: await s.plays.list({ underlying, expiry, limit: 40 }) });
    }),
  );

  app.post(
    "/api/plays/:id/dismiss",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const play = await s.plays.dismiss(String(req.params.id));
      if (!play) {
        res.status(404).json({ error: { message: "play not found" } });
        return;
      }
      res.json({ play });
    }),
  );

  app.get(
    "/api/options/advice",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.query.exchange ?? "NSE");
      const symbol = String(req.query.symbol ?? "");
      const expiry = String(req.query.expiry ?? "") || null;
      const stored = await s.forecasts.getStored(exchange, symbol);
      const mode = stored ? "live" : "full";
      const forecast = await s.forecasts.refreshOne(exchange, symbol, mode, expiry);
      const held = await loadHeldKeys(s.db, s.read);
      const paperHeld = await paperHeldSymbols(s.db);
      const ideas = visibleIdeas(forecast.suggestions ?? [], held, paperHeld, "FNO");
      const settings = await s.gate.snapshot();
      res.json({
        symbol,
        exchange,
        expiry,
        expiryLabel: friendlyDate(expiry),
        lastPrice: forecast.lastPrice,
        trust: Math.round(forecast.confidence * 100),
        stance: stanceLine(forecast.bias),
        ideas,
        wait: ideas.length === 0,
        paperMode: settings.executionMode === "PAPER",
      });
    }),
  );

  app.get(
    "/api/stocks/desk",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      const { buildStocksDesk } = await import("../modules/forecast/equity.js");
      res.json(await buildStocksDesk({ ...s, plays: s.plays }));
    }),
  );

  app.post(
    "/api/paper/try",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          exchange: z.string(),
          symbol: z.string(),
          side: z.enum(["BUY", "SELL"]),
          instrumentType: z.enum(["EQUITY", "OPTION", "FUTURE"]).optional(),
        })
        .parse(req.body);
      res.json(await s.execution.paperFromAdvice({ accountId: req.session!.userId, ...body }));
    }),
  );

  app.get(
    "/api/trades/desk",
    auth,
    asyncHandler(async (_req, res) => {
      await s.paper.markToMarket();
      const paper = await s.execution.paperState();
      const journal = { entries: await s.journal.list(40), memory: await s.journal.memory() };
      let holdings = null;
      let brokerPos = null;
      try {
        holdings = await s.read.getHoldings();
      } catch {
        holdings = null;
      }
      try {
        brokerPos = await s.read.getPositions();
      } catch {
        brokerPos = null;
      }
      res.json({ paper, journal, holdings, brokerPos });
    }),
  );

  app.get(
    "/api/forecasts/one",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.query.exchange ?? "NSE");
      const symbol = String(req.query.symbol ?? "");
      const stored = await s.forecasts.getStored(exchange, symbol);
      const item = stored ?? (await s.forecasts.refreshOne(exchange, symbol));
      res.json(item);
    }),
  );

  app.get(
    "/api/research",
    auth,
    asyncHandler(async (req, res) => {
      const q = String(req.query.q ?? req.query.symbol ?? "");
      if (!q) {
        res.json({ query: "", headlines: [], pages: [], newsScore: 0, summary: "" });
        return;
      }
      res.json(await s.research.study(q));
    }),
  );

  app.get(
    "/api/settings",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      res.json(await s.gate.snapshot());
    }),
  );

  app.post(
    "/api/settings",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          executionMode: z.enum(["PAPER", "LIVE"]).optional(),
          agentMode: z.enum(["COPILOT", "AUTO", "MANUAL", "AUTONOMOUS"]).optional(),
          liveTradingEnabled: z.boolean().optional(),
          autonomousTradingEnabled: z.boolean().optional(),
          confirmEgress: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await s.gate.patch(body));
    }),
  );
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
}
