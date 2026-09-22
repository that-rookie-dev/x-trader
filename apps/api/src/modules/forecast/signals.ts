import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { algoMarks, algoSignals } from "../../db/schema.js";
import type { AgentMark } from "./desk.js";
import { notableMarkChange } from "./chain-tape.js";
import type { EventEmitter } from "node:events";

export type AlgoSignal = {
  id: string;
  at: string;
  underlying: string;
  expiry: string;
  contract: string;
  kind: string;
  strike: string;
  fromMark: string;
  toMark: string;
  why: string;
  spot: string | null;
  premium: string | null;
  net: string | null;
};

export type MarkSnap = {
  contract: string;
  kind: "CE" | "PE";
  strike: number;
  mark: AgentMark;
  why: string;
  spot: number;
  premium: number | null;
  net: number | null;
};

export class SignalStore {
  constructor(
    private readonly db: Database,
    private readonly bus: EventEmitter,
  ) {}

  async diffAndPersist(underlying: string, expiry: string | null, snaps: MarkSnap[]): Promise<AlgoSignal[]> {
    const exp = expiry ?? "";
    if (!exp || snaps.length === 0) return [];
    const prev = await this.db.select().from(algoMarks).where(and(eq(algoMarks.underlying, underlying), eq(algoMarks.expiry, exp)));
    const prevMap = new Map(prev.map((row) => [row.contract, row]));
    const written: AlgoSignal[] = [];
    const now = new Date();
    for (const snap of snaps) {
      const last = prevMap.get(snap.contract);
      const fromMark = last?.mark ?? null;
      if (!notableMarkChange(fromMark, snap.mark)) {
        if (last) {
          await this.db
            .update(algoMarks)
            .set({
              mark: snap.mark,
              why: snap.why,
              strike: String(snap.strike),
              spot: String(snap.spot),
              premium: snap.premium != null ? String(snap.premium) : null,
              net: snap.net != null ? String(snap.net) : null,
              updatedAt: now,
            })
            .where(eq(algoMarks.id, last.id));
        } else {
          await this.db.insert(algoMarks).values({
            underlying,
            expiry: exp,
            contract: snap.contract,
            kind: snap.kind,
            strike: String(snap.strike),
            mark: snap.mark,
            why: snap.why,
            spot: String(snap.spot),
            premium: snap.premium != null ? String(snap.premium) : null,
            net: snap.net != null ? String(snap.net) : null,
            updatedAt: now,
          });
        }
        continue;
      }
      const [row] = await this.db
        .insert(algoSignals)
        .values({
          at: now,
          underlying,
          expiry: exp,
          contract: snap.contract,
          kind: snap.kind,
          strike: String(snap.strike),
          fromMark: fromMark ?? "IDLE",
          toMark: snap.mark,
          why: snap.why,
          spot: String(snap.spot),
          premium: snap.premium != null ? String(snap.premium) : null,
          net: snap.net != null ? String(snap.net) : null,
        })
        .returning();
      if (last) {
        await this.db
          .update(algoMarks)
          .set({
            mark: snap.mark,
            why: snap.why,
            strike: String(snap.strike),
            spot: String(snap.spot),
            premium: snap.premium != null ? String(snap.premium) : null,
            net: snap.net != null ? String(snap.net) : null,
            updatedAt: now,
          })
          .where(eq(algoMarks.id, last.id));
      } else {
        await this.db.insert(algoMarks).values({
          underlying,
          expiry: exp,
          contract: snap.contract,
          kind: snap.kind,
          strike: String(snap.strike),
          mark: snap.mark,
          why: snap.why,
          spot: String(snap.spot),
          premium: snap.premium != null ? String(snap.premium) : null,
          net: snap.net != null ? String(snap.net) : null,
          updatedAt: now,
        });
      }
      if (row) {
        const signal = toSignal(row);
        written.push(signal);
        this.bus.emit("signal", signal);
      }
    }
    return written;
  }

  async list(underlying: string, expiry: string | null, limit = 30): Promise<AlgoSignal[]> {
    const exp = expiry ?? "";
    const rows = exp
      ? await this.db
          .select()
          .from(algoSignals)
          .where(and(eq(algoSignals.underlying, underlying), eq(algoSignals.expiry, exp)))
          .orderBy(desc(algoSignals.at))
          .limit(limit)
      : await this.db.select().from(algoSignals).where(eq(algoSignals.underlying, underlying)).orderBy(desc(algoSignals.at)).limit(limit);
    return rows.map(toSignal);
  }
}

function toSignal(row: typeof algoSignals.$inferSelect): AlgoSignal {
  return {
    id: row.id,
    at: row.at.toISOString(),
    underlying: row.underlying,
    expiry: row.expiry,
    contract: row.contract,
    kind: row.kind,
    strike: String(row.strike),
    fromMark: row.fromMark,
    toMark: row.toMark,
    why: row.why,
    spot: row.spot != null ? String(row.spot) : null,
    premium: row.premium != null ? String(row.premium) : null,
    net: row.net != null ? String(row.net) : null,
  };
}
