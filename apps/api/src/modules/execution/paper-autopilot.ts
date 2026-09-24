import type { Logger } from "../../config/logger.js";
import type { Database } from "../../db/client.js";
import { appSettings } from "../../db/schema.js";
import type { PlainIdea } from "../forecast/desk.js";
import { optionPnl } from "../forecast/charges.js";
import { estimateOptionEod } from "../forecast/eod.js";
import { horizonTarget } from "../forecast/horizons.js";
import type { PaperExecutionAdapter } from "./paper-adapter.js";
import { paperAutopilotEnabled, PaperTrainer } from "./paper-trainer.js";

const MAX_OPEN = 3;
/** Cut a long option once a quarter of the premium is gone. */
export const PAPER_PREMIUM_STOP = 0.75;
/** Hard rupee cap on one open paper option, checked against unrealised P&L. */
export const PAPER_RUPEE_STOP = 2000;
/** Stop opening new paper trades once today's book is down this much. */
export const PAPER_DAY_STOP = 3000;

const BLOCKED_COMPARE = new Set(["OPPOSED", "MIXED", "STRETCH"]);

export function shouldCutLong(input: {
  entry: number;
  last: number;
  unrealised: number;
  mark?: string | null;
  cutoff: boolean;
  targetAt?: string | null;
  now?: Date;
}): string | null {
  if (input.cutoff) return "SESSION_CUTOFF";
  if (input.targetAt && (input.now ?? new Date()).getTime() >= new Date(input.targetAt).getTime()) return "HORIZON";
  if (input.entry > 0 && input.last > 0 && input.last <= input.entry * PAPER_PREMIUM_STOP) return "PREMIUM_STOP";
  if (input.unrealised <= -PAPER_RUPEE_STOP) return "RUPEE_STOP";
  if (input.mark != null && input.mark !== "BUY") return "MARK_LEFT";
  return null;
}

export function pickPaperBuy<T extends { edge?: string | null }>(buys: T[], compare: string): T | null {
  if (BLOCKED_COMPARE.has(compare)) return null;
  const ranked = buys
    .map((buy) => ({ buy, net: Number(buy.edge) }))
    .filter((row) => Number.isFinite(row.net) && row.net > 0)
    .sort((a, b) => b.net - a.net);
  return ranked[0]?.buy ?? null;
}

