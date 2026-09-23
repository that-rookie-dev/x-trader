import { AppError, type ApprovedCancellation, type ApprovedTrade, type ExecutionAcknowledgement, type ReconciliationResult } from "@xtrader/domain";

/** Dead adapter — analysis desk never sends broker orders. */
export class ZerodhaOrderAdapter {
  async submit(_trade: ApprovedTrade): Promise<ExecutionAcknowledgement> {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async cancel(_action: ApprovedCancellation): Promise<ExecutionAcknowledgement> {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async reconcile(): Promise<ReconciliationResult> {
    return { matched: 0, discrepancies: [] };
  }
}
