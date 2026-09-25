import { AppError, d } from "@xtrader/domain";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appSettings, positions, tradeJournal } from "../../db/schema.js";
import type { PaperCloseResult, PaperExecutionAdapter } from "../execution/paper-adapter.js";
import type { JournalService } from "../journal/service.js";
import type { PredictionLedger } from "../learning/ledger.js";
import { marketBlocksPaper } from "../forecast/chain-tape.js";

export type TrainBuyInput = {
  exchange: string;
  symbol: string;
  quantity: number;
  lane: "FNO" | "CASH";
  kind: string;
  side?: "BUY" | "SELL";
  regime?: string;
  source?: string;
  prediction?: {
    eodSpot?: string | null;
    eodPremium?: string | null;
    entrySpot?: string | null;
    compareTag?: string | null;
    aiConfidence?: number | null;
    why?: string | null;
    horizon?: string | null;
    targetAt?: string | null;
    expiryDay?: boolean | null;
  };
};

/** Paper training fills: never touches Zerodha. */
export class PaperTrainer {
  constructor(
    private readonly db: Database,
    private readonly paper: PaperExecutionAdapter,
    private readonly journal: JournalService,
    private readonly ledger?: PredictionLedger,
  ) {}

  async open(input: TrainBuyInput) {
    if (marketBlocksPaper()) {
      throw new AppError("MARKET_CLOSED", "Paper trading is blocked while the market is closed.", 403);
    }
    const side = input.side ?? "BUY";
    const open = await this.paper.openSymbols();
    if (open.has(input.symbol.toUpperCase()) || open.has(`${input.exchange.toUpperCase()}:${input.symbol.toUpperCase()}`)) {
      throw new AppError("ALREADY_OPEN", "Paper position already open on this contract", 409);
    }
    const openCount = (
      await this.db
        .select()
        .from(positions)
        .where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")))
    ).length;
    if (openCount >= 3) {
      throw new AppError("MAX_PAPER_POSITIONS", "Max 3 open paper positions", 422);
    }

    const meta = {
      lane: input.lane,
      kind: input.kind,
      side,
      regime: input.regime ?? "UNKNOWN",
      source: input.source ?? "manual",
      prediction: input.prediction ?? {},
      boughtAt: new Date().toISOString(),
    };
    const fill =
      side === "SELL"
        ? await this.paper.sellShort({
            exchange: input.exchange,
            symbol: input.symbol,
            quantity: input.quantity,
            spot: input.prediction?.entrySpot != null ? Number(input.prediction.entrySpot) : undefined,
            strike: Number(input.symbol.match(/(\d{4,6})(CE|PE)$/i)?.[1] ?? 0) || undefined,
            kind: input.kind === "CE" || input.kind === "PE" ? input.kind : undefined,
            index: /NIFTY|SENSEX|BANKEX/i.test(`${input.symbol}`),
            expiryDay: Boolean(input.prediction?.expiryDay),
            meta,
          })
        : await this.paper.buyLong({
            exchange: input.exchange,
            symbol: input.symbol,
            quantity: input.quantity,
            meta,
          });
    await this.journal.record({
      executionMode: "PAPER",
      instrument: `${input.exchange}:${input.symbol}`,
      source: input.source ?? "manual-train",
      thesis: input.prediction?.why ?? undefined,
      decision: side === "SELL" ? "TRAIN_SELL" : "TRAIN_BUY",
      snapshot: {
        positionId: fill.positionId,
        fillPx: fill.fillPx,
        quantity: input.quantity,
        lane: input.lane,
        kind: input.kind,
        side,
        regime: meta.regime,
        prediction: meta.prediction,
      },
    });
    if (this.ledger) {
      const sessionDate = this.ledger.sessionDateIst();
      const predClose = input.prediction?.eodSpot != null ? Number(input.prediction.eodSpot) : null;
      const predPremium = input.prediction?.eodPremium != null ? Number(input.prediction.eodPremium) : null;
      void this.ledger
        .record({
          kind: side === "SELL" ? "PAPER_SELL" : "PAPER_BUY",
          horizon: input.prediction?.horizon ?? "eod",
          targetAt: input.prediction?.targetAt ?? null,
          exchange: input.exchange,
          symbol: input.symbol,
          sessionDate,
          predictedClose: predClose,
          predictedPremium: predPremium,
          entryPrice: Number(fill.fillPx),
          sourceRef: fill.positionId,
          payload: { prediction: input.prediction ?? {}, side, kind: input.kind },
        })
        .catch(() => undefined);
    }
    return fill;
  }

