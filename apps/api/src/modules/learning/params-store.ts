import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { forecastParams } from "../../db/schema.js";
import {
  applyParamDelta,
  clampParams,
  DEFAULT_FORECAST_PARAMS,
  diffParams,
  type ForecastParams,
  type PredictionMode,
} from "./params.js";

export type BranchScores = {
  params: ForecastParams;
  delta: Partial<ForecastParams>;
  scoreMae: number | null;
  scoreHitRate: number | null;
  history: Array<Record<string, unknown>>;
  lastTunedSession: string | null;
};

export type ForecastParamsRow = {
  exchange: string;
  symbol: string;
  version: number;
  algo: BranchScores;
  ai: BranchScores;
  updatedAt: string;
};

function emptyBranch(seed: ForecastParams = DEFAULT_FORECAST_PARAMS): BranchScores {
  return {
    params: clampParams(seed),
    delta: {},
    scoreMae: null,
    scoreHitRate: null,
    history: [],
    lastTunedSession: null,
  };
}

export class ForecastParamsStore {
  private cache = new Map<string, ForecastParamsRow>();
  private legacySeed: ForecastParams | null | undefined;

  constructor(private readonly db: Database) {}

  private key(exchange: string, symbol: string) {
    return `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
  }

  /** One-time read of pre-migration global params (if any). */
  private async readLegacySeed(): Promise<ForecastParams | null> {
    if (this.legacySeed !== undefined) return this.legacySeed;
    try {
      const result = await this.db.execute(
        sql`select params from forecast_params_legacy where id = 1 limit 1`,
      );
      const rows = ((result as unknown as { rows?: Array<{ params: unknown }> }).rows
        ?? (Array.isArray(result) ? (result as unknown as Array<{ params: unknown }>) : [])) as Array<{
        params: unknown;
      }>;
      const first = rows[0];
      if (first?.params && typeof first.params === "object") {
        this.legacySeed = clampParams(first.params as Record<string, number>);
        return this.legacySeed;
      }
    } catch {
      /* no legacy table */
    }
    this.legacySeed = null;
    return null;
  }

  async ensure(exchange: string, symbol: string): Promise<ForecastParamsRow> {
    const ex = exchange.toUpperCase();
    const sym = symbol.toUpperCase();
    const k = this.key(ex, sym);
    const cached = this.cache.get(k);
    if (cached) return cached;

    const [row] = await this.db
      .select()
      .from(forecastParams)
      .where(and(eq(forecastParams.exchange, ex), eq(forecastParams.symbol, sym)))
      .limit(1);
    if (row) {
      const mapped = this.map(row);
      this.cache.set(k, mapped);
      return mapped;
    }

    const seed = (await this.readLegacySeed()) ?? DEFAULT_FORECAST_PARAMS;
    const algo = emptyBranch(seed);
    const ai = emptyBranch(seed);
    await this.db.insert(forecastParams).values({
      exchange: ex,
      symbol: sym,
      version: 1,
      algoParams: algo.params,
      algoDelta: algo.delta,
      algoHistory: [],
      aiParams: ai.params,
      aiDelta: ai.delta,
      aiHistory: [],
    });
    const created: ForecastParamsRow = {
      exchange: ex,
      symbol: sym,
      version: 1,
      algo,
      ai,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(k, created);
    return created;
  }

  async get(exchange: string, symbol: string): Promise<ForecastParamsRow> {
    return this.ensure(exchange, symbol);
  }

  /** Active equation params for the selected prediction mode. */
  async getParams(exchange: string, symbol: string, mode: PredictionMode = "ALGO"): Promise<ForecastParams> {
    const row = await this.get(exchange, symbol);
    return mode === "AI" ? row.ai.params : row.algo.params;
  }

  async saveAlgo(
    exchange: string,
    symbol: string,
    input: {
      params: ForecastParams;
      scoreMae?: number | null;
      scoreHitRate?: number | null;
      historyEntry?: Record<string, unknown>;
      lastTunedSession?: string | null;
    },
  ): Promise<ForecastParamsRow> {
    const current = await this.ensure(exchange, symbol);
    const params = clampParams(input.params);
    const delta = diffParams(DEFAULT_FORECAST_PARAMS, params);
    const history = [...current.algo.history];
    if (input.historyEntry) {
      history.push(input.historyEntry);
      while (history.length > 20) history.shift();
    }
    // Keep AI as algo ⊕ existing aiDelta when algo moves
    const aiParams = applyParamDelta(params, current.ai.delta);
    const version = current.version + 1;
    await this.db
      .update(forecastParams)
      .set({
        version,
        algoParams: params,
        algoDelta: delta,
        algoScoreMae: input.scoreMae != null ? String(input.scoreMae) : current.algo.scoreMae != null ? String(current.algo.scoreMae) : null,
        algoScoreHitRate:
          input.scoreHitRate != null
            ? String(input.scoreHitRate)
            : current.algo.scoreHitRate != null
              ? String(current.algo.scoreHitRate)
              : null,
        algoHistory: history,
        algoLastTunedSession: input.lastTunedSession ?? current.algo.lastTunedSession,
        aiParams,
        updatedAt: new Date(),
      })
      .where(and(eq(forecastParams.exchange, current.exchange), eq(forecastParams.symbol, current.symbol)));
    const next: ForecastParamsRow = {
      exchange: current.exchange,
      symbol: current.symbol,
      version,
      algo: {
        params,
        delta,
        scoreMae: input.scoreMae ?? current.algo.scoreMae,
        scoreHitRate: input.scoreHitRate ?? current.algo.scoreHitRate,
        history,
        lastTunedSession: input.lastTunedSession ?? current.algo.lastTunedSession,
      },
      ai: {
        ...current.ai,
        params: aiParams,
      },
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(this.key(current.exchange, current.symbol), next);
    return next;
  }

  async saveAi(
    exchange: string,
    symbol: string,
    input: {
      params: ForecastParams;
      delta?: Partial<ForecastParams>;
      scoreMae?: number | null;
      scoreHitRate?: number | null;
      historyEntry?: Record<string, unknown>;
      lastTunedSession?: string | null;
    },
  ): Promise<ForecastParamsRow> {
    const current = await this.ensure(exchange, symbol);
    const params = clampParams(input.params);
    const delta = input.delta ?? diffParams(current.algo.params, params);
    const history = [...current.ai.history];
    if (input.historyEntry) {
      history.push(input.historyEntry);
      while (history.length > 20) history.shift();
    }
    const version = current.version + 1;
    await this.db
      .update(forecastParams)
      .set({
        version,
        aiParams: params,
        aiDelta: delta,
        aiScoreMae: input.scoreMae != null ? String(input.scoreMae) : current.ai.scoreMae != null ? String(current.ai.scoreMae) : null,
        aiScoreHitRate:
          input.scoreHitRate != null
            ? String(input.scoreHitRate)
            : current.ai.scoreHitRate != null
              ? String(current.ai.scoreHitRate)
              : null,
        aiHistory: history,
        aiLastTunedSession: input.lastTunedSession ?? current.ai.lastTunedSession,
        updatedAt: new Date(),
      })
      .where(and(eq(forecastParams.exchange, current.exchange), eq(forecastParams.symbol, current.symbol)));
    const next: ForecastParamsRow = {
      exchange: current.exchange,
      symbol: current.symbol,
      version,
      algo: current.algo,
      ai: {
        params,
        delta,
        scoreMae: input.scoreMae ?? current.ai.scoreMae,
        scoreHitRate: input.scoreHitRate ?? current.ai.scoreHitRate,
        history,
        lastTunedSession: input.lastTunedSession ?? current.ai.lastTunedSession,
      },
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(this.key(current.exchange, current.symbol), next);
    return next;
  }

  private map(row: typeof forecastParams.$inferSelect): ForecastParamsRow {
    const algoParams = clampParams((row.algoParams ?? DEFAULT_FORECAST_PARAMS) as ForecastParams);
    const aiParams = clampParams((row.aiParams ?? algoParams) as ForecastParams);
    return {
      exchange: row.exchange,
      symbol: row.symbol,
      version: row.version,
      algo: {
        params: algoParams,
        delta: (row.algoDelta ?? {}) as Partial<ForecastParams>,
        scoreMae: row.algoScoreMae != null ? Number(row.algoScoreMae) : null,
        scoreHitRate: row.algoScoreHitRate != null ? Number(row.algoScoreHitRate) : null,
        history: (row.algoHistory ?? []) as Array<Record<string, unknown>>,
        lastTunedSession: row.algoLastTunedSession,
      },
      ai: {
        params: aiParams,
        delta: (row.aiDelta ?? {}) as Partial<ForecastParams>,
        scoreMae: row.aiScoreMae != null ? Number(row.aiScoreMae) : null,
        scoreHitRate: row.aiScoreHitRate != null ? Number(row.aiScoreHitRate) : null,
        history: (row.aiHistory ?? []) as Array<Record<string, unknown>>,
        lastTunedSession: row.aiLastTunedSession,
      },
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
