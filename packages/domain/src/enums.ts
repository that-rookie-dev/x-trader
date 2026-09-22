import { z } from "zod";

export const executionModeSchema = z.enum(["PAPER", "LIVE"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const agentModeSchema = z.enum(["COPILOT", "AUTO"]);
export type AgentMode = z.infer<typeof agentModeSchema>;

/** Accept legacy names from env/DB and map them to Copilot/Auto. */
export function normalizeAgentMode(raw?: string | null): AgentMode {
  if (raw === "AUTO" || raw === "AUTONOMOUS") return "AUTO";
  return "COPILOT";
}

export const connectionStatusSchema = z.enum([
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "EXPIRED",
  "ERROR",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const dataSourceSchema = z.enum(["LIVE", "REPLAY", "DEMO"]);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const marketRegimeSchema = z.enum([
  "STRONG_BULLISH",
  "BULLISH",
  "RANGE",
  "BEARISH",
  "STRONG_BEARISH",
  "HIGH_VOLATILITY",
  "UNKNOWN",
]);
export type MarketRegime = z.infer<typeof marketRegimeSchema>;

export const orderStatusSchema = z.enum([
  "CREATED",
  "SUBMITTING",
  "ACKNOWLEDGED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCEL_PENDING",
  "CANCELLED",
  "REJECTED",
  "UNKNOWN",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const positionStatusSchema = z.enum(["OPEN", "PARTIALLY_EXITED", "CLOSED"]);
export type PositionStatus = z.infer<typeof positionStatusSchema>;

export const closeReasonSchema = z.enum([
  "STOP",
  "TARGET",
  "TIME",
  "USER",
  "STRATEGY",
  "EMERGENCY",
]);
export type CloseReason = z.infer<typeof closeReasonSchema>;

export const instrumentTypeSchema = z.enum(["EQUITY", "INDEX", "FUTURE", "OPTION"]);
export type InstrumentType = z.infer<typeof instrumentTypeSchema>;

export const directionSchema = z.enum(["LONG", "SHORT"]);
export type Direction = z.infer<typeof directionSchema>;

export const entryTypeSchema = z.enum(["MARKET", "LIMIT"]);
export type EntryType = z.infer<typeof entryTypeSchema>;

export const timeHorizonSchema = z.enum(["INTRADAY", "SWING", "POSITION"]);
export type TimeHorizon = z.infer<typeof timeHorizonSchema>;

export const tradeDecisionSchema = z.enum(["TRADE", "NO_TRADE"]);
export type TradeDecision = z.infer<typeof tradeDecisionSchema>;

export const aiProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "groq",
  "openai_compatible",
  "ollama",
  "lmstudio",
]);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

export const haltPolicySchema = z.enum(["MAINTAIN", "CANCEL_ENTRIES", "FLATTEN"]);
export type HaltPolicy = z.infer<typeof haltPolicySchema>;
