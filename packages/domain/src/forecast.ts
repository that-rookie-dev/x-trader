import { z } from "zod";
import { directionSchema, instrumentTypeSchema, marketRegimeSchema } from "./enums.js";
import { decimalStringSchema } from "./money.js";

export const forecastHorizonSchema = z.enum(["SESSION", "EXPIRY", "SWING", "POSITIONAL"]);
export type ForecastHorizon = z.infer<typeof forecastHorizonSchema>;

export const playStatusSchema = z.enum(["OPEN", "DISMISSED", "FILLED", "PARTIAL", "MISSED", "EXPIRED"]);
export type PlayStatus = z.infer<typeof playStatusSchema>;

export const playLaneSchema = z.enum(["FNO", "CASH"]);
export type PlayLane = z.infer<typeof playLaneSchema>;

export const playSideSchema = z.enum(["CE", "PE", "EQ", "FUT"]);
export type PlaySide = z.infer<typeof playSideSchema>;

export const playHorizonSchema = z.enum(["SESSION", "EXPIRY", "SWING", "POSITION", "INTRADAY"]);
export type PlayHorizon = z.infer<typeof playHorizonSchema>;

export const playSchema = z.object({
  id: z.string(),
  at: z.string(),
  lane: playLaneSchema,
  side: playSideSchema,
  contract: z.string(),
  exchange: z.string(),
  underlying: z.string(),
  expiry: z.string().nullable(),
  status: playStatusSchema,
  entryZone: z.string(),
  stop: z.string(),
  targets: z.array(z.string()),
  holdUntil: z.string(),
  invalidation: z.string(),
  edgeAfterCost: z.string().nullable(),
  confidence: z.number(),
  regime: marketRegimeSchema,
  why: z.array(z.string()),
  eodSpot: z.string().nullable().optional(),
  eodPremium: z.string().nullable().optional(),
  pcr: z.number().nullable().optional(),
  ivRank: z.number().nullable().optional(),
  thetaNote: z.string().nullable().optional(),
  horizon: playHorizonSchema.optional(),
  rsVsNifty: z.number().nullable().optional(),
  atrStop: z.string().nullable().optional(),
  rank: z.number().nullable().optional(),
  dismissedAt: z.string().nullable().optional(),
  brokerOrderId: z.string().nullable().optional(),
  fillQty: z.number().nullable().optional(),
  fillPx: z.string().nullable().optional(),
  setupKey: z.string().optional(),
  expectancyNote: z.string().nullable().optional(),
});
export type Play = z.infer<typeof playSchema>;

export const forecastBiasSchema = z.enum(["BULLISH", "BEARISH", "RANGE"]);
export type ForecastBias = z.infer<typeof forecastBiasSchema>;

export const aiStudySchema = z.object({
  studiedAt: z.string(),
  direction: forecastBiasSchema,
  pull: z.number().min(0).max(1),
  close: decimalStringSchema,
  confidence: z.number().min(0).max(1),
  peStrike: z.number().nullable(),
  ceStrike: z.number().nullable(),
  why: z.string(),
  catalysts: z.array(z.string()).default([]),
  skip: z.boolean().default(false),
});
export type AiStudy = z.infer<typeof aiStudySchema>;

export const aiStudyDraftSchema = z.object({
  direction: forecastBiasSchema,
  pull: z.coerce.number().min(0).max(1),
  closeHint: z.coerce.number().nullable().optional(),
  confidence: z.coerce.number().min(0).max(1),
  peStrike: z.coerce.number().nullable().optional(),
  ceStrike: z.coerce.number().nullable().optional(),
  why: z.string().max(800),
  catalysts: z.array(z.string().max(160)).max(5).optional().default([]),
  skip: z.boolean().optional().default(false),
});
export type AiStudyDraft = z.infer<typeof aiStudyDraftSchema>;

export const forecastSchema = z.object({
  instrument: z.object({
    exchange: z.string(),
    symbol: z.string(),
    instrumentType: instrumentTypeSchema,
  }),
  horizon: forecastHorizonSchema,
  bias: forecastBiasSchema,
  regime: marketRegimeSchema,
  confidence: z.number().min(0).max(1),
  lastPrice: decimalStringSchema,
  session: z.object({
    expectedLow: decimalStringSchema,
    expectedHigh: decimalStringSchema,
    magnet: decimalStringSchema,
    invalidation: z.string(),
    pull: z.number().min(0).max(1).optional(),
  }),
  path: z.object({
    until: z.string(),
    scenario: z.string(),
    supports: z.array(decimalStringSchema),
    resistances: z.array(decimalStringSchema),
  }),
  derivatives: z
    .object({
      expiry: z.string().nullable(),
      future: z.string().nullable(),
      call: z.string().nullable(),
      put: z.string().nullable(),
      note: z.string(),
    })
    .optional(),
  evidence: z.object({
    technical: z.string(),
    history: z.string(),
    news: z.string(),
    llm: z.string().optional(),
    aiStudy: aiStudySchema.optional(),
    aiError: z.string().optional(),
    desk: z
      .object({
        votes: z.array(z.object({ name: z.string(), vote: z.number(), detail: z.string() })),
        vwap: z.string().nullable(),
        orbHigh: z.string().nullable(),
        orbLow: z.string().nullable(),
      })
      .optional(),
  }),
  copilotAction: z.string(),
  autoEligible: z.boolean(),
  direction: directionSchema.optional(),
  suggestions: z
    .array(
      z.object({
        lane: z.enum(["FNO", "CASH"]),
        kind: z.enum(["CE", "PE", "FUT", "EQ"]),
        action: z.enum(["BUY", "SELL", "HOLD", "SKIP", "WAIT", "AVOID"]),
        contract: z.string(),
        exchange: z.string(),
        why: z.string(),
        until: z.string().nullable(),
        premium: z.string().nullable().optional(),
        primary: z.boolean().optional(),
        exit: z.string().nullable().optional(),
        stop: z.string().nullable().optional(),
        target: z.string().nullable().optional(),
      }),
    )
    .default([]),
});
export type Forecast = z.infer<typeof forecastSchema>;
