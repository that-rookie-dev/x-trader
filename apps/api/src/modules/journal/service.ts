import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { dailyPerformance, positions, setupMemory, tradeJournal } from "../../db/schema.js";

export class JournalService {
  constructor(private readonly db: Database) {}

  async record(entry: {
    intentId?: string;
    executionMode: string;
    instrument: string;
    source: string;
    thesis?: string;
    decision: string;
    snapshot?: Record<string, unknown>;
    outcome?: Record<string, unknown>;
  }) {
    await this.db.insert(tradeJournal).values({
      intentId: entry.intentId,
      executionMode: entry.executionMode,
      instrument: entry.instrument,
      source: entry.source,
      thesis: entry.thesis,
      decision: entry.decision,
      snapshot: entry.snapshot ?? {},
      outcome: entry.outcome,
    });
  }

  async list(limit = 100) {
    return this.db.select().from(tradeJournal).orderBy(desc(tradeJournal.createdAt)).limit(limit);
  }

  async memory() {
    return this.db.select().from(setupMemory);
  }

  async remember(input: {
    strategy: string;
    regime: string;
    executionMode: string;
    win: boolean;
    rewardRisk?: string;
    pnl?: string;
  }) {
    const [row] = await this.db
      .select()
      .from(setupMemory)
      .where(
        and(
          eq(setupMemory.strategy, input.strategy),
          eq(setupMemory.regime, input.regime),
          eq(setupMemory.executionMode, input.executionMode),
        ),
      )
      .limit(1);
    if (!row) {
      await this.db.insert(setupMemory).values({
        strategy: input.strategy,
        regime: input.regime,
        executionMode: input.executionMode,
        sampleCount: 1,
        wins: input.win ? 1 : 0,
        losses: input.win ? 0 : 1,
        avgRewardRisk: input.rewardRisk ?? null,
        expectancy: input.pnl ?? "0",
      });
      return;
    }
    const samples = row.sampleCount + 1;
    await this.db
      .update(setupMemory)
      .set({
        sampleCount: samples,
        wins: row.wins + (input.win ? 1 : 0),
        losses: row.losses + (input.win ? 0 : 1),
        avgRewardRisk: input.rewardRisk ?? row.avgRewardRisk,
        updatedAt: new Date(),
      })
      .where(eq(setupMemory.id, row.id));
  }

  async brief() {
    const open = await this.db.select().from(positions);
    const openPaper = open.filter((p) => p.executionMode === "PAPER" && p.status === "OPEN");
    const [perf] = await this.db.select().from(dailyPerformance).limit(1);
    return {
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Kolkata",
      niftyContext: { status: "UNKNOWN", reason: "No news/calendar provider configured" },
      events: { status: "UNKNOWN", reason: "No economic calendar feed configured" },
      news: { status: "UNKNOWN", reason: "No news ingestion configured" },
      portfolio: {
        openPaperPositions: openPaper.length,
        dailyPnl: perf
          ? {
              realised: String(perf.realisedPnl),
              unrealised: String(perf.unrealisedPnl),
              fees: String(perf.fees),
            }
          : null,
      },
      stance: openPaper.length === 0 ? "NO_TRADE" : "MANAGE_OPEN_RISK",
    };
  }
}
