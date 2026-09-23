import { and, desc, eq } from "drizzle-orm";
import { AppError, d, money, type ApprovedTrade, type ExecutionAcknowledgement } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { executions, orders, paperAccounts, positions, quotesCache, users } from "../../db/schema.js";

const SLIPPAGE = d("0.0005");
const FEE_BPS = d("0.0003");
export const PAPER_TOPUP = "25000.00";

export type PaperCloseResult = {
  positionId: string;
  exchange: string;
  symbol: string;
  quantity: string;
  entry: string;
  exit: string;
  netPnl: string;
  fees: string;
  meta: Record<string, unknown>;
  reason: string;
};

export class PaperExecutionAdapter {
  constructor(private readonly db: Database) {}

  async ensureAccount(preferredUserId?: string | null) {
    const [existing] = await this.db.select().from(paperAccounts).limit(1);
    if (existing) return existing;

    let userId = preferredUserId ?? null;
    if (!userId) {
      const [user] = await this.db.select().from(users).limit(1);
      if (user) userId = user.id;
      else {
        const [created] = await this.db.insert(users).values({ displayName: "desk" }).returning();
        userId = created!.id;
      }
    }

    const [account] = await this.db
      .insert(paperAccounts)
      .values({ userId, cash: PAPER_TOPUP, reservedCash: "0" })
      .returning();
    return account!;
  }

  async topup(amount = PAPER_TOPUP) {
    const account = await this.ensureAccount();
    const next = money(d(account.cash).plus(d(amount)));
    const [row] = await this.db
      .update(paperAccounts)
      .set({ cash: next, updatedAt: new Date() })
      .where(eq(paperAccounts.id, account.id))
      .returning();
    return row!;
  }

  async reset() {
    const account = await this.ensureAccount();
    const open = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")));
    for (const pos of open) {
      await this.closePosition(pos.id, "RESET");
    }
    const [row] = await this.db
      .update(paperAccounts)
      .set({ cash: PAPER_TOPUP, reservedCash: "0", updatedAt: new Date() })
      .where(eq(paperAccounts.id, account.id))
      .returning();
    return row!;
  }

