import { AppError, type ExecutionMode, type InstrumentType, type TradeIntent } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import type { PaperExecutionAdapter } from "./paper-adapter.js";
import type { ZerodhaOrderAdapter } from "./zerodha-order-adapter.js";
import type { RiskService } from "../risk/service.js";
import type { LiveGate } from "../settings/live-gate.js";
import type { JournalService } from "../journal/service.js";
import type { MarketDataService } from "../market/service.js";

/** Analysis desk: risk helpers remain, but no order path is live. */
export class ExecutionCoordinator {
  constructor(
    private readonly _db: Database,
    private readonly risk: RiskService,
    private readonly _paper: PaperExecutionAdapter,
    private readonly _live: ZerodhaOrderAdapter,
    private readonly _gate: LiveGate,
    private readonly _journal: JournalService,
    private readonly _market: MarketDataService,
  ) {}

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

  async paperManual(_input: {
    accountId: string;
    exchange: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    orderType: "MARKET" | "LIMIT";
    price?: string;
  }) {
    throw new AppError("ORDERING_DISABLED", "Paper trading is disabled. Analysis desk only.", 403);
  }

  async paperFromAdvice(_input: {
    accountId: string;
    exchange: string;
    symbol: string;
    side: "BUY" | "SELL";
    instrumentType?: InstrumentType;
  }) {
    throw new AppError("ORDERING_DISABLED", "Paper trading is disabled. Analysis desk only.", 403);
  }

  async closePaperAndLearn(_id: string, _reason: string) {
    throw new AppError("ORDERING_DISABLED", "Paper trading is disabled. Analysis desk only.", 403);
  }

  async reject(id: string) {
    return this.risk.rejectApproval(id);
  }

  async paperState() {
    return { account: null, positions: [] as unknown[], orders: [] as unknown[] };
  }
}
