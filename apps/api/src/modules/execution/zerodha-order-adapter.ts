import { AppError, type ApprovedCancellation, type ApprovedTrade, type ExecutionAcknowledgement, type ReconciliationResult } from "@xtrader/domain";
import type { KiteGateway } from "../brokers/zerodha/kite-gateway.js";
import type { ZerodhaAuthService } from "../brokers/zerodha/auth-service.js";
import type { LiveGate } from "../settings/live-gate.js";

export class ZerodhaOrderAdapter {
  constructor(
    private readonly auth: ZerodhaAuthService,
    private readonly kite: KiteGateway,
    private readonly gate: LiveGate,
  ) {}

  async submit(trade: ApprovedTrade): Promise<ExecutionAcknowledgement> {
    await this.gate.assertLiveAllowed();
    if (trade.executionMode !== "LIVE") {
      throw new AppError("MODE_MISMATCH", "Live adapter received a paper trade", 500);
    }
    const access = await this.auth.getAccessToken();
    if (!access) throw new AppError("BROKER_DISCONNECTED", "Zerodha is not connected", 401);
    const result = await this.kite.placeOrder(access.token, "regular", {
      exchange: trade.instrument.exchange,
      tradingsymbol: trade.instrument.symbol,
      transaction_type: trade.direction === "LONG" ? "BUY" : "SELL",
      quantity: trade.quantity,
      order_type: trade.entryType === "MARKET" ? "MARKET" : "LIMIT",
      product: "MIS",
      price: trade.entryType === "LIMIT" ? Number(trade.entryPrice) : undefined,
      validity: "DAY",
      tag: trade.approvalId.slice(0, 20),
      market_protection: trade.entryType === "MARKET" ? -1 : undefined,
    });
    return { attemptId: trade.approvalId, status: "ACKNOWLEDGED", brokerOrderId: result.order_id };
  }

  async cancel(action: ApprovedCancellation): Promise<ExecutionAcknowledgement> {
    await this.gate.assertLiveAllowed();
    const access = await this.auth.getAccessToken();
    if (!access) throw new AppError("BROKER_DISCONNECTED", "Zerodha is not connected", 401);
    const result = await this.kite.cancelOrder(access.token, "regular", action.orderId);
    return { attemptId: action.approvalId, status: "CANCEL_PENDING", brokerOrderId: result.order_id };
  }

  async reconcile(): Promise<ReconciliationResult> {
    return { matched: 0, discrepancies: [] };
  }
}
