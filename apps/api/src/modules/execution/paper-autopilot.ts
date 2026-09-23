import type { Logger } from "../../config/logger.js";
import type { Database } from "../../db/client.js";
import type { PlainIdea } from "../forecast/desk.js";
import type { PaperExecutionAdapter } from "./paper-adapter.js";
import { paperAutopilotEnabled, PaperTrainer, stockTrainQty } from "./paper-trainer.js";

const MAX_OPEN = 3;

type BoardLike = {
  buys: Array<{
    contract: string;
    exchange: string;
    kind: string;
    why?: string | null;
  }>;
  rows: Array<{
    ce: {
      symbol: string;
      exchange?: string;
      mark: string;
      lastPrice: string | null;
      eodPremium?: string | null;
      lotSize?: number;
      why?: string;
      heldSide?: "LONG" | "SHORT" | null;
    } | null;
    pe: {
      symbol: string;
      exchange?: string;
      mark: string;
      lastPrice: string | null;
      eodPremium?: string | null;
      lotSize?: number;
      why?: string;
      heldSide?: "LONG" | "SHORT" | null;
    } | null;
  }>;
  lastPrice?: string | null;
  eod?: { close: string } | null;
  ai?: { confidence?: number | null } | null;
  compare?: { tag?: string } | null;
  desk?: { clock?: string; regime?: string } | null;
};

type StocksLike = {
  buys: PlainIdea[];
  sells: PlainIdea[];
};

/** Local Autopilot: BUY/SELL paper only from Algo+AI marks. Never touches Zerodha. */
export class PaperAutopilot {
  constructor(
    private readonly db: Database,
    private readonly paper: PaperExecutionAdapter,
    private readonly trainer: PaperTrainer,
    private readonly log: Logger,
  ) {}

  async onOptionsBoard(board: BoardLike): Promise<void> {
    if (!(await paperAutopilotEnabled(this.db))) return;

    const compare = board.compare?.tag ?? "";
    const aligned = ["ALIGNED", "LEAN", "MATCH", "NEAR"].includes(compare);
    const state = await this.paper.state();
    const open = await this.paper.openSymbols();

    await this.sellOptionsNoLongerBuy(board, state.positions);

    if (state.positions.length >= MAX_OPEN) return;

    // Open shorts on WRITE/SELL marks when Algo+AI aligned or opposed (writes often work when leaning opposite).
    for (const row of board.rows) {
      for (const leg of [row.ce, row.pe]) {
        if (!leg || leg.mark !== "SELL" || !leg.lastPrice) continue;
        if (leg.heldSide) continue;
        const key = `${leg.exchange}:${leg.symbol}`.toUpperCase();
        if (open.has(leg.symbol.toUpperCase()) || open.has(key)) continue;
        const lot = Math.max(1, Number(leg.lotSize ?? 1));
        const kind = /PE$/i.test(leg.symbol) ? "PE" : "CE";
        try {
          await this.trainer.open({
            exchange: leg.exchange ?? "NFO",
            symbol: leg.symbol,
            quantity: lot,
            lane: "FNO",
            kind,
            side: "SELL",
            regime: board.desk?.regime ?? "UNKNOWN",
            source: "autopilot",
            prediction: {
              eodSpot: board.eod?.close ?? null,
              eodPremium: leg.eodPremium ?? null,
              entrySpot: board.lastPrice ?? null,
              compareTag: compare,
              aiConfidence: board.ai?.confidence ?? null,
              why: leg.why ?? null,
            },
          });
          this.log.info({ symbol: leg.symbol }, "paper autopilot SELL open");
          return;
        } catch (err) {
          this.log.debug({ err, symbol: leg.symbol }, "paper autopilot sell skipped");
        }
      }
    }

    if (!aligned) return;

    for (const idea of board.buys.slice(0, 4)) {
      const key = `${idea.exchange}:${idea.contract}`.toUpperCase();
      if (open.has(idea.contract.toUpperCase()) || open.has(key)) continue;
      const leg = board.rows.flatMap((r) => [r.ce, r.pe]).find((l) => l?.symbol === idea.contract);
      if (!leg || leg.mark !== "BUY" || !leg.lastPrice) continue;
      const lot = Math.max(1, Number(leg.lotSize ?? 1));
      try {
        await this.trainer.open({
          exchange: idea.exchange,
          symbol: idea.contract,
          quantity: lot,
          lane: "FNO",
          kind: idea.kind,
          side: "BUY",
          regime: board.desk?.regime ?? "UNKNOWN",
          source: "autopilot",
          prediction: {
            eodSpot: board.eod?.close ?? null,
            eodPremium: leg.eodPremium ?? null,
            entrySpot: board.lastPrice ?? null,
            compareTag: compare,
            aiConfidence: board.ai?.confidence ?? null,
            why: idea.why ?? leg.why ?? null,
          },
        });
        this.log.info({ symbol: idea.contract }, "paper autopilot BUY");
        break;
      } catch (err) {
        this.log.debug({ err, symbol: idea.contract }, "paper autopilot buy skipped");
      }
    }
  }

