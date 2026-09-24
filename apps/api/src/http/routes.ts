import { sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "@xtrader/domain";
import { asyncHandler } from "../http/middleware.js";
import type { AppServices } from "../app/context.js";
import {
  friendlyDate,
  loadHeldKeys,
  stanceLine,
  visibleIdeas,
} from "../modules/forecast/desk.js";
import { compareEod, predictEodSpot, viewAiStudy } from "../modules/forecast/eod.js";
import { pickExpiringDesk } from "../modules/forecast/levels.js";
import { buildOptionsBoard } from "../modules/forecast/board.js";
import { marketBlocksPaper } from "../modules/forecast/chain-tape.js";
import { fetchPreviewImage, linkPreview } from "../modules/research/opengraph.js";
import { newsSlotMs } from "../modules/research/service.js";

export function registerRoutes(app: Express, s: AppServices): void {
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      name: "xTrader",
      version: s.updates.currentVersion(),
      ts: new Date().toISOString(),
    });
  });

  app.get(
    "/api/update/status",
    asyncHandler(async (req, res) => {
      const force = String(req.query.refresh ?? "") === "1";
      res.json(await s.updates.status(force));
    }),
  );

  app.post(
    "/api/update/apply",
    asyncHandler(async (req, res) => {
      const tag = typeof req.body?.tag === "string" ? req.body.tag : undefined;
      try {
        const result = await s.updates.apply(tag);
        res.status(202).json(result);
      } catch (err) {
        const code = err instanceof Error && "code" in err ? String((err as { code?: string }).code) : "UPDATE_FAILED";
        const message = err instanceof Error ? err.message : "Update failed";
        const status =
          code === "UPDATE_BUSY" ? 409 : code === "UPDATE_NOT_SUPPORTED" || code === "UPDATE_NONE" ? 400 : 500;
        res.status(status).json({ error: { code, message } });
      }
    }),
  );

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
      const kite = await s.vault.status();
      const profiles = await s.ai.list();
      const hasAiProfile = profiles.some((p) => p.isActive && Boolean(p.modelId));
      res.json({
        linked,
        authenticated: Boolean(session),
        locked: false,
        needsReconnect: linked && !session,
        needsCredentials: !kite.configured,
        hasAiProfile,
        kite,
        broker,
        settings: {
          deskMode: settings.deskMode,
          ordersEnabled: false,
          haltActive: settings.haltActive,
          paperAutopilot: settings.paperAutopilot,
          predictionMode: hasAiProfile ? settings.predictionMode : "ALGO",
          paperCash: settings.paperCash,
          paperOpenCount: settings.paperOpenCount,
        },
        version: s.updates.currentVersion(),
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
  const authOptional = s.sessions.middleware("optional");

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
    authOptional,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          exchange: z.string().default("NSE"),
          symbol: z.string().min(1),
          orderable: z.boolean().optional(),
          autoEnabled: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await s.market.addWatchItem(body));
    }),
  );

  app.post(
    "/api/market/watchlist/remove",
    authOptional,
    asyncHandler(async (req, res) => {
      const body = z.object({ exchange: z.string(), symbol: z.string() }).parse(req.body);
      res.json(await s.market.removeWatchItem(body.exchange, body.symbol));
    }),
  );

  app.post(
    "/api/market/watchlist/auto",
    authOptional,
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
    authOptional,
    asyncHandler(async (_req, res) => {
      const state = await s.execution.paperState();
      const settings = await s.gate.snapshot();
      res.json({
        cash: state.account.cash,
        reservedCash: state.account.reservedCash,
        paperAutopilot: settings.paperAutopilot,
        positions: state.positions,
        closed: state.closed,
      });
    }),
  );

  app.post(
    "/api/paper/topup",
    authOptional,
    asyncHandler(async (_req, res) => {
      const account = await s.execution.paperTopup();
      res.json({ cash: account.cash });
    }),
  );

  app.post(
    "/api/paper/reset",
    authOptional,
    asyncHandler(async (_req, res) => {
      const account = await s.execution.paperReset();
      res.json({ cash: account.cash });
    }),
  );

  app.post(
    "/api/paper/buy",
    authOptional,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          exchange: z.string().min(1),
          symbol: z.string().min(1),
          quantity: z.number().int().positive(),
          lane: z.enum(["FNO", "CASH"]).default("FNO"),
          kind: z.string().default("CE"),
          side: z.enum(["BUY", "SELL"]).default("BUY"),
          regime: z.string().optional(),
          prediction: z
            .object({
              eodSpot: z.string().nullable().optional(),
              eodPremium: z.string().nullable().optional(),
              entrySpot: z.string().nullable().optional(),
              compareTag: z.string().nullable().optional(),
              aiConfidence: z.number().nullable().optional(),
              why: z.string().nullable().optional(),
            })
            .optional(),
        })
        .parse(req.body);
      const fill = await s.execution.paperManual(body);
      res.json(fill);
    }),
  );

  app.post(
    "/api/paper/orders",
    auth,
    asyncHandler(async (_req, _res) => {
      throw new AppError("ORDERING_DISABLED", "Use /api/paper/buy for training fills.", 403);
    }),
  );

  app.post(
    "/api/paper/positions/:id/close",
    authOptional,
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
      const closed = await s.execution.closePaperAndLearn(id, body.reason ?? "MANUAL");
      res.json(closed);
    }),
  );

  app.post(
    "/api/settings/autopilot",
    authOptional,
    asyncHandler(async (req, res) => {
      const body = z.object({ enabled: z.boolean() }).parse(req.body);
      const settings = await s.gate.patch({ paperAutopilot: body.enabled });
      res.json(settings);
    }),
  );

  app.post(
    "/api/settings/prediction-mode",
    authOptional,
    asyncHandler(async (req, res) => {
      const body = z.object({ mode: z.enum(["ALGO", "AI"]) }).parse(req.body);
      if (body.mode === "AI") {
        const profiles = await s.ai.list();
        if (!profiles.some((p) => p.isActive && Boolean(p.modelId))) {
          throw new AppError("NO_AI_PROFILE", "Add and activate an LLM in Settings before using AI mode.", 422);
        }
      }
      const settings = await s.gate.patch({ predictionMode: body.mode });
      res.json(settings);
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
    asyncHandler(async (_req, _res) => {
      throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
    }),
  );

  app.post(
    "/api/proposals/:id/approve",
    auth,
    asyncHandler(async (_req, _res) => {
      throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
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
      await s.journal.record({
        executionMode: "ANALYSIS",
        instrument: `${body.exchange}:${body.symbol}`,
        source: "strategy",
        decision: evaluated.decision === "TRADE" ? "TRADE" : "NO_TRADE",
        snapshot: { decision: evaluated },
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
      await s.journal.record({
        executionMode: "ANALYSIS",
        instrument: `${body.exchange}:${body.symbol}`,
        source: "ai",
        decision: decision.decision === "TRADE" ? "TRADE" : "NO_TRADE",
        thesis: "decision" in decision && decision.decision === "TRADE" ? decision.thesis : undefined,
        snapshot: { decision, market },
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
        deskMode: "ANALYSIS",
        items: await s.forecasts.latest(),
      });
    }),
  );

  app.post(
    "/api/forecasts/refresh",
    auth,
    asyncHandler(async (_req, res) => {
      const items = await s.forecasts.refreshWatchlist();
      res.json({ items, deskMode: "ANALYSIS" });
    }),
  );

  app.get(
    "/api/options/names",
    s.sessions.middleware("optional"),
    asyncHandler(async (_req, res) => {
      const names = await s.market.listFnoUnderlyings();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const settings = await s.gate.snapshot();
      const saved = names.find(
        (item) =>
          item.symbol.toUpperCase() === (settings.activeOptionsSymbol ?? "").toUpperCase() &&
          item.exchange.toUpperCase() === (settings.activeOptionsExchange ?? "").toUpperCase(),
      );
      const desk = saved ?? pickExpiringDesk(names, today);
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

  app.post(
    "/api/options/focus",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const body = z.object({ exchange: z.string().min(1), symbol: z.string().min(1) }).parse(req.body);
      const names = await s.market.listFnoUnderlyings();
      const match = names.find(
        (item) =>
          item.symbol.toUpperCase() === body.symbol.toUpperCase() &&
          item.exchange.toUpperCase() === body.exchange.toUpperCase(),
      );
      if (!match) throw new AppError("UNKNOWN_SYMBOL", "That symbol is not on the options desk.", 422);
      const settings = await s.gate.patch({
        activeOptionsExchange: match.exchange,
        activeOptionsSymbol: match.symbol,
      });
      res.json({ exchange: settings.activeOptionsExchange, symbol: settings.activeOptionsSymbol });
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
      const fp = await s.forecastParams.get(exchange, symbol);
      const eod = predictEodSpot({
        last,
        bias: forecast.bias,
        expectedLow: Number(forecast.session.expectedLow),
        expectedHigh: Number(forecast.session.expectedHigh),
        magnet: Number(forecast.session.magnet),
        supports: (forecast.path.supports ?? []).map(Number),
        resistances: (forecast.path.resistances ?? []).map(Number),
        pull: forecast.session.pull,
        params: fp.algo.params,
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
        paramsVersion: fp.version,
        learning: {
          algo: { mae: fp.algo.scoreMae, delta: fp.algo.delta, lastTuned: fp.algo.lastTunedSession },
          ai: { mae: fp.ai.scoreMae, delta: fp.ai.delta, lastTuned: fp.ai.lastTunedSession },
        },
      });
    }),
  );

  app.post(
    "/api/options/study/stream",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const exchange = String(req.body?.exchange ?? "NSE");
      const symbol = String(req.body?.symbol ?? "");
      const expiry = String(req.body?.expiry ?? "") || null;
      if (!symbol) {
        res.status(400).json({ error: { message: "symbol required" } });
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      const send = (event: string, data: unknown) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      let closed = false;
      req.on("close", () => {
        closed = true;
      });
      try {
        send("phase", { label: "Study started", detail: `${exchange}:${symbol}` });
        const forecast = await s.forecasts.refreshOne(exchange, symbol, "study", expiry, (trace) => {
          if (closed) return;
          send(trace.kind, trace);
        });
        if (closed) return;
        const last = Number(forecast.lastPrice);
        const fp = await s.forecastParams.get(exchange, symbol);
        const eod = predictEodSpot({
          last,
          bias: forecast.bias,
          expectedLow: Number(forecast.session.expectedLow),
          expectedHigh: Number(forecast.session.expectedHigh),
          magnet: Number(forecast.session.magnet),
          supports: (forecast.path.supports ?? []).map(Number),
          resistances: (forecast.path.resistances ?? []).map(Number),
          pull: forecast.session.pull,
          params: fp.algo.params,
        });
        const ai = viewAiStudy(forecast.evidence.aiStudy, {
          last,
          expectedLow: Number(forecast.session.expectedLow),
          expectedHigh: Number(forecast.session.expectedHigh),
          magnet: Number(forecast.session.magnet),
        });
        const compare = ai ? compareEod(Number(eod.close), Number(ai.close), forecast.bias, ai.direction) : null;
        send("done", {
          ok: Boolean(ai),
          eod,
          ai,
          compare,
          error: forecast.evidence.aiError ?? null,
          paramsVersion: fp.version,
          learning: {
            algo: { mae: fp.algo.scoreMae, delta: fp.algo.delta, lastTuned: fp.algo.lastTunedSession },
            ai: { mae: fp.ai.scoreMae, delta: fp.ai.delta, lastTuned: fp.ai.lastTunedSession },
          },
        });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Study failed" });
      } finally {
        if (!res.writableEnded) res.end();
      }
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
      const ideas = visibleIdeas(forecast.suggestions ?? [], held, new Set(), "FNO");
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
    asyncHandler(async (_req, _res) => {
      throw new AppError("ORDERING_DISABLED", "Use /api/paper/buy for training fills.", 403);
    }),
  );

  app.get(
    "/api/learning/desk",
    authOptional,
    asyncHandler(async (_req, res) => {
      res.json(await s.training.metrics());
    }),
  );

  app.get(
    "/api/learning/accuracy",
    authOptional,
    asyncHandler(async (req, res) => {
      const exchange = String(req.query.exchange ?? "NSE");
      const symbol = String(req.query.symbol ?? "").toUpperCase();
      const summary = await s.ledger.summary(40);
      const fp = symbol ? await s.forecastParams.get(exchange, symbol) : null;
      const lastTune = fp?.algo.history.length ? fp.algo.history[fp.algo.history.length - 1] : null;
      res.json({
        mae: summary.mae,
        hitRate: summary.hitRate,
        samples: summary.samples,
        recent: summary.recent,
        symbol: symbol || null,
        algo: fp
          ? {
              params: fp.algo.params,
              delta: fp.algo.delta,
              scoreMae: fp.algo.scoreMae,
              scoreHitRate: fp.algo.scoreHitRate,
              lastTunedSession: fp.algo.lastTunedSession,
            }
          : null,
        ai: fp
          ? {
              params: fp.ai.params,
              delta: fp.ai.delta,
              scoreMae: fp.ai.scoreMae,
              scoreHitRate: fp.ai.scoreHitRate,
              lastTunedSession: fp.ai.lastTunedSession,
            }
          : null,
        paramsVersion: fp?.version ?? null,
        lastTune,
        marketClosed: marketBlocksPaper(),
      });
    }),
  );

  app.get(
    "/api/horizon/compare",
    authOptional,
    asyncHandler(async (req, res) => {
      const watch = await s.market.listWatchlist();
      const names = watch.map((item) => ({ exchange: item.exchange, symbol: item.symbol }));
      const settings = await s.gate.snapshot();
      const asked = String(req.query.symbol ?? "");
      const picked =
        names.find((item) => item.symbol.toUpperCase() === asked.toUpperCase()) ??
        names.find((item) => item.symbol.toUpperCase() === (settings.activeOptionsSymbol ?? "").toUpperCase()) ??
        names[0] ??
        null;
      const horizon = ["5m", "15m", "30m", "1h", "4h", "6h", "eod"].includes(String(req.query.horizon ?? ""))
        ? String(req.query.horizon)
        : "5m";
      const sessionDate = s.ledger.sessionDateIst();
      const points = picked
        ? await s.ledger.readTape({ exchange: picked.exchange, symbol: picked.symbol, sessionDate, horizon })
        : [];
      res.json({
        symbol: picked?.symbol ?? null,
        exchange: picked?.exchange ?? null,
        horizon,
        sessionDate,
        symbols: names,
        points,
      });
    }),
  );

  app.get(
    "/api/trades/desk",
    authOptional,
    asyncHandler(async (_req, res) => {
      const journal = { entries: await s.journal.list(40), memory: await s.journal.memory() };
      const plays = await s.plays.list({ limit: 40 });
      const paper = await s.execution.paperState();
      const settings = await s.gate.snapshot();
      const summary = await s.ledger.summary(24);
      const watch = await s.market.listWatchlist();
      const first = watch[0];
      const fp = first ? await s.forecastParams.get(first.exchange, first.symbol) : null;
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
      res.json({
        journal,
        holdings,
        brokerPos,
        plays,
        paper: {
          cash: paper.account.cash,
          paperAutopilot: settings.paperAutopilot,
          positions: paper.positions,
          closed: paper.closed,
          marketClosed: marketBlocksPaper(),
        },
        learning: {
          mae: summary.mae,
          hitRate: summary.hitRate,
          samples: summary.samples,
          recent: summary.recent.slice(0, 12),
          predictionMode: settings.predictionMode,
          symbol: first ? `${first.exchange}:${first.symbol}` : null,
          algo: fp
            ? {
                params: fp.algo.params,
                delta: fp.algo.delta,
                scoreMae: fp.algo.scoreMae,
                lastTunedSession: fp.algo.lastTunedSession,
              }
            : null,
          ai: fp
            ? {
                params: fp.ai.params,
                delta: fp.ai.delta,
                scoreMae: fp.ai.scoreMae,
                lastTunedSession: fp.ai.lastTunedSession,
              }
            : null,
          paramsVersion: fp?.version ?? null,
          lastTune: fp?.algo.history.length ? fp.algo.history[fp.algo.history.length - 1] : null,
        },
      });
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
    "/api/news/feed",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const active = await s.ai.modelReady();
      const settings = await s.gate.snapshot();
      const slotMinutes = settings.newsSlotMinutes;
      if (!active) {
        res.json({ active: false, symbols: [], symbol: null, exchange: null, delta: null, entries: [], slotMinutes });
        return;
      }
      const watch = await s.market.listWatchlist();
      const names = watch.map((item) => ({ exchange: item.exchange, symbol: item.symbol }));
      const asked = String(req.query.symbol ?? "");
      const picked = names.find((item) => item.symbol.toUpperCase() === asked.toUpperCase()) ?? names[0] ?? null;
      if (!picked) {
        res.json({ active: true, symbols: [], symbol: null, exchange: null, delta: null, entries: [], slotMinutes });
        return;
      }
      const delta = await s.research.read(picked.exchange, picked.symbol);
      const entries = await s.research.tape(picked.exchange, picked.symbol);
      const slotMs = newsSlotMs(slotMinutes);
      const nextAt = Math.floor(Date.now() / slotMs) * slotMs + slotMs;
      res.json({
        active: true,
        symbols: names,
        symbol: picked.symbol,
        exchange: picked.exchange,
        delta,
        entries,
        nextAt,
        slotMinutes,
        work: s.research.workStatus(),
      });
    }),
  );

  app.post(
    "/api/news/interval",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const minutes = Number(req.body?.minutes);
      const newsSlotMinutes = minutes === 30 || minutes === 60 ? minutes : 15;
      await s.gate.patch({ newsSlotMinutes });
      res.json({ slotMinutes: newsSlotMinutes });
    }),
  );

  app.get(
    "/api/news/preview",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const url = String(req.query.url ?? "");
      res.json((await linkPreview(url)) ?? { url, site: "", title: "", description: "", image: "" });
    }),
  );

  app.get(
    "/api/news/image",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const file = await fetchPreviewImage(String(req.query.url ?? ""));
      if (!file) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", file.type);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(file.body);
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
      const settings = await s.gate.snapshot();
      const kite = await s.vault.status();
      res.json({ ...settings, kite });
    }),
  );

  app.post(
    "/api/setup/kite",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          apiKey: z.string().min(6).max(128),
          apiSecret: z.string().min(6).max(256),
        })
        .parse(req.body);
      const kite = await s.vault.save(body.apiKey, body.apiSecret);
      res.json({ ok: true, kite });
    }),
  );

  app.post(
    "/api/setup/kite/revoke",
    s.sessions.middleware("optional"),
    asyncHandler(async (req, res) => {
      if (req.session?.userId) {
        try {
          await s.auth.disconnect(req.session.userId);
        } catch {
          /* ignore */
        }
      }
      const kite = await s.vault.revoke();
      res.json({ ok: true, kite });
    }),
  );

  app.post(
    "/api/settings",
    auth,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          haltActive: z.boolean().optional(),
          haltPolicy: z.enum(["MAINTAIN", "CANCEL_ENTRIES", "FLATTEN"]).optional(),
          haltReason: z.string().nullable().optional(),
          activeAiProfileId: z.string().nullable().optional(),
          paperAutopilot: z.boolean().optional(),
          predictionMode: z.enum(["ALGO", "AI"]).optional(),
        })
        .parse(req.body);
      const settings = await s.gate.patch(body);
      const kite = await s.vault.status();
      res.json({ ...settings, kite });
    }),
  );
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
}