  async state() {
    const account = await this.ensureAccount();
    await this.markToMarket();
    const open = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")))
      .orderBy(desc(positions.openedAt));
    const recent = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "CLOSED")))
      .orderBy(desc(positions.closedAt))
      .limit(40);
    return { account, positions: open, closed: recent };
  }

  async buyLong(input: {
    exchange: string;
    symbol: string;
    quantity: number;
    meta?: Record<string, unknown>;
  }): Promise<{ positionId: string; fillPx: string; fees: string; accountId: string }> {
    const account = await this.ensureAccount();
    if (input.quantity <= 0) throw new AppError("BAD_QTY", "Quantity must be positive", 400);
    const quote = await this.quote(input.exchange, input.symbol);
    if (!quote) throw new AppError("NO_QUOTE", "No market data to fill the paper order", 422);

    const fill = d(quote.lastPrice).mul(d(1).plus(SLIPPAGE));
    const notional = fill.mul(input.quantity);
    const fees = notional.mul(FEE_BPS);
    const cashNeeded = notional.plus(fees);

    return this.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(paperAccounts).where(eq(paperAccounts.id, account.id)).limit(1);
      if (!fresh) throw new AppError("NO_PAPER_ACCOUNT", "Paper account missing", 500);
      if (d(fresh.cash).lt(cashNeeded)) {
        throw new AppError("INSUFFICIENT_CAPITAL", "Paper cash is insufficient — Add ₹25k to continue training", 422);
      }
      await tx
        .update(paperAccounts)
        .set({ cash: money(d(fresh.cash).minus(cashNeeded)), updatedAt: new Date() })
        .where(eq(paperAccounts.id, fresh.id));

      const [order] = await tx
        .insert(orders)
        .values({
          executionMode: "PAPER",
          accountId: fresh.id,
          exchange: input.exchange,
          symbol: input.symbol,
          side: "BUY",
          quantity: input.quantity,
          filledQuantity: input.quantity,
          orderType: "MARKET",
          averagePrice: money(fill, 4),
          status: "FILLED",
          fees: money(fees, 4),
        })
        .returning();

      await tx.insert(executions).values({
        orderId: order!.id,
        quantity: input.quantity,
        price: money(fill, 4),
        fees: money(fees, 4),
      });

      const [pos] = await tx
        .insert(positions)
        .values({
          executionMode: "PAPER",
          accountId: fresh.id,
          exchange: input.exchange,
          symbol: input.symbol,
          direction: "LONG",
          quantity: String(input.quantity),
          averageEntry: money(fill, 4),
          currentPrice: money(fill, 4),
          stopLoss: null,
          targets: [],
          unrealisedPnl: "0",
          fees: money(fees, 4),
          status: "OPEN",
          meta: input.meta ?? {},
        })
        .returning();

      return {
        positionId: pos!.id,
        fillPx: money(fill, 4),
        fees: money(fees, 4),
        accountId: fresh.id,
      };
    });
  }

  async sellShort(input: {
    exchange: string;
    symbol: string;
    quantity: number;
    meta?: Record<string, unknown>;
  }): Promise<{ positionId: string; fillPx: string; fees: string; accountId: string }> {
    const account = await this.ensureAccount();
    if (input.quantity <= 0) throw new AppError("BAD_QTY", "Quantity must be positive", 400);
    const quote = await this.quote(input.exchange, input.symbol);
    if (!quote) throw new AppError("NO_QUOTE", "No market data to fill the paper order", 422);

    // Sell filled slightly worse; credit premium. Hold loose margin = 20% of notional.
    const fill = d(quote.lastPrice).mul(d(1).minus(SLIPPAGE));
    const notional = fill.mul(input.quantity);
    const fees = notional.mul(FEE_BPS);
    const margin = notional.mul(d("0.20"));
    const cashNeeded = margin.plus(fees);

    return this.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(paperAccounts).where(eq(paperAccounts.id, account.id)).limit(1);
      if (!fresh) throw new AppError("NO_PAPER_ACCOUNT", "Paper account missing", 500);
      if (d(fresh.cash).lt(cashNeeded)) {
        throw new AppError("INSUFFICIENT_CAPITAL", "Paper cash is insufficient for short margin — Add ₹25k", 422);
      }
      // Debit margin+fees, credit sale proceeds → net = cash - margin - fees + notional
      const nextCash = d(fresh.cash).minus(margin).minus(fees).plus(notional);
      await tx
        .update(paperAccounts)
        .set({ cash: money(nextCash), updatedAt: new Date() })
        .where(eq(paperAccounts.id, fresh.id));

      const [order] = await tx
        .insert(orders)
        .values({
          executionMode: "PAPER",
          accountId: fresh.id,
          exchange: input.exchange,
          symbol: input.symbol,
          side: "SELL",
          quantity: input.quantity,
          filledQuantity: input.quantity,
          orderType: "MARKET",
          averagePrice: money(fill, 4),
          status: "FILLED",
          fees: money(fees, 4),
        })
        .returning();

      await tx.insert(executions).values({
        orderId: order!.id,
        quantity: input.quantity,
        price: money(fill, 4),
        fees: money(fees, 4),
      });

      const [pos] = await tx
        .insert(positions)
        .values({
          executionMode: "PAPER",
          accountId: fresh.id,
          exchange: input.exchange,
          symbol: input.symbol,
          direction: "SHORT",
          quantity: String(input.quantity),
          averageEntry: money(fill, 4),
          currentPrice: money(fill, 4),
          stopLoss: null,
          targets: [],
          unrealisedPnl: "0",
          fees: money(fees, 4),
          status: "OPEN",
          meta: { ...(input.meta ?? {}), margin: money(margin) },
        })
        .returning();

      return {
        positionId: pos!.id,
        fillPx: money(fill, 4),
        fees: money(fees, 4),
        accountId: fresh.id,
      };
    });
  }

  async submit(trade: ApprovedTrade): Promise<ExecutionAcknowledgement> {
    if (trade.executionMode !== "PAPER") {
      throw new AppError("MODE_MISMATCH", "Paper adapter received a live trade", 500);
    }
    const fill = await this.buyLong({
      exchange: trade.instrument.exchange,
      symbol: trade.instrument.symbol,
      quantity: trade.quantity,
      meta: { intentId: trade.intentId, approvalId: trade.approvalId },
    });
    return { attemptId: fill.positionId, status: "FILLED", message: "Paper fill" };
  }

  async closePosition(positionId: string, reason: string): Promise<PaperCloseResult> {
    const [pos] = await this.db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
    if (!pos || pos.status === "CLOSED") throw new AppError("POSITION_NOT_OPEN", "Position is not open", 404);
    if (pos.executionMode !== "PAPER") throw new AppError("MODE_MISMATCH", "Not a paper position", 400);
    const quote = await this.quote(pos.exchange, pos.symbol);
    const px = d(quote?.lastPrice ?? pos.currentPrice ?? pos.averageEntry);
    const exit = pos.direction === "LONG" ? px.mul(d(1).minus(SLIPPAGE)) : px.mul(d(1).plus(SLIPPAGE));
    const qty = d(pos.quantity);
    const pnl =
      pos.direction === "LONG" ? exit.minus(pos.averageEntry).mul(qty) : d(pos.averageEntry).minus(exit).mul(qty);
    const fees = exit.mul(qty).mul(FEE_BPS);
    const net = pnl.minus(fees);
    const marginHeld = d(String((pos.meta as { margin?: string } | null)?.margin ?? "0"));

    await this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          executionMode: "PAPER",
          accountId: pos.accountId,
          exchange: pos.exchange,
          symbol: pos.symbol,
          side: pos.direction === "LONG" ? "SELL" : "BUY",
          quantity: Number(pos.quantity),
          filledQuantity: Number(pos.quantity),
          orderType: "MARKET",
          averagePrice: money(exit, 4),
          status: "FILLED",
          fees: money(fees, 4),
        })
        .returning();
      await tx.insert(executions).values({
        orderId: order!.id,
        quantity: Number(pos.quantity),
        price: money(exit, 4),
        fees: money(fees, 4),
      });
      await tx
        .update(positions)
        .set({
          status: "CLOSED",
          closeReason: reason,
          currentPrice: money(exit, 4),
          realisedPnl: money(d(pos.realisedPnl).plus(net), 4),
          unrealisedPnl: "0",
          fees: money(d(pos.fees).plus(fees), 4),
          closedAt: new Date(),
        })
        .where(eq(positions.id, positionId));
      const [account] = await tx.select().from(paperAccounts).limit(1);
      if (account) {
        // LONG close: credit sale. SHORT cover: debit buyback, release margin.
        const delta =
          pos.direction === "LONG"
            ? exit.mul(qty).minus(fees)
            : marginHeld.minus(exit.mul(qty)).minus(fees);
        await tx
          .update(paperAccounts)
          .set({ cash: money(d(account.cash).plus(delta)), updatedAt: new Date() })
          .where(eq(paperAccounts.id, account.id));
      }
    });

    return {
      positionId,
      exchange: pos.exchange,
      symbol: pos.symbol,
      quantity: String(pos.quantity),
      entry: String(pos.averageEntry),
      exit: money(exit, 4),
      netPnl: money(net, 4),
      fees: money(fees, 4),
      meta: (pos.meta ?? {}) as Record<string, unknown>,
      reason,
    };
  }

  async markToMarket(): Promise<void> {
    const open = await this.db.select().from(positions).where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")));
    for (const pos of open) {
      const quote = await this.quote(pos.exchange, pos.symbol);
      if (!quote) continue;
      const px = d(quote.lastPrice);
      const pnl =
        pos.direction === "LONG"
          ? px.minus(pos.averageEntry).mul(pos.quantity)
          : d(pos.averageEntry).minus(px).mul(pos.quantity);
      await this.db
        .update(positions)
        .set({ currentPrice: money(px, 4), unrealisedPnl: money(pnl, 4) })
        .where(eq(positions.id, pos.id));
    }
  }

  async openSymbols(): Promise<Set<string>> {
    const open = await this.db
      .select({ exchange: positions.exchange, symbol: positions.symbol })
      .from(positions)
      .where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")));
    const held = new Set<string>();
    for (const row of open) {
      const s = row.symbol.toUpperCase();
      held.add(s);
      held.add(`${row.exchange.toUpperCase()}:${s}`);
    }
    return held;
  }

  private async quote(exchange: string, symbol: string) {
    const [row] = await this.db
      .select()
      .from(quotesCache)
      .where(and(eq(quotesCache.exchange, exchange), eq(quotesCache.symbol, symbol)))
      .limit(1);
    if (!row) return null;
    return { lastPrice: String(row.lastPrice), bid: row.bid, ask: row.ask, receivedAt: row.receivedAt };
  }
}
