import { AppError } from "@xtrader/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appSettings } from "../../db/schema.js";
import type { PaperExecutionAdapter } from "../execution/paper-adapter.js";

export type PredictionModeSetting = "ALGO" | "AI";

function asPredictionMode(raw: string | null | undefined): PredictionModeSetting {
  return raw === "AI" ? "AI" : "ALGO";
}

/** Desk settings: halt + AI profile + paper Autopilot + prediction mode. Ordering is never enabled. */
export class LiveGate {
  constructor(
    private readonly db: Database,
    private readonly paper?: PaperExecutionAdapter,
  ) {}

  async snapshot() {
    const [settings] = await this.db.select().from(appSettings).limit(1);
    let paperCash: string | null = null;
    let paperOpenCount = 0;
    if (this.paper) {
      try {
        const state = await this.paper.state();
        paperCash = String(state.account.cash);
        paperOpenCount = state.positions.length;
      } catch {
        paperCash = null;
      }
    }
    return {
      haltActive: settings?.haltActive ?? false,
      haltPolicy: settings?.haltPolicy ?? "MAINTAIN",
      haltReason: settings?.haltReason ?? null,
      activeAiProfileId: settings?.activeAiProfileId ?? null,
      paperAutopilot: settings?.paperAutopilot ?? false,
      activeOptionsExchange: settings?.activeOptionsExchange ?? null,
      activeOptionsSymbol: settings?.activeOptionsSymbol ?? null,
      predictionMode: asPredictionMode(settings?.predictionMode),
      paperCash,
      paperOpenCount,
      deskMode: "ANALYSIS" as const,
      ordersEnabled: false as const,
    };
  }

  /** Hard refuse — this product never places broker orders. */
  async assertLiveAllowed(): Promise<void> {
    throw new AppError("ORDERING_DISABLED", "xTrader never places orders. Execute on Zerodha.", 403);
  }

  async ensureRow(): Promise<void> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) {
      await this.db.insert(appSettings).values({ id: 1 });
    }
  }

  async patch(input: Partial<{
    haltActive: boolean;
    haltPolicy: string;
    haltReason: string | null;
    activeAiProfileId: string | null;
    paperAutopilot: boolean;
    predictionMode: PredictionModeSetting;
    activeOptionsExchange: string | null;
    activeOptionsSymbol: string | null;
  }>) {
    await this.ensureRow();
    await this.db
      .update(appSettings)
      .set({
        ...(input.haltActive != null ? { haltActive: input.haltActive } : {}),
        ...(input.haltPolicy ? { haltPolicy: input.haltPolicy } : {}),
        ...(input.haltReason !== undefined ? { haltReason: input.haltReason } : {}),
        ...(input.activeAiProfileId !== undefined ? { activeAiProfileId: input.activeAiProfileId } : {}),
        ...(input.paperAutopilot != null ? { paperAutopilot: input.paperAutopilot } : {}),
        ...(input.activeOptionsExchange !== undefined ? { activeOptionsExchange: input.activeOptionsExchange } : {}),
        ...(input.activeOptionsSymbol !== undefined ? { activeOptionsSymbol: input.activeOptionsSymbol } : {}),
        ...(input.predictionMode ? { predictionMode: asPredictionMode(input.predictionMode) } : {}),
        // Force analysis-only flags in DB so legacy columns cannot re-enable ordering.
        executionMode: "PAPER",
        agentMode: "COPILOT",
        liveTradingEnabled: false,
        autonomousTradingEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
    return this.snapshot();
  }
}
