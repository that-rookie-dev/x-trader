import { AppError, normalizeAgentMode, type ExecutionMode } from "@xtrader/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appSettings } from "../../db/schema.js";

export class LiveGate {
  constructor(private readonly db: Database) {}

  async currentEgressIp(): Promise<string | null> {
    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { ip?: string };
      return body.ip ?? null;
    } catch {
      return null;
    }
  }

  async snapshot() {
    const [settings] = await this.db.select().from(appSettings).limit(1);
    const egressIp = await this.currentEgressIp();
    const confirmed = settings?.confirmedEgressIp ?? null;
    const ipMatches = Boolean(egressIp && confirmed && egressIp === confirmed);
    const liveReady = Boolean(settings?.liveTradingEnabled && ipMatches && !settings.haltActive);
    return {
      executionMode: (settings?.executionMode ?? "PAPER") as ExecutionMode,
      agentMode: normalizeAgentMode(settings?.agentMode),
      liveTradingEnabled: settings?.liveTradingEnabled ?? false,
      autonomousTradingEnabled: settings?.autonomousTradingEnabled ?? false,
      haltActive: settings?.haltActive ?? false,
      haltPolicy: settings?.haltPolicy ?? "MAINTAIN",
      haltReason: settings?.haltReason ?? null,
      currentEgressIp: egressIp,
      confirmedEgressIp: confirmed,
      ipMatches,
      liveReady,
      liveBlockedReason: liveReady
        ? null
        : !settings?.liveTradingEnabled
          ? "LIVE is not enabled in settings"
          : !confirmed
            ? "Confirm the current public IP as static and whitelisted at Zerodha"
            : !ipMatches
              ? "Current egress IP does not match the confirmed static IP"
              : settings.haltActive
                ? "Kill switch is active"
                : "Live trading is not ready",
    };
  }

  async assertLiveAllowed(): Promise<void> {
    const snap = await this.snapshot();
    if (snap.executionMode !== "LIVE" || !snap.liveReady) {
      throw new AppError("LIVE_NOT_ENABLED", snap.liveBlockedReason ?? "Live trading is not enabled", 403);
    }
  }

  async ensureRow(): Promise<void> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) {
      await this.db.insert(appSettings).values({ id: 1 });
    }
  }

  async patch(input: Partial<{
    executionMode: ExecutionMode;
    agentMode: string;
    liveTradingEnabled: boolean;
    autonomousTradingEnabled: boolean;
    haltActive: boolean;
    haltPolicy: string;
    haltReason: string | null;
    confirmEgress: boolean;
    activeAiProfileId: string | null;
  }>) {
    await this.ensureRow();
    const snap = await this.snapshot();
    const nextMode = input.executionMode ?? snap.executionMode;
    if (nextMode === "LIVE") {
      if (input.executionMode === "LIVE" && !snap.liveReady && !input.liveTradingEnabled) {
        const preview = await this.snapshot();
        if (!preview.confirmedEgressIp && !input.confirmEgress) {
          throw new AppError("LIVE_NOT_READY", preview.liveBlockedReason ?? "Live trading is not ready", 422);
        }
      }
    }
    const egressIp = input.confirmEgress ? await this.currentEgressIp() : undefined;
    const agentMode = input.agentMode ? normalizeAgentMode(input.agentMode) : undefined;
    await this.db
      .update(appSettings)
      .set({
        ...(input.executionMode ? { executionMode: input.executionMode } : {}),
        ...(agentMode ? { agentMode, autonomousTradingEnabled: agentMode === "AUTO" } : {}),
        ...(input.liveTradingEnabled != null ? { liveTradingEnabled: input.liveTradingEnabled } : {}),
        ...(input.autonomousTradingEnabled != null
          ? { autonomousTradingEnabled: input.autonomousTradingEnabled }
          : {}),
        ...(input.haltActive != null ? { haltActive: input.haltActive } : {}),
        ...(input.haltPolicy ? { haltPolicy: input.haltPolicy } : {}),
        ...(input.haltReason !== undefined ? { haltReason: input.haltReason } : {}),
        ...(input.activeAiProfileId !== undefined ? { activeAiProfileId: input.activeAiProfileId } : {}),
        ...(input.confirmEgress && egressIp
          ? { confirmedEgressIp: egressIp, confirmedEgressAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
    if (input.executionMode === "LIVE") {
      const after = await this.snapshot();
      if (!after.liveReady) {
        await this.db.update(appSettings).set({ executionMode: "PAPER" }).where(eq(appSettings.id, 1));
        throw new AppError("LIVE_NOT_READY", after.liveBlockedReason ?? "Live trading is not ready", 422);
      }
    }
    return this.snapshot();
  }
}