type BoardLike = {
  symbol?: string;
  exchange?: string;
  buys: Array<{
    contract: string;
    exchange: string;
    kind: string;
    why?: string | null;
    edge?: string | null;
  }>;
  rows: Array<{
    strike: number;
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
  expiry?: string | null;
  future?: { lastPrice?: string | null } | null;
  horizons?: Array<{ id: string; close: string; targetAt: string; abstain: boolean; floorScale: number }>;
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
  private lastBuyAt = 0;

  constructor(
    private readonly db: Database,
    private readonly paper: PaperExecutionAdapter,
    private readonly trainer: PaperTrainer,
    private readonly log: Logger,
  ) {}

  async readFocus(): Promise<{ exchange: string; symbol: string } | null> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row?.activeOptionsExchange || !row.activeOptionsSymbol) return null;
    return { exchange: row.activeOptionsExchange, symbol: row.activeOptionsSymbol };
  }

  async onOptionsBoard(board: BoardLike, allowBuy = false): Promise<void> {
    if (!(await paperAutopilotEnabled(this.db))) return;

    const compare = board.compare?.tag ?? "";
    const state = await this.paper.state();

    await this.sellOptionsNoLongerBuy(board, state.positions);

    if (!allowBuy) return;
    if (Date.now() - this.lastBuyAt < 3 * 60 * 1000) return;
    if (sessionPnl(state) <= -PAPER_DAY_STOP) return;
    if (state.positions.length >= MAX_OPEN) return;

    const open = await this.paper.openSymbols();
    const idea = pickPaperBuy(board.buys, compare);
    if (!idea) return;
    const key = `${idea.exchange}:${idea.contract}`.toUpperCase();
    if (open.has(idea.contract.toUpperCase()) || open.has(key)) return;
    const leg = board.rows.flatMap((r) => [r.ce, r.pe]).find((l) => l?.symbol === idea.contract);
    if (!leg || leg.mark !== "BUY" || !leg.lastPrice) return;
    const lot = Math.max(1, Number(leg.lotSize ?? 1));
    const hold = board.horizons?.find((row) => row.id === "15m");
    let exitPremium = leg.eodPremium ?? null;
    let targetAt = horizonTarget(new Date(), "15m").at.toISOString();
    if (hold) {
      if (hold.abstain) return;
      const row = board.rows.find((item) => item.ce?.symbol === idea.contract || item.pe?.symbol === idea.contract);
      if (!row) return;
      const kind = row.ce?.symbol === idea.contract ? "CE" : "PE";
      const est = estimateOptionEod({
        kind,
        strike: row.strike,
        spot: Number(board.lastPrice),
        eodSpot: Number(hold.close),
        premium: Number(leg.lastPrice),
        expiry: board.expiry ?? null,
        targetAt: new Date(hold.targetAt),
        futurePx: board.future?.lastPrice != null ? Number(board.future.lastPrice) : null,
      });
      const net = Number(optionPnl({ entry: Number(leg.lastPrice), exit: Number(est.eodPremium), qty: lot }).net);
      if (!(net >= 150 * hold.floorScale)) return;
      exitPremium = est.eodPremium;
      targetAt = hold.targetAt;
    }
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
          eodSpot: hold?.close ?? board.eod?.close ?? null,
          eodPremium: exitPremium,
          entrySpot: board.lastPrice ?? null,
          compareTag: compare,
          aiConfidence: board.ai?.confidence ?? null,
          why: idea.why ?? leg.why ?? null,
          horizon: "15m",
          targetAt,
        },
      });
      this.lastBuyAt = Date.now();
      this.log.info({ symbol: idea.contract, edge: idea.edge }, "paper autopilot BUY");
    } catch (err) {
      this.log.debug({ err, symbol: idea.contract }, "paper autopilot buy skipped");
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

  }

  private async sellOptionsNoLongerBuy(
    board: BoardLike,
    openPos: Array<{
      id: string;
      symbol: string;
      direction?: string;
      averageEntry?: string | null;
      currentPrice?: string | null;
      unrealisedPnl?: string | null;
      meta?: unknown;
    }>,
  ): Promise<void> {
    const bySym = new Map<string, { mark: string; lastPrice: string | null }>();
    for (const row of board.rows) {
      for (const leg of [row.ce, row.pe]) {
        if (leg) bySym.set(leg.symbol.toUpperCase(), { mark: leg.mark, lastPrice: leg.lastPrice });
      }
    }
    const clock = board.desk?.clock ?? "";
    const cutoff = /CLOSED|PRE-OPEN/i.test(clock) || clock === "AFTER 15:30";

    for (const pos of openPos) {
      if (!/CE$|PE$/i.test(pos.symbol)) continue;
      const leg = bySym.get(pos.symbol.toUpperCase());
      const dir = pos.direction ?? "LONG";
      if (dir === "SHORT") {
        try {
          await this.trainer.sell(pos.id, "COVER");
          this.log.info({ symbol: pos.symbol }, "paper autopilot COVER short");
        } catch (err) {
          this.log.debug({ err, symbol: pos.symbol }, "paper autopilot cover skipped");
        }
        continue;
      }
      const last = Number(leg?.lastPrice ?? pos.currentPrice ?? 0);
      const pred = (pos.meta as { prediction?: { targetAt?: string } } | null)?.prediction;
      const reason = shouldCutLong({
        entry: Number(pos.averageEntry ?? 0),
        last,
        unrealised: Number(pos.unrealisedPnl ?? 0),
        mark: leg?.mark,
        cutoff,
        targetAt: pred?.targetAt ?? null,
      });
      if (!reason) continue;
      try {
        await this.trainer.sell(pos.id, reason);
        this.log.info({ symbol: pos.symbol, reason }, "paper autopilot SELL option");
      } catch (err) {
        this.log.debug({ err, symbol: pos.symbol }, "paper autopilot option sell skipped");
      }
    }
  }
}

function sessionPnl(state: {
  positions: Array<{ unrealisedPnl?: string | null }>;
  closed: Array<{ closedAt?: Date | null; realisedPnl?: string | null }>;
}): number {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  let pnl = 0;
  for (const pos of state.positions) pnl += Number(pos.unrealisedPnl ?? 0);
  for (const pos of state.closed) {
    const day = pos.closedAt ? new Date(pos.closedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
    if (day === today) pnl += Number(pos.realisedPnl ?? 0);
  }
  return pnl;
}