  async onStocksDesk(desk: StocksLike): Promise<void> {
    if (!(await paperAutopilotEnabled(this.db))) return;

    const state = await this.paper.state();
    const buySet = new Set(desk.buys.map((b) => b.contract.toUpperCase()));

    for (const pos of state.positions) {
      if (/CE$|PE$|FUT$/i.test(pos.symbol)) continue;
      if (!buySet.has(pos.symbol.toUpperCase())) {
        try {
          await this.trainer.sell(pos.id, "MARK_LEFT");
          this.log.info({ symbol: pos.symbol }, "paper autopilot SELL stock");
        } catch (err) {
          this.log.debug({ err, symbol: pos.symbol }, "paper autopilot stock sell skipped");
        }
      }
    }

    if (state.positions.length >= MAX_OPEN) return;
    const open = await this.paper.openSymbols();
    const cash = String(state.account.cash);
    for (const idea of desk.buys.slice(0, 2)) {
      if (open.has(idea.contract.toUpperCase())) continue;
      const px = idea.lastPrice ?? idea.premium;
      if (!px) continue;
      const qty = stockTrainQty(cash, px);
      if (qty <= 0) continue;
      try {
        await this.trainer.open({
          exchange: idea.exchange,
          symbol: idea.contract,
          quantity: qty,
          lane: "CASH",
          kind: idea.kind,
          side: "BUY",
          regime: "UNKNOWN",
          source: "autopilot",
          prediction: {
            eodSpot: idea.target ?? null,
            entrySpot: px,
            why: idea.why,
          },
        });
        this.log.info({ symbol: idea.contract, qty }, "paper autopilot BUY stock");
        break;
      } catch (err) {
        this.log.debug({ err, symbol: idea.contract }, "paper autopilot stock buy skipped");
      }
    }
  }

  private async sellOptionsNoLongerBuy(
    board: BoardLike,
    openPos: Array<{ id: string; symbol: string; direction?: string }>,
  ): Promise<void> {
    const bySym = new Map<string, { mark: string; heldSide?: "LONG" | "SHORT" | null }>();
    for (const row of board.rows) {
      for (const leg of [row.ce, row.pe]) {
        if (leg) bySym.set(leg.symbol.toUpperCase(), { mark: leg.mark, heldSide: leg.heldSide });
      }
    }
    const clock = board.desk?.clock ?? "";
    const cutoff = /CLOSED|PRE-OPEN/i.test(clock) || clock === "AFTER 15:30";

    for (const pos of openPos) {
      if (!/CE$|PE$/i.test(pos.symbol)) continue;
      const leg = bySym.get(pos.symbol.toUpperCase());
      const dir = pos.direction ?? "LONG";
      if (dir === "SHORT") {
        if (!leg || leg.mark === "BUY" || cutoff) {
          try {
            await this.trainer.sell(pos.id, leg?.mark === "BUY" ? "COVER" : "SESSION_CUTOFF");
            this.log.info({ symbol: pos.symbol }, "paper autopilot COVER short");
          } catch (err) {
            this.log.debug({ err, symbol: pos.symbol }, "paper autopilot cover skipped");
          }
        }
        continue;
      }
      const stillBuy = leg?.mark === "BUY";
      if (stillBuy && !cutoff) continue;
      try {
        await this.trainer.sell(pos.id, stillBuy ? "SESSION_CUTOFF" : "MARK_LEFT");
        this.log.info({ symbol: pos.symbol }, "paper autopilot SELL option");
      } catch (err) {
        this.log.debug({ err, symbol: pos.symbol }, "paper autopilot option sell skipped");
      }
    }
  }
}