  /** @deprecated use open */
  async buy(input: TrainBuyInput) {
    return this.open({ ...input, side: input.side ?? "BUY" });
  }

  async sell(positionId: string, reason: string) {
    if (marketBlocksPaper()) {
      throw new AppError("MARKET_CLOSED", "Paper trading is blocked while the market is closed.", 403);
    }
    const closed = await this.paper.closePosition(positionId, reason);
    await this.recordOutcome(closed);
    return closed;
  }

  async recordOutcome(closed: PaperCloseResult) {
    const meta = closed.meta ?? {};
    const prediction = (meta.prediction ?? {}) as {
      eodPremium?: string | null;
      eodSpot?: string | null;
      entrySpot?: string | null;
    };
    const lane = String(meta.lane ?? "FNO");
    const kind = String(meta.kind ?? "CE");
    const regime = String(meta.regime ?? "UNKNOWN");
    const net = Number(closed.netPnl);
    const win = net > 0;
    const predPremium = prediction.eodPremium != null ? Number(prediction.eodPremium) : null;
    const entry = Number(closed.entry);
    const exit = Number(closed.exit);
    let hitPrediction: boolean | null = null;
    if (predPremium != null && Number.isFinite(predPremium) && Number.isFinite(entry)) {
      const predictedUp = predPremium >= entry;
      const movedUp = exit >= entry;
      hitPrediction = predictedUp === movedUp;
    }

    await this.journal.record({
      executionMode: "PAPER",
      instrument: `${closed.exchange}:${closed.symbol}`,
      source: "paper-close",
      decision: win ? "WIN" : "LOSS",
      snapshot: {
        positionId: closed.positionId,
        lane,
        kind,
        regime,
        prediction,
        reason: closed.reason,
      },
      outcome: {
        pnl: closed.netPnl,
        entry: closed.entry,
        exit: closed.exit,
        fees: closed.fees,
        hitPrediction,
      },
    });
    await this.journal.remember({
      strategy: `${lane}:${kind}`,
      regime,
      executionMode: "PAPER",
      win,
      pnl: closed.netPnl,
    });
    if (this.ledger) {
      const sessionDate = this.ledger.sessionDateIst();
      const side = String(meta.side ?? "BUY");
      const ledgerKind = side === "SELL" ? "PAPER_SELL" : "PAPER_BUY";
      void this.ledger
        .resolve({
          kind: ledgerKind,
          exchange: closed.exchange,
          symbol: closed.symbol,
          sessionDate,
          actualPremium: exit,
          actualPnl: net,
          actualClose: prediction.eodSpot != null ? Number(prediction.eodSpot) : null,
        })
        .catch(() => undefined);
    }
  }
}

export async function paperAutopilotEnabled(db: Database): Promise<boolean> {
  const [row] = await db.select().from(appSettings).limit(1);
  return Boolean(row?.paperAutopilot);
}

export async function setPaperAutopilot(db: Database, enabled: boolean) {
  const [row] = await db.select().from(appSettings).limit(1);
  if (!row) {
    await db.insert(appSettings).values({ id: 1, paperAutopilot: enabled });
  } else {
    await db
      .update(appSettings)
      .set({
        paperAutopilot: enabled,
        liveTradingEnabled: false,
        autonomousTradingEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
  }
}

export async function recentPaperOutcomes(db: Database, limit = 30) {
  return db
    .select()
    .from(tradeJournal)
    .where(and(eq(tradeJournal.executionMode, "PAPER"), eq(tradeJournal.source, "paper-close")))
    .orderBy(desc(tradeJournal.createdAt))
    .limit(limit);
}

export function stockTrainQty(cash: string, lastPrice: string): number {
  const budget = d(cash).mul(d("0.10"));
  const px = d(lastPrice);
  if (px.lte(0)) return 0;
  const qty = Math.floor(Number(budget.div(px)));
  return Math.max(qty, 0);
}
