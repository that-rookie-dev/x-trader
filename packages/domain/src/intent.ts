import { z } from "zod";
import { decimalStringSchema } from "./money.js";
import {
  directionSchema,
  entryTypeSchema,
  instrumentTypeSchema,
  timeHorizonSchema,
  tradeDecisionSchema,
} from "./enums.js";

export const instrumentRefSchema = z.object({
  exchange: z.string().min(1),
  symbol: z.string().min(1),
  instrumentType: instrumentTypeSchema.default("EQUITY"),
});
export type InstrumentRef = z.infer<typeof instrumentRefSchema>;

export const tradeIntentSchema = z.object({
  decision: tradeDecisionSchema,
  instrument: instrumentRefSchema,
  direction: directionSchema,
  entryType: entryTypeSchema,
  entryPrice: decimalStringSchema,
  stopLoss: decimalStringSchema,
  targets: z.array(decimalStringSchema).min(1),
  confidenceScore: z.number().min(0).max(1),
  timeHorizon: timeHorizonSchema,
  strategy: z.string().min(1),
  thesis: z.string().min(1).max(2000),
  invalidation: z.string().min(1).max(2000),
  maxRiskRequested: decimalStringSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type TradeIntent = z.infer<typeof tradeIntentSchema>;

export const noTradeSchema = z.object({
  decision: z.literal("NO_TRADE"),
  reasonCode: z.string().min(1),
  explanation: z.string().min(1),
});
export type NoTrade = z.infer<typeof noTradeSchema>;

export const strategyDecisionSchema = z.discriminatedUnion("decision", [
  tradeIntentSchema.extend({ decision: z.literal("TRADE") }),
  noTradeSchema,
]);
export type StrategyDecision = z.infer<typeof strategyDecisionSchema>;

export const riskProfileSchema = z.object({
  capital: decimalStringSchema,
  maxDailyLoss: decimalStringSchema,
  maxRiskPerTrade: decimalStringSchema,
  maxOpenPositions: z.number().int().positive(),
  maxTradesPerDay: z.number().int().positive(),
  minimumRiskReward: decimalStringSchema,
  allowEquity: z.boolean(),
  allowFutures: z.boolean(),
  allowOptions: z.boolean(),
  allowOvernight: z.boolean(),
  maxConsecutiveLosses: z.number().int().positive().default(5),
});
export type RiskProfile = z.infer<typeof riskProfileSchema>;
