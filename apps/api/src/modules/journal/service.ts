import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { dailyPerformance, positions, setupMemory, tradeJournal } from "../../db/schema.js";

export type ExpectancySnap = {
  key: string;
  samples: number;
  wins: number;
  losses: number;
  value: number;
  note: string;
};

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

  async paperLossStreak(_symbol: string): Promise<boolean> {
    return false;
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
    const pnl = Number(input.pnl ?? 0);
    if (!row) {
      await this.db.insert(setupMemory).values({
        strategy: input.strategy,
        regime: input.regime,
        executionMode: input.executionMode,
        sampleCount: 1,
        wins: input.win ? 1 : 0,
        losses: input.win ? 0 : 1,
        avgRewardRisk: input.rewardRisk ?? null,
        expectancy: Number.isFinite(pnl) ? String(pnl) : "0",
      });
      return;
    }
    const samples = row.sampleCount + 1;
    const prevExp = Number(row.expectancy ?? 0);
    const expectancy = Number.isFinite(pnl) ? ((prevExp * row.sampleCount + pnl) / samples).toFixed(4) : row.expectancy;
    await this.db
      .update(setupMemory)
      .set({
        sampleCount: samples,
        wins: row.wins + (input.win ? 1 : 0),
        losses: row.losses + (input.win ? 0 : 1),
        avgRewardRisk: input.rewardRisk ?? row.avgRewardRisk,
        expectancy,
        updatedAt: new Date(),
      })
      .where(eq(setupMemory.id, row.id));
  }

  async expectancy(lane: string, regime: string, kind: string): Promise<ExpectancySnap | null> {
    const strategy = `${lane}:${kind}`;
    const rows = await this.db
      .select()
      .from(setupMemory)
      .where(and(eq(setupMemory.strategy, strategy), eq(setupMemory.regime, regime)));
    if (rows.length === 0) return null;
    const samples = rows.reduce((sum, row) => sum + row.sampleCount, 0);
    const wins = rows.reduce((sum, row) => sum + row.wins, 0);
    const losses = rows.reduce((sum, row) => sum + row.losses, 0);
    const value = samples > 0 ? rows.reduce((sum, row) => sum + Number(row.expectancy ?? 0) * row.sampleCount, 0) / samples : 0;
    return {
      key: `${strategy}:${regime}`,
      samples,
      wins,
      losses,
      value,
      note: samples >= 5 ? `this setup ${wins}/${samples} after costs` : "",
    };
  }

  async expectancyMap(): Promise<Map<string, ExpectancySnap>> {
    const rows = await this.db.select().from(setupMemory);
    const map = new Map<string, ExpectancySnap>();
    for (const row of rows) {
      const key = `${row.strategy}:${row.regime}`;
      const alt = row.strategy;
      const snap: ExpectancySnap = {
        key,
        samples: row.sampleCount,
        wins: row.wins,
        losses: row.losses,
        value: Number(row.expectancy ?? 0),
        note: row.sampleCount >= 5 ? `this setup ${row.wins}/${row.sampleCount} after costs` : "",
      };
      map.set(key, snap);
      const prev = map.get(alt);
      if (!prev) map.set(alt, snap);
    }
    return map;
  }

  async recordFilledClose(input: {
    lane: string;
    kind: string;
    regime: string;
    instrument: string;
    pnl: string;
    playId: string;
  }) {
    const win = Number(input.pnl) > 0;
    await this.record({
      executionMode: "LIVE",
      instrument: input.instrument,
      source: "play-close",
      decision: win ? "WIN" : "LOSS",
      snapshot: { playId: input.playId, lane: input.lane, kind: input.kind, regime: input.regime },
      outcome: { pnl: input.pnl },
    });
    await this.remember({
      strategy: `${input.lane}:${input.kind}`,
      regime: input.regime,
      executionMode: "LIVE",
      win,
      pnl: input.pnl,
    });
  }

  async brief() {
    const open = await this.db.select().from(positions);
    const openBroker = open.filter((p) => p.status === "OPEN");
    const [perf] = await this.db.select().from(dailyPerformance).limit(1);
    return {
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Kolkata",
      niftyContext: { status: "UNKNOWN", reason: "No news/calendar provider configured" },
      events: { status: "UNKNOWN", reason: "No economic calendar feed configured" },
      news: { status: "UNKNOWN", reason: "No news ingestion configured" },
      portfolio: {
        openPositionsTracked: openBroker.length,
        dailyPnl: perf
          ? {
              realised: String(perf.realisedPnl),
              unrealised: String(perf.unrealisedPnl),
              fees: String(perf.fees),
            }
          : null,
      },
      stance: "ANALYSIS_ONLY",
    };
  }
}
