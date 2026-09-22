import { and, desc, eq } from "drizzle-orm";
import { AppError, type ExecutionMode, type InstrumentType, type TradeIntent } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { orders, paperAccounts, positions, tradeApprovals, tradeIntents } from "../../db/schema.js";
import type { PaperExecutionAdapter } from "./paper-adapter.js";
import type { ZerodhaOrderAdapter } from "./zerodha-order-adapter.js";
import type { RiskService } from "../risk/service.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { JournalService } from "../journal/service.js";
import type { MarketDataService } from "../market/service.js";

function indianSessionOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

export class ExecutionCoordinator {
  constructor(
    private readonly db: Database,
    private readonly risk: RiskService,
    private readonly paper: PaperExecutionAdapter,
    private readonly live: ZerodhaOrderAdapter,
    private readonly gate: LiveGate,
    private readonly journal: JournalService,
    private readonly market: MarketDataService,
  ) {}

  async propose(input: {
    accountId: string;
    intent: TradeIntent;
    source: string;
    executionMode: ExecutionMode;
    requestedQuantity?: number;
  }) {
    const settings = await this.gate.snapshot();
    const mode = input.executionMode ?? settings.executionMode;
    const last = this.market.getLastTick(input.intent.instrument);
    const lastPrice = last?.lastPrice ?? input.intent.entryPrice;
    const live = mode === "LIVE";
    const result = await this.risk.evaluateAndPersist({
      accountId: input.accountId,
      executionMode: mode,
      source: input.source,
      intent: input.intent,
      availableCash: "0",
      lastPrice,
      dataFresh: live ? this.market.isFresh(input.intent.instrument) : Boolean(lastPrice),
      marketOpen: live ? indianSessionOpen() : true,
      requestedQuantity: input.requestedQuantity,
    });
    await this.journal.record({
      intentId: result.intentId,
      executionMode: mode,
      instrument: `${input.intent.instrument.exchange}:${input.intent.instrument.symbol}`,
      source: input.source,
      thesis: input.intent.thesis,
      decision: result.decision.approved ? "TRADE" : result.decision.code,
      snapshot: { intent: input.intent, risk: result.decision },
    });
    return result;
  }

  async approveAndExecute(approvalId: string, userId: string) {
    const settings = await this.gate.snapshot();
    if (settings.haltActive) throw new AppError("KILL_SWITCH_ACTIVE", "Halt is active", 423);
    const approval = await this.risk.consumeApproval(approvalId, settings.executionMode);
    const [intent] = await this.db.select().from(tradeIntents).where(eq(tradeIntents.id, approval.intentId)).limit(1);
    if (!intent) throw new AppError("INTENT_MISSING", "Intent missing", 404);
    const payload = intent.payload as unknown as TradeIntent;
    const trade = {
      approvalId: approval.id,
      intentId: intent.id,
      accountId: intent.accountId,
      executionMode: settings.executionMode,
      instrument: payload.instrument,
      direction: payload.direction,
      quantity: approval.quantity,
      entryType: payload.entryType,
      entryPrice: payload.entryPrice,
      stopLoss: payload.stopLoss,
      targets: payload.targets,
      expiresAt: approval.expiresAt.toISOString(),
      idempotencyKey: approval.id,
    };
    const ack =
      settings.executionMode === "LIVE" ? await this.live.submit(trade) : await this.paper.submit(trade);
    await this.db.update(tradeApprovals).set({ userApproved: true }).where(eq(tradeApprovals.id, approvalId));
    return ack;
  }

  async autoExecute(input: {
    accountId: string;
    intent: TradeIntent;
    source: string;
    executionMode: ExecutionMode;
  }) {
    const proposed = await this.propose(input);
    if (!proposed.decision.approved || !proposed.approvalId) {
      return { proposed, executed: null };
    }
    const executed = await this.approveAndExecute(proposed.approvalId, input.accountId);
    return { proposed, executed };
  }

  async paperManual(input: {
    accountId: string;
    exchange: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    orderType: "MARKET" | "LIMIT";
    price?: string;
  }) {
    const settings = await this.gate.snapshot();
    if (settings.executionMode !== "PAPER") {
      throw new AppError("PAPER_ONLY", "Manual tickets in this path are paper-only. Switch to TEST mode.", 422);
    }
    if (input.side === "SELL") {
      const [pos] = await this.db
        .select()
        .from(positions)
        .where(and(eq(positions.symbol, input.symbol), eq(positions.status, "OPEN"), eq(positions.executionMode, "PAPER")))
        .limit(1);
      if (!pos) throw new AppError("NO_POSITION", "No paper position to sell-to-close", 422);
      await this.paper.closePosition(pos.id, "USER");
      return { status: "FILLED", message: "Paper position closed" };
    }
    const last = this.market.getLastTick({ exchange: input.exchange, symbol: input.symbol, instrumentType: "EQUITY" });
    const px = input.price ?? last?.lastPrice ?? (await this.market.lastPrice(input.exchange, input.symbol));
    if (!px) throw new AppError("NO_QUOTE", "No price available", 422);
    const stop = String((Number(px) * 0.99).toFixed(2));
    const target = String((Number(px) * 1.02).toFixed(2));
    const intent: TradeIntent = {
      decision: "TRADE",
      instrument: { exchange: input.exchange, symbol: input.symbol, instrumentType: "EQUITY" },
      direction: "LONG",
      entryType: input.orderType,
      entryPrice: px,
      stopLoss: stop,
      targets: [target],
      confidenceScore: 1,
      timeHorizon: "INTRADAY",
      strategy: "manual",
      thesis: "Manual paper ticket",
      invalidation: "User exit",
      maxRiskRequested: "300.00",
      metadata: {},
    };
    const proposed = await this.propose({
      accountId: input.accountId,
      intent,
      source: "manual",
      executionMode: "PAPER",
      requestedQuantity: input.quantity,
    });
    if (!proposed.decision.approved || !proposed.approvalId) {
      throw new AppError(proposed.decision.code, proposed.decision.reason, 422);
    }
    return this.approveAndExecute(proposed.approvalId, input.accountId);
  }

