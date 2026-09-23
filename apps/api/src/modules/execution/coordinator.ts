import { AppError, type ExecutionMode, type InstrumentType, type TradeIntent } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import type { PaperExecutionAdapter } from "./paper-adapter.js";
import type { PaperTrainer } from "./paper-trainer.js";
import type { ZerodhaOrderAdapter } from "./zerodha-order-adapter.js";
import type { RiskService } from "../risk/service.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { JournalService } from "../journal/service.js";
import type { MarketDataService } from "../market/service.js";
import { PAPER_TOPUP } from "./paper-adapter.js";
import { marketBlocksPaper } from "../forecast/chain-tape.js";

/** Analysis desk: paper training allowed; live broker orders never. */
export class ExecutionCoordinator {
  constructor(
    private readonly _db: Database,
    private readonly risk: RiskService,
    private readonly paper: PaperExecutionAdapter,
    private readonly _live: ZerodhaOrderAdapter,
    private readonly _gate: LiveGate,
    private readonly journal: JournalService,
    private readonly _market: MarketDataService,
    private readonly trainer: PaperTrainer,
  ) {}

  private assertPaperOpen() {
    if (marketBlocksPaper()) {
      throw new AppError("MARKET_CLOSED", "Paper trading is blocked while the market is closed.", 403);
    }
  }

  async propose(_input: {
    accountId: string;
    intent: TradeIntent;
    source: string;
    executionMode: ExecutionMode;
    requestedQuantity?: number;
  }) {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async approveAndExecute(_approvalId: string, _userId: string) {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async autoExecute(_input: {
    accountId: string;
    intent: TradeIntent;
    source: string;
    executionMode: ExecutionMode;
  }) {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async paperManual(input: {
    exchange: string;
    symbol: string;
    quantity: number;
    lane: "FNO" | "CASH";
    kind: string;
    side?: "BUY" | "SELL";
    regime?: string;
    prediction?: {
      eodSpot?: string | null;
      eodPremium?: string | null;
      entrySpot?: string | null;
      compareTag?: string | null;
      aiConfidence?: number | null;
      why?: string | null;
    };
  }) {
    this.assertPaperOpen();
    return this.trainer.open({ ...input, source: "manual-train", side: input.side ?? "BUY" });
  }

  async paperFromAdvice(_input: {
    accountId: string;
    exchange: string;
    symbol: string;
    side: "BUY" | "SELL";
    instrumentType?: InstrumentType;
  }) {
    throw new AppError("ORDERING_DISABLED", "Use /api/paper/buy with quantity and prediction snapshot.", 403);
  }

  async closePaperAndLearn(id: string, reason: string) {
    this.assertPaperOpen();
    return this.trainer.sell(id, reason);
  }

  async paperTopup() {
    this.assertPaperOpen();
    const account = await this.paper.topup(PAPER_TOPUP);
    await this.journal.record({
      executionMode: "PAPER",
      instrument: "WALLET",
      source: "paper-topup",
      decision: "PAPER_TOPUP",
      snapshot: { amount: PAPER_TOPUP, cash: account.cash },
    });
    return account;
  }

  async paperReset() {
    this.assertPaperOpen();
    const account = await this.paper.reset();
    await this.journal.record({
      executionMode: "PAPER",
      instrument: "WALLET",
      source: "paper-reset",
      decision: "PAPER_RESET",
      snapshot: { cash: account.cash },
    });
    return account;
  }

  async reject(id: string) {
    return this.risk.rejectApproval(id);
  }

  async paperState() {
    return this.paper.state();
  }
}
