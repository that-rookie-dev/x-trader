import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { generateObject, generateText, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppError, aiStudyDraftSchema, strategyDecisionSchema, type AiStudyDraft, type StrategyDecision } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { agentDecisions, aiProfiles, appSettings } from "../../db/schema.js";
import type { CryptoService } from "../../security/crypto.js";
import { AVAILABLE_PROVIDERS, getProvider } from "./catalog.js";
import type { StudyTraceHandler } from "./study-trace.js";
import { listProviderModels, validateProvider } from "./transport.js";
import { isOpencodeFamily, opencodeHeaders, usesOpencodeAnthropicWire } from "./opencode-route.js";
import type { PredictionLedger } from "../learning/ledger.js";
import type { ForecastParamsStore } from "../learning/params-store.js";
import type { ForecastParams } from "../learning/params.js";

const STUDY_SYSTEM = `You are xTrader's session study desk for Indian cash + F&O.
Read the news and tape. Reply with a single JSON object, no markdown.
Keys: direction (BULLISH|BEARISH|RANGE), pull (0-1), closeHint (number near the band), confidence (0-1), peStrike (number or null), ceStrike (number or null), why (string), catalysts (string[]), skip (boolean), paramDelta (optional object with bounded keys wSession|wMagnet|wSpot|wFlow|wPain|wVwap|pullBull|pullBear|pullRange|pcrTilt|adxTrendTilt|ivMeanRevert|lateSpotBoost|optionRemainExpiry|optionRemainLater as absolute target values).
Rules:
- pull: bearish 0.25-0.35, range 0.5, bullish 0.65-0.75.
- closeHint must stay near the given band and respect CPR, VWAP, support and resistance.
- Treat supports and CPR BC as floors, resistances and CPR TC as ceilings. Prefer a close at the next level in your direction.
- Weight the algorithm score and named signals; do not invent levels.
- PE strike at or below spot. CE strike at or above spot.
- why: 2 short sentences naming the level you are using. catalysts: real headlines only.
- Use missMemory, algoParams, and aiDelta: when recent errors show a pattern, you may suggest tiny paramDelta absolute overrides for the AI equation branch (on top of algoParams).
- You never place orders.`;

const PLACEHOLDER_KEYS = new Set(["", "no-key-needed", "no-api-key-required", "***", "********"]);

