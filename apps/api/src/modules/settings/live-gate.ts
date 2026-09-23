import { AppError } from "@xtrader/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appSettings } from "../../db/schema.js";

/** Desk settings: halt + AI profile only. Ordering is never enabled. */
export class LiveGate {
  constructor(private readonly db: Database) {}

  async snapshot() {
    const [settings] = await this.db.select().from(appSettings).limit(1);
    return {
      haltActive: settings?.haltActive ?? false,
      haltPolicy: settings?.haltPolicy ?? "MAINTAIN",
      haltReason: settings?.haltReason ?? null,
      activeAiProfileId: settings?.activeAiProfileId ?? null,
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
  }>) {
    await this.ensureRow();
    await this.db
      .update(appSettings)
      .set({
        ...(input.haltActive != null ? { haltActive: input.haltActive } : {}),
        ...(input.haltPolicy ? { haltPolicy: input.haltPolicy } : {}),
        ...(input.haltReason !== undefined ? { haltReason: input.haltReason } : {}),
        ...(input.activeAiProfileId !== undefined ? { activeAiProfileId: input.activeAiProfileId } : {}),
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