  async paperFromAdvice(input: {
    accountId: string;
    exchange: string;
    symbol: string;
    side: "BUY" | "SELL";
    instrumentType?: InstrumentType;
  }) {
    const settings = await this.gate.snapshot();
    if (settings.executionMode !== "PAPER") {
      throw new AppError("PAPER_ONLY", "Play-money orders are only available in Test mode.", 422);
    }
    if (input.side === "SELL") {
      const [pos] = await this.db
        .select()
        .from(positions)
        .where(and(eq(positions.symbol, input.symbol), eq(positions.status, "OPEN"), eq(positions.executionMode, "PAPER")))
        .limit(1);
      if (!pos) throw new AppError("NO_POSITION", "You do not have a play-money position to sell.", 422);
      return this.closePaperAndLearn(pos.id, "USER");
    }
    const instrumentType = inferPaperType(input.exchange, input.symbol, input.instrumentType);
    const px =
      (await this.market.freshLtp(input.exchange, input.symbol)) ??
      (await this.market.lastPrice(input.exchange, input.symbol));
    if (!px) throw new AppError("NO_QUOTE", "No price is available for a play-money order yet.", 422);
    await this.market.rememberQuote(input.exchange, input.symbol, px);
    const stop = String((Number(px) * 0.99).toFixed(2));
    const target = String((Number(px) * 1.02).toFixed(2));
    const intent: TradeIntent = {
      decision: "TRADE",
      instrument: { exchange: input.exchange, symbol: input.symbol, instrumentType },
      direction: "LONG",
      entryType: "MARKET",
      entryPrice: px,
      stopLoss: stop,
      targets: [target],
      confidenceScore: 1,
      timeHorizon: "INTRADAY",
      strategy: "copilot-paper",
      thesis: "Play-money try of a helper idea",
      invalidation: "User exit",
      maxRiskRequested: "300.00",
      metadata: { source: "copilot-paper" },
    };
    const proposed = await this.propose({
      accountId: input.accountId,
      intent,
      source: "copilot-paper",
      executionMode: "PAPER",
      requestedQuantity: 1,
    });
    if (!proposed.decision.approved || !proposed.approvalId) {
      throw new AppError(proposed.decision.code, proposed.decision.reason, 422);
    }
    const executed = await this.approveAndExecute(proposed.approvalId, input.accountId);
    await this.journal.record({
      intentId: proposed.intentId,
      executionMode: "PAPER",
      instrument: `${input.exchange}:${input.symbol}`,
      source: "copilot-paper",
      thesis: "Play-money buy to test the helper",
      decision: executed.status,
      snapshot: { intent, executed },
    });
    return executed;
  }

  async closePaperAndLearn(positionId: string, reason: string) {
    const [before] = await this.db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
    await this.paper.closePosition(positionId, reason);
    const [after] = await this.db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
    const pnl = Number(after?.realisedPnl ?? 0);
    await this.journal.record({
      executionMode: "PAPER",
      instrument: `${before?.exchange ?? ""}:${before?.symbol ?? ""}`,
      source: "copilot-paper",
      thesis: reason,
      decision: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "FLAT",
      snapshot: {
        entry: before?.averageEntry,
        exit: after?.currentPrice,
        quantity: before?.quantity,
      },
      outcome: { pnl, reason, closedAt: new Date().toISOString() },
    });
    await this.journal.remember({
      strategy: "copilot-paper",
      regime: before?.symbol ?? "unknown",
      executionMode: "PAPER",
      win: pnl > 0,
      pnl: String(pnl),
    });
    return this.paperState();
  }

  async reject(approvalId: string) {
    return this.risk.rejectApproval(approvalId);
  }

  async paperState() {
    const [account] = await this.db.select().from(paperAccounts).limit(1);
    const pos = await this.db.select().from(positions).where(eq(positions.executionMode, "PAPER"));
    const orderRows = await this.db.select().from(orders).where(eq(orders.executionMode, "PAPER")).orderBy(desc(orders.createdAt)).limit(50);
    return {
      account: account
        ? { id: account.id, cash: String(account.cash), reservedCash: String(account.reservedCash) }
        : null,
      positions: pos,
      orders: orderRows,
    };
  }
}

function inferPaperType(exchange: string, symbol: string, hint?: InstrumentType): InstrumentType {
  if (hint === "EQUITY" || hint === "OPTION" || hint === "FUTURE") return hint;
  if (exchange === "NFO") {
    if (symbol.endsWith("CE") || symbol.endsWith("PE")) return "OPTION";
    return "FUTURE";
  }
  return "EQUITY";
}
