import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { money, type BrokerOrder, type MarketRegime, type Play, type PlayHorizon, type PlayStatus } from "@xtrader/domain";
import type { EventEmitter } from "node:events";
import type { Database } from "../../db/client.js";
import { plays } from "../../db/schema.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import type { JournalService } from "../journal/service.js";
import { chandelierStop } from "../indicators/index.js";
import { sessionClock } from "./chain-tape.js";

export type PlayDraft = {
  lane: "FNO" | "CASH";
  side: "CE" | "PE" | "EQ" | "FUT";
  contract: string;
  exchange: string;
  underlying: string;
  expiry: string | null;
  entryZone: string;
  stop: string;
  targets: string[];
  holdUntil: Date;
  invalidation: string;
  edgeAfterCost: string | null;
  confidence: number;
  regime: MarketRegime;
  why: string[];
  eodSpot?: string | null;
  eodPremium?: string | null;
  pcr?: number | null;
  ivRank?: number | null;
  thetaNote?: string | null;
  horizon?: PlayHorizon;
  rsVsNifty?: number | null;
  atrStop?: string | null;
  rank?: number | null;
  setupKey?: string;
  expectancyNote?: string | null;
};

export type PlayRow = typeof plays.$inferSelect;

export function holdUntilAt(kind: "session" | "expiry" | "swing" | "position" | "intraday", expiry?: string | null, now = new Date()): Date {
  if (kind === "expiry" && expiry) return new Date(`${expiry}T15:15:00+05:30`);
  if (kind === "swing") {
    const d = new Date(now);
    d.setDate(d.getDate() + 10);
    return d;
  }
  if (kind === "position") {
    const d = new Date(now);
    d.setDate(d.getDate() + 60);
    return d;
  }
  const ist = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${ist}T15:15:00+05:30`);
}

export function matchBrokerOrder(
  play: { contract: string; at: Date; holdUntil: Date },
  orders: BrokerOrder[],
  now = new Date(),
): BrokerOrder | null {
  const start = play.at.getTime() - 2 * 60_000;
  const end = Math.max(play.holdUntil.getTime() + 30 * 60_000, play.at.getTime() + 6 * 60 * 60_000);
  const name = play.contract.toUpperCase();
  const hits = orders.filter((order) => {
    if (order.symbol.toUpperCase() !== name) return false;
    if ((order.transactionType ?? "BUY") !== "BUY") return false;
    if (!(order.filledQuantity > 0)) return false;
    const ts = order.orderTimestamp ? Date.parse(order.orderTimestamp) : now.getTime();
    if (!Number.isFinite(ts)) return true;
    return ts >= start && ts <= end;
  });
  return hits.sort((a, b) => b.filledQuantity - a.filledQuantity)[0] ?? null;
}

export function fillStatus(order: BrokerOrder): "FILLED" | "PARTIAL" {
  if (order.filledQuantity > 0 && order.filledQuantity < order.quantity) return "PARTIAL";
  return "FILLED";
}

export function shouldExpire(play: { status: string; holdUntil: Date }, now: Date, cutoff: boolean): boolean {
  if (play.status !== "OPEN") return false;
  return cutoff || now.getTime() >= play.holdUntil.getTime();
}

export function shouldMiss(play: { status: string; at: Date; holdUntil: Date; dismissedAt?: Date | null }, now: Date): boolean {
  if (play.status !== "OPEN" && play.status !== "DISMISSED") return false;
  const windowEnd = Math.max(play.holdUntil.getTime() + 30 * 60_000, (play.dismissedAt ?? play.at).getTime() + 4 * 60 * 60_000);
  return now.getTime() > windowEnd;
}

function toPlay(row: PlayRow): Play {
  const payload = (row.payload ?? {}) as Partial<Play>;
  return {
    id: row.id,
    at: row.at.toISOString(),
    lane: row.lane as Play["lane"],
    side: row.kind as Play["side"],
    contract: row.contract,
    exchange: row.exchange,
    underlying: row.underlying,
    expiry: row.expiry || null,
    status: row.status as PlayStatus,
    entryZone: payload.entryZone ?? "",
    stop: payload.stop ?? "",
    targets: payload.targets ?? [],
    holdUntil: row.holdUntil.toISOString(),
    invalidation: payload.invalidation ?? "",
    edgeAfterCost: payload.edgeAfterCost ?? null,
    confidence: payload.confidence ?? 0,
    regime: (row.regime as Play["regime"]) ?? "UNKNOWN",
    why: payload.why ?? [],
    eodSpot: payload.eodSpot,
    eodPremium: payload.eodPremium,
    pcr: payload.pcr,
    ivRank: payload.ivRank,
    thetaNote: payload.thetaNote,
    horizon: (row.horizon as PlayHorizon) ?? payload.horizon,
    rsVsNifty: payload.rsVsNifty,
    atrStop: payload.atrStop,
    rank: payload.rank,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    brokerOrderId: row.brokerOrderId,
    fillQty: row.fillQty,
    fillPx: row.fillPx != null ? String(row.fillPx) : null,
    setupKey: row.setupKey,
    expectancyNote: payload.expectancyNote ?? null,
  };
}

export class PlayStore {
  constructor(
    private readonly db: Database,
    private readonly bus: EventEmitter,
    private readonly journal: JournalService,
  ) {}

  async upsertFromDrafts(drafts: PlayDraft[]): Promise<Play[]> {
    const written: Play[] = [];
    for (const draft of drafts) {
      const play = await this.upsertOne(draft);
      if (play) written.push(play);
    }
    return written;
  }

  private async upsertOne(draft: PlayDraft): Promise<Play | null> {
    const exp = draft.expiry ?? "";
    const [existing] = await this.db
      .select()
      .from(plays)
      .where(
        and(
          eq(plays.contract, draft.contract),
          eq(plays.expiry, exp),
          inArray(plays.status, ["OPEN", "DISMISSED"]),
        ),
      )
      .limit(1);
    const payload = {
      entryZone: draft.entryZone,
      stop: draft.stop,
      targets: draft.targets,
      invalidation: draft.invalidation,
      edgeAfterCost: draft.edgeAfterCost,
      confidence: draft.confidence,
      why: draft.why,
      eodSpot: draft.eodSpot ?? null,
      eodPremium: draft.eodPremium ?? null,
      pcr: draft.pcr ?? null,
      ivRank: draft.ivRank ?? null,
      thetaNote: draft.thetaNote ?? null,
      horizon: draft.horizon ?? "SESSION",
      rsVsNifty: draft.rsVsNifty ?? null,
      atrStop: draft.atrStop ?? null,
      rank: draft.rank ?? null,
      expectancyNote: draft.expectancyNote ?? null,
    };
    if (existing) {
      await this.db
        .update(plays)
        .set({
          payload,
          holdUntil: draft.holdUntil,
          regime: draft.regime,
          horizon: draft.horizon ?? existing.horizon,
          setupKey: draft.setupKey ?? existing.setupKey,
          updatedAt: new Date(),
        })
        .where(eq(plays.id, existing.id));
      return toPlay({ ...existing, payload, holdUntil: draft.holdUntil, regime: draft.regime });
    }
    const [row] = await this.db
      .insert(plays)
      .values({
        lane: draft.lane,
        underlying: draft.underlying,
        expiry: exp,
        contract: draft.contract,
        exchange: draft.exchange,
        kind: draft.side,
        status: "OPEN",
        holdUntil: draft.holdUntil,
        payload,
        regime: draft.regime,
        horizon: draft.horizon ?? "SESSION",
        setupKey: draft.setupKey ?? `${draft.lane}:${draft.side}:${draft.regime}`,
      })
      .returning();
    if (!row) return null;
    const play = toPlay(row);
    this.bus.emit("play", play);
    return play;
  }

  async list(input: { underlying?: string; expiry?: string | null; limit?: number } = {}): Promise<Play[]> {
    const limit = input.limit ?? 40;
    const clauses = [];
    if (input.underlying) clauses.push(eq(plays.underlying, input.underlying));
    if (input.expiry) clauses.push(eq(plays.expiry, input.expiry));
    const rows = clauses.length
      ? await this.db.select().from(plays).where(and(...clauses)).orderBy(desc(plays.at)).limit(limit)
      : await this.db.select().from(plays).orderBy(desc(plays.at)).limit(limit);
    return rows.map(toPlay);
  }

  async dismiss(id: string): Promise<Play | null> {
    const [row] = await this.db.select().from(plays).where(eq(plays.id, id)).limit(1);
    if (!row || (row.status !== "OPEN" && row.status !== "DISMISSED")) return row ? toPlay(row) : null;
    const now = new Date();
    await this.db
      .update(plays)
      .set({ status: "DISMISSED", dismissedAt: now, updatedAt: now })
      .where(eq(plays.id, id));
    const play = toPlay({ ...row, status: "DISMISSED", dismissedAt: now });
    this.bus.emit("play", play);
    return play;
  }

  async expireOpen(now = new Date()): Promise<number> {
    const open = await this.db.select().from(plays).where(eq(plays.status, "OPEN"));
    let n = 0;
    for (const row of open) {
      const clock = sessionClock(now, row.expiry || null);
      if (!shouldExpire(row, now, clock.cutoff)) continue;
      await this.db.update(plays).set({ status: "EXPIRED", updatedAt: now }).where(eq(plays.id, row.id));
      this.bus.emit("play", toPlay({ ...row, status: "EXPIRED" }));
      n += 1;
    }
    return n;
  }

  /** Drop OPEN plays whose contract is no longer an active BUY/SELL on this board. */
  async closeInactive(input: {
    underlying: string;
    expiry: string | null;
    keep: Iterable<string>;
    now?: Date;
  }): Promise<number> {
    const exp = input.expiry ?? "";
    const keep = new Set([...input.keep].map((c) => c.toUpperCase()));
    const open = await this.db
      .select()
      .from(plays)
      .where(and(eq(plays.underlying, input.underlying), eq(plays.expiry, exp), eq(plays.status, "OPEN")));
    const now = input.now ?? new Date();
    let n = 0;
    for (const row of open) {
      if (keep.has(row.contract.toUpperCase())) continue;
      await this.db.update(plays).set({ status: "EXPIRED", updatedAt: now }).where(eq(plays.id, row.id));
      this.bus.emit("play", toPlay({ ...row, status: "EXPIRED" }));
      n += 1;
    }
    return n;
  }

  async tick(read?: ZerodhaReadAdapter, now = new Date()): Promise<void> {
    await this.expireOpen(now);
    if (read) await this.reconcile(read, now);
  }

  async reconcile(read: ZerodhaReadAdapter, now = new Date()): Promise<number> {
    const live = await this.db
      .select()
      .from(plays)
      .where(or(inArray(plays.status, ["OPEN", "DISMISSED", "FILLED", "PARTIAL"]), and(eq(plays.status, "FILLED"), isNull(plays.closedAt))));
    if (live.length === 0) return 0;
    let orders: BrokerOrder[] = [];
    try {
      orders = await read.getOrders();
    } catch {
      orders = [];
    }
    let positions: Array<{ symbol: string; quantity: string; lastPrice?: string; pnl?: string }> = [];
    try {
      const pos = await read.getPositions();
      const holds = await read.getHoldings();
      positions = [
        ...pos.map((p) => ({ symbol: p.instrument.symbol, quantity: p.quantity, lastPrice: p.lastPrice, pnl: p.pnl })),
        ...holds.map((h) => ({ symbol: h.instrument.symbol, quantity: h.quantity, lastPrice: h.lastPrice, pnl: h.pnl })),
      ];
    } catch {
      positions = [];
    }
    let changed = 0;
    for (const row of live) {
      if (row.status === "OPEN" || row.status === "DISMISSED") {
        const hit = matchBrokerOrder(row, orders, now);
        if (hit) {
          const status = fillStatus(hit);
          await this.db
            .update(plays)
            .set({
              status,
              brokerOrderId: hit.brokerOrderId,
              fillQty: hit.filledQuantity,
              fillPx: hit.averagePrice ?? hit.price ?? null,
              updatedAt: now,
            })
            .where(eq(plays.id, row.id));
          await this.journal.record({
            executionMode: "LIVE",
            instrument: row.contract,
            source: "zerodha-reconcile",
            thesis: (row.payload as { invalidation?: string }).invalidation,
            decision: status,
            snapshot: { playId: row.id, brokerOrderId: hit.brokerOrderId, fillPx: hit.averagePrice, fillQty: hit.filledQuantity },
          });
          this.bus.emit("play", toPlay({ ...row, status, brokerOrderId: hit.brokerOrderId, fillQty: hit.filledQuantity, fillPx: hit.averagePrice ?? null }));
          changed += 1;
          continue;
        }
        if (shouldMiss(row, now)) {
          await this.db.update(plays).set({ status: "MISSED", updatedAt: now }).where(eq(plays.id, row.id));
          await this.journal.record({
            executionMode: "LIVE",
            instrument: row.contract,
            source: "zerodha-reconcile",
            decision: "MISSED",
            snapshot: { playId: row.id },
          });
          this.bus.emit("play", toPlay({ ...row, status: "MISSED" }));
          changed += 1;
        }
        continue;
      }
      if ((row.status === "FILLED" || row.status === "PARTIAL") && !row.closedAt) {
        const still = positions.some((p) => p.symbol.toUpperCase() === row.contract.toUpperCase() && Number(p.quantity) !== 0);
        if (still) continue;
        const fill = Number(row.fillPx ?? 0);
        const qty = row.fillQty ?? 0;
        const last = Number(positions.find((p) => p.symbol.toUpperCase() === row.contract.toUpperCase())?.lastPrice ?? fill);
        const pnl = row.closedPnl != null ? Number(row.closedPnl) : (last - fill) * qty;
        await this.db
          .update(plays)
          .set({ closedAt: now, closedPnl: String(pnl), updatedAt: now, status: "FILLED" })
          .where(eq(plays.id, row.id));
        await this.journal.recordFilledClose({
          lane: row.lane,
          kind: row.kind,
          regime: row.regime,
          instrument: row.contract,
          pnl: money(pnl, 2),
          playId: row.id,
        });
        this.bus.emit("play", toPlay({ ...row, status: "FILLED", closedAt: now, closedPnl: String(pnl) }));
        changed += 1;
      }
    }
    return changed;
  }
}

export function trailNote(highs: number[], atrValue: number | null, side: "CE" | "PE"): string | null {
  if (atrValue == null || highs.length === 0) return null;
  const stop = chandelierStop(highs, atrValue, 2, side === "CE" ? "long" : "short", highs);
  if (stop == null) return null;
  return `Trail spot chandelier ${money(stop, 2)}. Square-off note 15:15 IST.`;
}
