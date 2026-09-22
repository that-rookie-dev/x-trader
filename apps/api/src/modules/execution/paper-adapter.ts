import { and, eq } from "drizzle-orm";
import { AppError, d, money, type ApprovedTrade, type ExecutionAcknowledgement } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { executions, orders, paperAccounts, positions, quotesCache } from "../../db/schema.js";

const SLIPPAGE = d("0.0005");
const FEE_BPS = d("0.0003");

export class PaperExecutionAdapter {
  constructor(private readonly db: Database) {}

  async submit(trade: ApprovedTrade): Promise<ExecutionAcknowledgement> {
    if (trade.executionMode !== "PAPER") {
      throw new AppError("MODE_MISMATCH", "Paper adapter received a live trade", 500);
    }
    const quote = await this.quote(trade.instrument.exchange, trade.instrument.symbol);
    if (!quote) throw new AppError("NO_QUOTE", "No market data to fill the paper order", 422);

    const last = d(quote.lastPrice);
    let fill = last;
    if (trade.direction === "LONG") {
      fill = last.mul(d(1).plus(SLIPPAGE));
      if (trade.entryType === "LIMIT" && fill.gt(d(trade.entryPrice))) {
        fill = d(trade.entryPrice);
        if (last.gt(d(trade.entryPrice))) {
          const [order] = await this.db
            .insert(orders)
            .values({
              executionMode: "PAPER",
              accountId: trade.accountId,
              intentId: trade.intentId,
              exchange: trade.instrument.exchange,
              symbol: trade.instrument.symbol,
              side: "BUY",
              quantity: trade.quantity,
              orderType: "LIMIT",
              limitPrice: trade.entryPrice,
              status: "ACKNOWLEDGED",
            })
            .returning();
          return { attemptId: order!.id, status: "ACKNOWLEDGED", message: "Limit resting; last price above limit" };
        }
      }
    }

    const notional = fill.mul(trade.quantity);
    const fees = notional.mul(FEE_BPS);
    const cashNeeded = notional.plus(fees);

    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(paperAccounts).limit(1);
      if (!account) throw new AppError("NO_PAPER_ACCOUNT", "Paper account missing", 500);
      if (d(account.cash).lt(cashNeeded)) {
        throw new AppError("INSUFFICIENT_CAPITAL", "Paper cash is insufficient", 422);
      }
      await tx
        .update(paperAccounts)
        .set({
          cash: money(d(account.cash).minus(cashNeeded)),
          updatedAt: new Date(),
        })
        .where(eq(paperAccounts.id, account.id));

      const [order] = await tx
        .insert(orders)
        .values({
          executionMode: "PAPER",
          accountId: trade.accountId,
          intentId: trade.intentId,
          exchange: trade.instrument.exchange,
          symbol: trade.instrument.symbol,
          side: trade.direction === "LONG" ? "BUY" : "SELL",
          quantity: trade.quantity,
          filledQuantity: trade.quantity,
          orderType: trade.entryType,
          limitPrice: trade.entryPrice,
          averagePrice: money(fill, 4),
          status: "FILLED",
          fees: money(fees, 4),
        })
        .returning();

      await tx.insert(executions).values({
        orderId: order!.id,
        quantity: trade.quantity,
        price: money(fill, 4),
        fees: money(fees, 4),
      });

      await tx.insert(positions).values({
        executionMode: "PAPER",
        accountId: trade.accountId,
        exchange: trade.instrument.exchange,
        symbol: trade.instrument.symbol,
        direction: trade.direction,
        quantity: String(trade.quantity),
        averageEntry: money(fill, 4),
        currentPrice: money(fill, 4),
        stopLoss: trade.stopLoss,
        targets: trade.targets,
        unrealisedPnl: "0",
        fees: money(fees, 4),
        status: "OPEN",
      });

      return { attemptId: order!.id, status: "FILLED", message: "Paper fill" };
    });
  }

  async closePosition(positionId: string, reason: string): Promise<void> {
    const [pos] = await this.db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
    if (!pos || pos.status === "CLOSED") throw new AppError("POSITION_NOT_OPEN", "Position is not open", 404);
    if (pos.executionMode !== "PAPER") throw new AppError("MODE_MISMATCH", "Not a paper position", 400);
    const quote = await this.quote(pos.exchange, pos.symbol);
    const px = d(quote?.lastPrice ?? pos.currentPrice ?? pos.averageEntry);
    const exit = pos.direction === "LONG" ? px.mul(d(1).minus(SLIPPAGE)) : px.mul(d(1).plus(SLIPPAGE));
    const qty = d(pos.quantity);
    const pnl = exit.minus(pos.averageEntry).mul(qty);
    const fees = exit.mul(qty).mul(FEE_BPS);
    const net = pnl.minus(fees);

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
        const proceeds = exit.mul(qty).minus(fees);
        await tx
          .update(paperAccounts)
          .set({ cash: money(d(account.cash).plus(proceeds)), updatedAt: new Date() })
          .where(eq(paperAccounts.id, account.id));
      }
    });
  }

  async markToMarket(): Promise<void> {
    const open = await this.db.select().from(positions).where(and(eq(positions.executionMode, "PAPER"), eq(positions.status, "OPEN")));
    for (const pos of open) {
      const quote = await this.quote(pos.exchange, pos.symbol);
      if (!quote) continue;
      const px = d(quote.lastPrice);
      const pnl = px.minus(pos.averageEntry).mul(pos.quantity);
      await this.db
        .update(positions)
        .set({ currentPrice: money(px, 4), unrealisedPnl: money(pnl, 4) })
        .where(eq(positions.id, pos.id));
    }
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