export class AiService {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly ledger?: PredictionLedger,
    private readonly forecastParams?: ForecastParamsStore,
  ) {}

  catalog() {
    return AVAILABLE_PROVIDERS;
  }

  async list() {
    const rows = await this.db.select().from(aiProfiles);
    return rows.map((r) => {
      const info = getProvider(r.kind);
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        providerName: info?.name ?? r.kind,
        type: info?.type ?? "cloud",
        modelId: r.modelId,
        baseUrl: r.baseUrl,
        isActive: r.isActive,
        hasKey: Boolean(r.ciphertext),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async upsert(input: {
    id?: string;
    name: string;
    kind: string;
    modelId?: string;
    baseUrl?: string;
    apiKey?: string;
    activate?: boolean;
  }) {
    const info = getProvider(input.kind);
    if (!info) throw new AppError("UNKNOWN_PROVIDER", `Unknown provider ${input.kind}`, 400);
    const name = input.name.trim();
    if (!name) throw new AppError("PROFILE_NAME_REQUIRED", "Profile name is required.", 400);

    let blob: {
      ciphertext: string | null;
      nonce: string | null;
      authTag: string | null;
      keyVersion: number | null;
    } = { ciphertext: null, nonce: null, authTag: null, keyVersion: null };
    const key = input.apiKey?.trim() ?? "";
    if (key && !PLACEHOLDER_KEYS.has(key) && !key.includes("•")) {
      const enc = this.crypto.encrypt(key);
      blob = { ciphertext: enc.ciphertext, nonce: enc.nonce, authTag: enc.authTag, keyVersion: enc.keyVersion };
    }

    const baseUrl = input.baseUrl ?? (info.defaultBaseUrl || null);
    const modelId = input.modelId?.trim() ?? "";

    if (input.id) {
      await this.db
        .update(aiProfiles)
        .set({
          name,
          kind: input.kind,
          modelId,
          baseUrl,
          ...(key && !PLACEHOLDER_KEYS.has(key) ? blob : {}),
        })
        .where(eq(aiProfiles.id, input.id));
    } else {
      const [row] = await this.db
        .insert(aiProfiles)
        .values({
          name,
          kind: input.kind,
          modelId,
          baseUrl,
          ...blob,
        })
        .returning();
      input.id = row!.id;
    }
    if (input.activate && modelId) await this.activate(input.id!);
    return this.list();
  }

  async rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError("PROFILE_NAME_REQUIRED", "Profile name is required.", 400);
    await this.db.update(aiProfiles).set({ name: trimmed }).where(eq(aiProfiles.id, id));
    return this.list();
  }

  async activate(id: string) {
    const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).limit(1);
    if (!row) throw new AppError("PROFILE_NOT_FOUND", "Profile not found", 404);
    if (!row.modelId) throw new AppError("MODEL_REQUIRED", "Choose a model for this profile first.", 422);
    await this.db.update(aiProfiles).set({ isActive: false });
    await this.db.update(aiProfiles).set({ isActive: true }).where(eq(aiProfiles.id, id));
    await this.db.update(appSettings).set({ activeAiProfileId: id, updatedAt: new Date() }).where(eq(appSettings.id, 1));
    return this.list();
  }

  async setModel(id: string, modelId: string) {
    const trimmed = modelId.trim();
    if (!trimmed) throw new AppError("MODEL_REQUIRED", "Model id is required.", 400);
    await this.db.update(aiProfiles).set({ modelId: trimmed }).where(eq(aiProfiles.id, id));
    return this.list();
  }

  async remove(id: string) {
    const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).limit(1);
    if (row?.isActive) {
      const others = await this.db.select().from(aiProfiles);
      if (others.length <= 1) {
        throw new AppError("LAST_PROFILE", "Keep at least one profile, or add another before deleting the active one.", 409);
      }
    }
    await this.db.delete(aiProfiles).where(eq(aiProfiles.id, id));
    return this.list();
  }

  decryptKey(row: { ciphertext: string | null; nonce: string | null; authTag: string | null; keyVersion: number | null }): string {
    if (!row.ciphertext || !row.nonce || !row.authTag || row.keyVersion == null) return "";
    return this.crypto.decrypt({
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    });
  }

  async validateDraft(input: { providerId: string; apiKey?: string; baseUrl?: string; profileId?: string }) {
    let apiKey = input.apiKey;
    let baseUrl = input.baseUrl;
    if (input.profileId && (!apiKey || PLACEHOLDER_KEYS.has(apiKey))) {
      const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.id, input.profileId)).limit(1);
      if (row) {
        apiKey = this.decryptKey(row) || apiKey;
        baseUrl = baseUrl || row.baseUrl || undefined;
      }
    }
    return validateProvider({ providerId: input.providerId, apiKey, baseUrl });
  }

  async modelsFor(input: { providerId: string; apiKey?: string; baseUrl?: string; profileId?: string }) {
    let apiKey = input.apiKey;
    let baseUrl = input.baseUrl;
    if (input.profileId) {
      const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.id, input.profileId)).limit(1);
      if (row) {
        if (!apiKey || PLACEHOLDER_KEYS.has(apiKey)) apiKey = this.decryptKey(row);
        baseUrl = baseUrl || row.baseUrl || undefined;
      }
    }
    return listProviderModels({ providerId: input.providerId, apiKey, baseUrl, profileId: input.profileId });
  }

  async testConnection(id: string, modelId?: string): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number;
    model: string;
    sample?: string;
  }> {
    return this.ping(id, modelId);
  }

  async ping(id: string, modelId?: string): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number;
    model: string;
    sample?: string;
  }> {
    const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).limit(1);
    if (!row) throw new AppError("PROFILE_NOT_FOUND", "Profile not found", 404);
    const mid = (modelId ?? row.modelId).trim();
    if (!mid) {
      return { ok: false, message: "Pick a model first, then test it.", latencyMs: 0, model: "" };
    }
    const started = Date.now();
    try {
      const model = this.languageModel(row, mid);
      const { text } = await generateText({
        model,
        prompt: "Reply with exactly the word PONG and nothing else.",
      });
      const sample = text.trim().slice(0, 240);
      const latencyMs = Date.now() - started;
      const failed =
        !sample ||
        /subscription is required|invalid api key|unauthorized|401|403|missing x-opencode-session/i.test(sample);
      if (failed) {
        return { ok: false, message: sample || "Empty model reply.", latencyMs, model: mid, sample };
      }
      return {
        ok: true,
        message: `Live reply in ${latencyMs}ms from ${mid}.`,
        latencyMs,
        model: mid,
        sample,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Model test failed",
        latencyMs: Date.now() - started,
        model: mid,
      };
    }
  }

  async tryNarrate(system: string, prompt: string): Promise<string | null> {
    const started = Date.now();
    const active = await this.activeRow();
    try {
      const model = await this.model();
      const { text } = await generateText({
        model,
        system,
        prompt: prompt.slice(0, 12_000),
      });
      const note = text.trim() || null;
      await this.db.insert(agentDecisions).values({
        profileId: active?.id ?? null,
        inputSnapshot: { kind: "forecast-narrate" },
        output: { note: note ?? "" },
        latencyMs: Date.now() - started,
        provider: active?.kind ?? null,
        model: active?.modelId ?? null,
      });
      return note;
    } catch (error) {
      await this.db.insert(agentDecisions).values({
        profileId: active?.id ?? null,
        inputSnapshot: { kind: "forecast-narrate" },
        output: {
          decision: "NO_TRADE",
          reasonCode: "AI_FAILURE",
          explanation: error instanceof Error ? error.message : "Model failed",
        },
        latencyMs: Date.now() - started,
        provider: active?.kind ?? null,
        model: active?.modelId ?? null,
      });
      return null;
    }
  }

  async studyEod(
    input: {
      symbol: string;
      last: number;
      band: { low: number; high: number; magnet: number };
      levels?: {
        supports: string[];
        resistances: string[];
        pivot: number | null;
        priorHigh: number | null;
        priorLow: number | null;
        priorClose: number | null;
      };
      algo: { bias: string; close: string; confidence: number; score?: number; signals?: string[] };
      technical: string;
      headlines: Array<{ title: string; snippet?: string }>;
      pages: Array<{ title?: string; text: string }>;
      atm: number | null;
      formulaParams?: ForecastParams;
      algoParams?: ForecastParams;
      aiDelta?: Partial<ForecastParams>;
      paramsVersion?: number;
    },
    onTrace?: StudyTraceHandler,
  ): Promise<{ draft: AiStudyDraft | null; error?: string; paramDelta?: Partial<ForecastParams> | null }> {
    const started = Date.now();
    const active = await this.activeRow();
    if (!active) return { draft: null, error: "No active AI profile. Add and activate one in Settings." };
    if (!active.modelId) return { draft: null, error: "Active profile has no model selected." };
    const missMemory = this.ledger ? await this.ledger.studyMemory(input.symbol, 8) : "";
    const formula =
      input.formulaParams ??
      input.algoParams ??
      null;
    const prompt = JSON.stringify({
      symbol: input.symbol,
      spot: input.last,
      band: input.band,
      levels: input.levels ?? null,
      algorithm: input.algo,
      technical: input.technical,
      atm: input.atm,
      formulaParams: formula,
      algoParams: input.algoParams ?? null,
      aiDelta: input.aiDelta ?? null,
      paramsVersion: input.paramsVersion ?? null,
      missMemory,
      headlines: input.headlines.slice(0, 8),
      pages: input.pages.slice(0, 3).map((p) => ({ title: p.title, text: p.text.slice(0, 900) })),
    }).slice(0, 14_000);
    onTrace?.({
      kind: "prompt",
      system: STUDY_SYSTEM,
      prompt,
      model: active.modelId,
      provider: active.kind,
    });
    try {
      const model = await this.model();
      const stream = streamText({
        model,
        maxRetries: 0,
        system: STUDY_SYSTEM,
        prompt,
      });
      let text = "";
      for await (const delta of stream.textStream) {
        text += delta;
        onTrace?.({ kind: "llm", delta });
      }
      onTrace?.({ kind: "raw", text });
      const rawJson = extractJson(text) as Record<string, unknown> | null;
      const parsed = aiStudyDraftSchema.safeParse(rawJson);
      if (!parsed.success) {
        const error = "Model replied, but the study JSON was not usable.";
        onTrace?.({ kind: "parsed", ok: false, detail: error });
        await this.db.insert(agentDecisions).values({
          profileId: active.id,
          inputSnapshot: { kind: "eod-study", symbol: input.symbol },
          output: { reasonCode: "AI_PARSE", explanation: error, raw: text.slice(0, 800) },
          latencyMs: Date.now() - started,
          provider: active.kind,
          model: active.modelId,
        });
        return { draft: null, error };
      }
      const paramDelta =
        rawJson && typeof rawJson.paramDelta === "object" && rawJson.paramDelta != null
          ? (rawJson.paramDelta as Partial<ForecastParams>)
          : null;
      onTrace?.({
        kind: "parsed",
        ok: true,
        detail: `${parsed.data.direction} · closeHint ${parsed.data.closeHint} · conf ${parsed.data.confidence}`,
      });
      await this.db.insert(agentDecisions).values({
        profileId: active.id,
        inputSnapshot: { kind: "eod-study", symbol: input.symbol },
        output: { ...parsed.data, paramDelta } as unknown as Record<string, unknown>,
        latencyMs: Date.now() - started,
        provider: active.kind,
        model: active.modelId,
      });
      return { draft: parsed.data, paramDelta };
    } catch (error) {
      const message = shortModelError(error);
      onTrace?.({ kind: "parsed", ok: false, detail: message });
      await this.db.insert(agentDecisions).values({
        profileId: active.id,
        inputSnapshot: { kind: "eod-study", symbol: input.symbol },
        output: { reasonCode: "AI_FAILURE", explanation: message },
        latencyMs: Date.now() - started,
        provider: active.kind,
        model: active.modelId,
      });
      return { draft: null, error: message };
    }
  }

  /** True only when an active profile has a model selected. News stays paused otherwise. */
  async modelReady(): Promise<boolean> {
    const row = await this.activeRow();
    return Boolean(row?.modelId);
  }

  /** News and scraped pages are scored only by the active model. */
  async analyzeNews(input: {
    symbol: string;
    headlines: Array<{ title: string; snippet?: string; source?: string }>;
    pages: Array<{ title?: string; text: string }>;
    desk?: string;
  }): Promise<{ ok: true; newsScore: number; summary: string; notes: Array<{ index: number; line: string }> } | { ok: false; summary: string }> {
    const active = await this.activeRow();
    if (!active?.modelId) {
      return { ok: false, summary: "No active AI model. News is not scored." };
    }
    const started = Date.now();
    try {
      const model = await this.model();
      const { object } = await generateObject({
        model,
        schema: z.object({
          newsScore: z.number().min(-1).max(1),
          summary: z.string().max(1600),
          notes: z.array(z.object({
            index: z.number().int().min(0).max(7),
            line: z.string().max(180),
          })).max(8),
        }),
        system: `You score the news delta for one Indian cash or index symbol for the rest of this session.
The desk line is the price path already traded. Stories are the news. A move that is already visible in last or m5 is priced. Score only what is still ahead.
Channels that move a price: company earnings and guidance move that stock; crude, rates, the rupee, and a broad risk shock move an index; one stock moves an index only by its weight times the part of its move that is not already in the tape. A bank falling 3% does not move the bank index by 3%.
newsScore is that remaining move divided by 0.15% of spot, from -1 to 1. 0 means nothing material is left. The app turns the score into points at 0.15% of spot per 1.0, and never more than 0.4%.
summary is the message, four to six sentences. Name the channel, say whether the tape already shows it, and say what remaining move the score stands for, in direction and rough size. Do not open with the symbol name. Do not list links. Do not place orders.
notes may be empty.`,
        prompt: [
          input.symbol,
          input.desk ? `desk ${input.desk}` : "",
          ...input.headlines.slice(0, 8).map((item, index) => {
            const snippet = (item.snippet ?? "").replace(/\s+/g, " ").slice(0, 160);
            return `${index + 1}. ${item.source ?? "src"} | ${item.title} | ${snippet}`;
          }),
          ...input.pages.slice(0, 4).map((page, index) => `page ${index + 1} ${(page.title ?? "").slice(0, 80)} | ${page.text.replace(/\s+/g, " ").slice(0, 500)}`),
        ].filter(Boolean).join("\n").slice(0, 14_000),
      });
      await this.db.insert(agentDecisions).values({
        profileId: active.id,
        inputSnapshot: { kind: "news-analysis", symbol: input.symbol },
        output: object as unknown as Record<string, unknown>,
        latencyMs: Date.now() - started,
        provider: active.kind,
        model: active.modelId,
      });
      return { ok: true, newsScore: object.newsScore, summary: object.summary, notes: object.notes };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "AI news analysis failed.";
      await this.db.insert(agentDecisions).values({
        profileId: active.id,
        inputSnapshot: { kind: "news-analysis", symbol: input.symbol },
        output: { reasonCode: "AI_FAILURE", explanation: summary },
        latencyMs: Date.now() - started,
        provider: active.kind,
        model: active.modelId,
      });
      return { ok: false, summary };
    }
  }

  async analyse(context: Record<string, unknown>): Promise<StrategyDecision> {
    const model = await this.model();
    const started = Date.now();
    const active = await this.activeRow();
    try {
      const { object } = await generateObject({
        model,
        schema: strategyDecisionSchema,
        system: `You are the xTrader analysis engine. You propose TRADE or NO_TRADE.
You never place orders. You never change risk limits. Equity long-only, intraday.
If data is insufficient, return NO_TRADE. JSON only matching the schema.`,
        prompt: JSON.stringify(context).slice(0, 12_000),
      });
      await this.db.insert(agentDecisions).values({
        profileId: active?.id ?? null,
        inputSnapshot: context,
        output: object as unknown as Record<string, unknown>,
        latencyMs: Date.now() - started,
        provider: active?.kind ?? null,
        model: active?.modelId ?? null,
      });
      return object;
    } catch (error) {
      const noTrade: StrategyDecision = {
        decision: "NO_TRADE",
        reasonCode: "AI_FAILURE",
        explanation: error instanceof Error ? error.message : "Model failed",
      };
      await this.db.insert(agentDecisions).values({
        profileId: active?.id ?? null,
        inputSnapshot: context,
        output: noTrade as unknown as Record<string, unknown>,
        latencyMs: Date.now() - started,
        provider: active?.kind ?? null,
        model: active?.modelId ?? null,
      });
      return noTrade;
    }
  }

  private async activeRow() {
    const [row] = await this.db.select().from(aiProfiles).where(eq(aiProfiles.isActive, true)).limit(1);
    return row ?? null;
  }

  private async model(): Promise<LanguageModel> {
    const row = await this.activeRow();
    if (!row) throw new AppError("NO_AI_PROFILE", "No active AI profile. Add one in Settings.", 422);
    if (!row.modelId) throw new AppError("MODEL_REQUIRED", "Active profile has no model selected.", 422);
    return this.languageModel(row, row.modelId);
  }

  private languageModel(
    row: { id: string; kind: string; modelId: string; baseUrl: string | null; ciphertext: string | null; nonce: string | null; authTag: string | null; keyVersion: number | null },
    modelId: string,
  ): LanguageModel {
    const apiKey = this.decryptKey(row) || "local";
    const baseURL = row.baseUrl || getProvider(row.kind)?.defaultBaseUrl || undefined;
    const extraHeaders = isOpencodeFamily(row.kind) ? opencodeHeaders(row.id) : undefined;
    switch (row.kind) {
      case "anthropic":
        return createAnthropic({ apiKey, headers: extraHeaders })(modelId);
      case "google":
        return createGoogleGenerativeAI({ apiKey })(modelId);
      case "groq":
        return createGroq({ apiKey })(modelId);
      default:
        if (usesOpencodeAnthropicWire(row.kind, modelId)) {
          return createAnthropic({
            apiKey,
            baseURL: baseURL || "https://opencode.ai/zen/go/v1",
            headers: extraHeaders,
          })(modelId);
        }
        return createOpenAI({
          apiKey,
          baseURL,
          compatibility: row.kind === "openai" ? "strict" : "compatible",
          headers: extraHeaders,
        }).chat(modelId);
    }
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function shortModelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Study failed";
  if (/quota|rate-limit|rate limit|429/i.test(raw)) {
    return "Google quota is used up for this model. Wait a minute, or switch provider in Settings, then Study now.";
  }
  if (/NO_AI_PROFILE|no active/i.test(raw)) return "No active AI profile. Add and activate one in Settings.";
  return raw.slice(0, 280);
}
