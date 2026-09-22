import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  AppError,
  d,
  money,
  type ExecutionMode,
  type RiskProfile,
  type TradeIntent,
} from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import {
  dailyPerformance,
  paperAccounts,
  positions,
  riskDecisions,
  riskProfiles,
  riskReservations,
  tradeApprovals,
  tradeIntents,
  appSettings,
} from "../../db/schema.js";
import { evaluateRisk, type RiskResult } from "./engine.js";

function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export class RiskService {
  constructor(private readonly db: Database) {}

  async currentProfile(): Promise<RiskProfile> {
    const [row] = await this.db.select().from(riskProfiles).orderBy(desc(riskProfiles.createdAt)).limit(1);
    if (!row) throw new AppError("NO_RISK_PROFILE", "Risk profile is not configured", 500);
    return {
      capital: String(row.capital),
      maxDailyLoss: String(row.maxDailyLoss),
      maxRiskPerTrade: String(row.maxRiskPerTrade),
      maxOpenPositions: row.maxOpenPositions,
      maxTradesPerDay: row.maxTradesPerDay,
      minimumRiskReward: String(row.minimumRiskReward),
      allowEquity: row.allowEquity,
      allowFutures: row.allowFutures,
      allowOptions: row.allowOptions,
      allowOvernight: row.allowOvernight,
      maxConsecutiveLosses: row.maxConsecutiveLosses,
    };
  }

  async evaluateAndPersist(opts: {
    accountId: string;
    executionMode: ExecutionMode;
    source: string;
    intent: TradeIntent;
    availableCash: string;
    lastPrice: string;
    dataFresh: boolean;
    marketOpen: boolean;
    lotSize?: number;
    requestedQuantity?: number;
  }): Promise<{ intentId: string; decision: RiskResult; approvalId?: string }> {
    return this.db.transaction(async (tx) => {
      const profileRow = (await tx.select().from(riskProfiles).orderBy(desc(riskProfiles.createdAt)).limit(1))[0];
      if (!profileRow) throw new AppError("NO_RISK_PROFILE", "Risk profile is not configured", 500);
      const [settings] = await tx.select().from(appSettings).limit(1);
      const [paper] = await tx.select().from(paperAccounts).limit(1);
      const open = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.executionMode, opts.executionMode), eq(positions.status, "OPEN")));
      const day = todayIst();
      const [perf] = await tx
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.accountId, opts.accountId),
            eq(dailyPerformance.executionMode, opts.executionMode),
            eq(dailyPerformance.day, day),
          ),
        );
      const reserved = await tx
        .select({ total: sql<string>`coalesce(sum(${riskReservations.amount}), 0)` })
        .from(riskReservations)
        .where(
          and(
            eq(riskReservations.accountId, opts.accountId),
            eq(riskReservations.executionMode, opts.executionMode),
            isNull(riskReservations.releasedAt),
          ),
        );

      const paperTry = opts.source === "copilot-paper" && opts.executionMode === "PAPER";
      const profile: RiskProfile = {
        capital: String(profileRow.capital),
        maxDailyLoss: String(profileRow.maxDailyLoss),
        maxRiskPerTrade: String(profileRow.maxRiskPerTrade),
        maxOpenPositions: profileRow.maxOpenPositions,
        maxTradesPerDay: profileRow.maxTradesPerDay,
        minimumRiskReward: paperTry ? "1.00" : String(profileRow.minimumRiskReward),
        allowEquity: paperTry ? true : profileRow.allowEquity,
        allowFutures: paperTry ? true : profileRow.allowFutures,
        allowOptions: paperTry ? true : profileRow.allowOptions,
        allowOvernight: paperTry ? true : profileRow.allowOvernight,
        maxConsecutiveLosses: profileRow.maxConsecutiveLosses,
      };

      const result = evaluateRisk({
        profile,
        intent: opts.intent,
        availableCash: paper ? String(paper.cash) : opts.availableCash,
        openPositions: open.length,
        tradesToday: perf?.trades ?? 0,
        consecutiveLosses: perf?.losses ?? 0,
        dailyNetPnl: money(d(perf?.realisedPnl ?? "0").plus(perf?.unrealisedPnl ?? "0").minus(perf?.fees ?? "0")),
        reservedRisk: String(reserved[0]?.total ?? "0"),
        haltActive: settings?.haltActive ?? false,
        marketOpen: opts.marketOpen,
        dataFresh: opts.dataFresh,
        lastPrice: opts.lastPrice,
        lotSize: opts.lotSize,
        requestedQuantity: opts.requestedQuantity,
      });

      const [intentRow] = await tx
        .insert(tradeIntents)
        .values({
          accountId: opts.accountId,
          executionMode: opts.executionMode,
          source: opts.source,
          payload: opts.intent as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + 30_000),
        })
        .returning();

      const [decisionRow] = await tx
        .insert(riskDecisions)
        .values({
          intentId: intentRow!.id,
          approved: result.approved,
          code: result.code,
          reason: result.reason,
          quantity: result.quantity ?? null,
          plannedRisk: result.plannedRisk ?? null,
          rewardRisk: result.rewardRisk ?? null,
          profileVersion: profileRow.version,
        })
        .returning();

      if (!result.approved || !result.quantity || !result.plannedRisk) {
        return { intentId: intentRow!.id, decision: result };
      }

      await tx.insert(riskReservations).values({
        accountId: opts.accountId,
        executionMode: opts.executionMode,
        intentId: intentRow!.id,
        amount: result.plannedRisk,
      });

      const ttl = 15_000;
      const [approval] = await tx
        .insert(tradeApprovals)
        .values({
          intentId: intentRow!.id,
          riskDecisionId: decisionRow!.id,
          quantity: result.quantity,
          executionMode: opts.executionMode,
          expiresAt: new Date(Date.now() + ttl),
        })
        .returning();

      return { intentId: intentRow!.id, decision: result, approvalId: approval!.id };
    });
  }

  async consumeApproval(approvalId: string, executionMode: ExecutionMode) {
    const [row] = await this.db.select().from(tradeApprovals).where(eq(tradeApprovals.id, approvalId)).limit(1);
    if (!row) throw new AppError("APPROVAL_NOT_FOUND", "Approval not found", 404);
    if (row.consumedAt) throw new AppError("APPROVAL_CONSUMED", "Approval already used", 409);
    if (row.expiresAt.getTime() < Date.now()) throw new AppError("APPROVAL_EXPIRED", "Approval expired", 409);
    if (row.executionMode !== executionMode) {
      throw new AppError("MODE_MISMATCH", "Approval execution mode does not match", 409);
    }
    await this.db.update(tradeApprovals).set({ consumedAt: new Date() }).where(eq(tradeApprovals.id, approvalId));
    return row;
  }

  async rejectApproval(approvalId: string) {
    const [row] = await this.db.select().from(tradeApprovals).where(eq(tradeApprovals.id, approvalId)).limit(1);
    if (!row) throw new AppError("APPROVAL_NOT_FOUND", "Approval not found", 404);
    if (!row.consumedAt) {
      await this.db.update(tradeApprovals).set({ consumedAt: new Date(), userApproved: false }).where(eq(tradeApprovals.id, approvalId));
    }
    await this.db
      .update(riskReservations)
      .set({ releasedAt: new Date() })
      .where(and(eq(riskReservations.intentId, row.intentId), isNull(riskReservations.releasedAt)));
    return { ok: true, id: approvalId, rejected: true };
  }

  async replaceProfile(input: {
    capital: string;
    maxDailyLoss: string;
    maxRiskPerTrade: string;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    minimumRiskReward: string;
    allowEquity: boolean;
    allowFutures: boolean;
    allowOptions: boolean;
    allowOvernight: boolean;
    maxConsecutiveLosses: number;
  }) {
    const [prev] = await this.db.select().from(riskProfiles).orderBy(desc(riskProfiles.createdAt)).limit(1);
    await this.db.insert(riskProfiles).values({
      version: (prev?.version ?? 0) + 1,
      capital: input.capital,
      maxDailyLoss: input.maxDailyLoss,
      maxRiskPerTrade: input.maxRiskPerTrade,
      maxOpenPositions: input.maxOpenPositions,
      maxTradesPerDay: input.maxTradesPerDay,
      minimumRiskReward: input.minimumRiskReward,
      allowEquity: input.allowEquity,
      allowFutures: input.allowFutures,
      allowOptions: input.allowOptions,
      allowOvernight: input.allowOvernight,
      maxConsecutiveLosses: input.maxConsecutiveLosses,
    });
    return this.currentProfile();
  }
}
