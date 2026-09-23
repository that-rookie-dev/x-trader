import { AppError, money, type BrokerOrder, type BrokerProfile, type Funds, type Holding, type PositionSnapshot } from "@xtrader/domain";
import { and, desc, eq } from "drizzle-orm";
import type { Response } from "express";
import type { Env } from "../../../config/env.js";
import type { Logger } from "../../../config/logger.js";
import type { Database } from "../../../db/client.js";
import {
  brokerAccounts,
  brokerLoginAttempts,
  brokerSessions,
  paperAccounts,
  riskProfiles,
  systemEvents,
  users,
  watchlistItems,
  watchlists,
} from "../../../db/schema.js";
import type { CryptoService } from "../../../security/crypto.js";
import type { SessionService } from "../../auth/session.js";
import type { KiteGateway } from "./kite-gateway.js";
import type { KiteCredentialsVault } from "./credentials-vault.js";

const LOGIN_TTL_MS = 5 * 60 * 1000;

function kiteExpiry(from = new Date()): Date {
  const ist = new Date(from.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const next = new Date(ist);
  next.setHours(6, 0, 0, 0);
  if (ist >= next) next.setDate(next.getDate() + 1);
  const offset = next.getTime() - ist.getTime();
  return new Date(from.getTime() + offset);
}

export class ZerodhaAuthService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly kite: KiteGateway,
    private readonly log: Logger,
    private readonly vault: KiteCredentialsVault,
  ) {}

  async startLogin(res: Response, existingSession?: { userId: string }): Promise<string> {
    const creds = await this.vault.get();
    if (!creds) {
      throw new AppError("KITE_NOT_CONFIGURED", "Add your Zerodha API key and secret first", 503);
    }
    const nonce = this.crypto.randomToken(16);
    await this.db.insert(brokerLoginAttempts).values({
      nonceHash: this.crypto.hash(nonce),
      appSessionHint: existingSession?.userId ?? null,
      expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
    });
    const redirectParams = `xt_nonce=${encodeURIComponent(nonce)}`;
    return await this.kite.loginUrl(redirectParams);
  }

  async handleCallback(query: Record<string, unknown>, res: Response): Promise<void> {
    const status = String(query.status ?? "success");
    const requestToken = String(query.request_token ?? "");
    const nonce = String(query.xt_nonce ?? "");
    if (status !== "success" || !requestToken) {
      throw new AppError("CALLBACK_FAILED", "Zerodha login was not successful", 400);
    }
    if (!nonce) {
      throw new AppError("CALLBACK_NONCE_MISSING", "Login attempt nonce missing", 400);
    }

    const hash = this.crypto.hash(nonce);
    const [attempt] = await this.db
      .select()
      .from(brokerLoginAttempts)
      .where(eq(brokerLoginAttempts.nonceHash, hash))
      .limit(1);
    if (!attempt) throw new AppError("LOGIN_ATTEMPT_UNKNOWN", "Unknown or unsolicited callback", 400);
    if (attempt.consumedAt) throw new AppError("LOGIN_ATTEMPT_REPLAY", "Login attempt already used", 400);
    if (attempt.expiresAt.getTime() < Date.now()) {
      throw new AppError("LOGIN_ATTEMPT_EXPIRED", "Login attempt expired", 400);
    }

    await this.db
      .update(brokerLoginAttempts)
      .set({ consumedAt: new Date() })
      .where(eq(brokerLoginAttempts.id, attempt.id));

    const session = await this.kite.generateSession(requestToken);
    const clientId = session.user_id;
    if (this.env.KITE_ALLOWED_CLIENT_ID && this.env.KITE_ALLOWED_CLIENT_ID !== clientId) {
      throw new AppError("WRONG_BROKER_ACCOUNT", "Returned client ID does not match the allowed account", 403);
    }

    const [existingAccount] = await this.db.select().from(brokerAccounts).limit(1);
    if (existingAccount && existingAccount.externalClientId !== clientId) {
      throw new AppError("WRONG_BROKER_ACCOUNT", "This instance is linked to a different Zerodha client", 403);
    }

    let userId = existingAccount?.userId;
    if (!userId) {
      const [user] = await this.db.insert(users).values({ displayName: session.user_name ?? "owner" }).returning();
      userId = user!.id;
    }

    const encrypted = this.crypto.encrypt(session.access_token);
    const issuedAt = new Date();
    const expiresAt = kiteExpiry(issuedAt);

    let accountId = existingAccount?.id;
    if (!accountId) {
      const [account] = await this.db
        .insert(brokerAccounts)
        .values({
          userId,
          broker: "zerodha",
          externalClientId: clientId,
          displayName: session.user_name ?? null,
          email: session.email ?? null,
          exchanges: session.exchanges ?? [],
          products: session.products ?? [],
        })
        .returning();
      accountId = account!.id;
      await this.seedOwnerDefaults(userId);
    } else {
      await this.db
        .update(brokerAccounts)
        .set({
          displayName: session.user_name ?? existingAccount?.displayName,
          email: session.email ?? existingAccount?.email,
          exchanges: session.exchanges ?? [],
          products: session.products ?? [],
          updatedAt: new Date(),
        })
        .where(eq(brokerAccounts.id, accountId));
    }

    await this.db
      .update(brokerSessions)
      .set({ status: "EXPIRED" })
      .where(and(eq(brokerSessions.brokerAccountId, accountId), eq(brokerSessions.status, "CONNECTED")));

    await this.db.insert(brokerSessions).values({
      brokerAccountId: accountId,
      status: "CONNECTED",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      issuedAt,
      expiresAt,
      lastValidatedAt: issuedAt,
    });

    await this.db.insert(systemEvents).values({
      type: "BROKER_SESSION_CONNECTED",
      accountId,
      payload: { broker: "zerodha", clientId },
    });

    await this.sessions.create(userId, res);
    this.log.info({ clientId }, "Zerodha session connected");
  }

  async disconnect(userId: string): Promise<{ remoteRevoked: boolean; message: string }> {
    const access = await this.getAccessToken().catch(() => null);
    await this.db
      .update(brokerSessions)
      .set({ status: "DISCONNECTED", lastError: null })
      .where(eq(brokerSessions.status, "CONNECTED"));
    await this.sessions.revokeAll(userId);
    let remoteRevoked = false;
    if (access) {
      try {
        await this.kite.invalidateAccessToken(access.token);
        remoteRevoked = true;
      } catch (error) {
        this.log.warn({ err: error }, "remote session invalidation failed");
      }
    }
    await this.db.insert(systemEvents).values({
      type: "BROKER_SESSION_DISCONNECTED",
      payload: { remoteRevoked },
    });
    return {
      remoteRevoked,
      message: remoteRevoked
        ? "Local session removed and Zerodha token invalidated"
        : "Local session removed; remote invalidation did not succeed",
    };
  }

  async getAccessToken(): Promise<{ token: string; accountId: string; clientId: string; expiresAt: Date; lastValidatedAt: Date | null } | null> {
    const [row] = await this.db
      .select({
        session: brokerSessions,
        account: brokerAccounts,
      })
      .from(brokerSessions)
      .innerJoin(brokerAccounts, eq(brokerSessions.brokerAccountId, brokerAccounts.id))
      .where(eq(brokerSessions.status, "CONNECTED"))
      .orderBy(desc(brokerSessions.createdAt))
      .limit(1);
    if (!row) return null;
    if (row.session.expiresAt.getTime() <= Date.now()) {
      await this.db.update(brokerSessions).set({ status: "EXPIRED" }).where(eq(brokerSessions.id, row.session.id));
      return null;
    }
    const token = this.crypto.decrypt({
      ciphertext: row.session.ciphertext,
      nonce: row.session.nonce,
      authTag: row.session.authTag,
      keyVersion: row.session.keyVersion,
    });
    return {
      token,
      accountId: row.account.id,
      clientId: row.account.externalClientId,
      expiresAt: row.session.expiresAt,
      lastValidatedAt: row.session.lastValidatedAt,
    };
  }

  async markValidated(accountId: string): Promise<void> {
    await this.db
      .update(brokerSessions)
      .set({ lastValidatedAt: new Date(), lastError: null, status: "CONNECTED" })
      .where(and(eq(brokerSessions.brokerAccountId, accountId), eq(brokerSessions.status, "CONNECTED")));
  }

  async markError(message: string): Promise<void> {
    await this.db
      .update(brokerSessions)
      .set({ lastError: message, status: "ERROR" })
      .where(eq(brokerSessions.status, "CONNECTED"));
  }

  async status() {
    const [row] = await this.db
      .select({
        session: brokerSessions,
        account: brokerAccounts,
      })
      .from(brokerSessions)
      .innerJoin(brokerAccounts, eq(brokerSessions.brokerAccountId, brokerAccounts.id))
      .orderBy(desc(brokerSessions.createdAt))
      .limit(1);
    if (!row) {
      return { broker: "zerodha", status: "DISCONNECTED" as const };
    }
    let status = row.session.status;
    if (status === "CONNECTED" && row.session.expiresAt.getTime() <= Date.now()) {
      status = "EXPIRED";
    }
    return {
      broker: "zerodha",
      status,
      clientId: row.account.externalClientId,
      lastValidatedAt: row.session.lastValidatedAt?.toISOString() ?? null,
      expiresAt: row.session.expiresAt.toISOString(),
      lastError: row.session.lastError,
    };
  }

  private async seedOwnerDefaults(userId: string): Promise<void> {
    await this.db.insert(riskProfiles).values({
      capital: "100000.00",
      maxDailyLoss: "1000.00",
      maxRiskPerTrade: "300.00",
      maxOpenPositions: 3,
      maxTradesPerDay: 5,
      minimumRiskReward: "1.50",
      allowEquity: true,
      allowFutures: false,
      allowOptions: false,
      allowOvernight: false,
    });
    const [watchlist] = await this.db.insert(watchlists).values({ userId, name: "Default" }).returning();
    const defaults = [
      { exchange: "NSE", symbol: "NIFTY 50", orderable: false, sortOrder: 0 },
      { exchange: "NSE", symbol: "RELIANCE", orderable: true, sortOrder: 1 },
      { exchange: "NSE", symbol: "HDFCBANK", orderable: true, sortOrder: 2 },
      { exchange: "NSE", symbol: "ICICIBANK", orderable: true, sortOrder: 3 },
      { exchange: "NSE", symbol: "INFY", orderable: true, sortOrder: 4 },
      { exchange: "NSE", symbol: "TCS", orderable: true, sortOrder: 5 },
    ];
    await this.db.insert(watchlistItems).values(defaults.map((d) => ({ ...d, watchlistId: watchlist!.id })));
    const [existingPaper] = await this.db.select().from(paperAccounts).limit(1);
    if (!existingPaper) {
      await this.db.insert(paperAccounts).values({ userId, cash: "25000.00", reservedCash: "0" });
    }
  }
}

export function mapProfile(profile: BrokerProfile): BrokerProfile {
  return profile;
}

export function mapFunds(raw: {
  equity?: { net?: number; available?: { live_balance?: number; cash?: number; collateral?: number }; utilised?: { debits?: number } };
  commodity?: { net?: number; available?: { live_balance?: number } };
}): Funds {
  const eqAvail = raw.equity?.available?.live_balance ?? raw.equity?.available?.cash ?? raw.equity?.net ?? 0;
  const eqUsed = raw.equity?.utilised?.debits ?? 0;
  return {
    equity: {
      available: money(eqAvail),
      usedMargin: money(eqUsed),
      openingBalance: raw.equity?.available?.cash != null ? money(raw.equity.available.cash) : undefined,
      collateral: raw.equity?.available?.collateral != null ? money(raw.equity.available.collateral) : undefined,
    },
    commodity: raw.commodity
      ? {
          available: money(raw.commodity.available?.live_balance ?? raw.commodity.net ?? 0),
          usedMargin: money(0),
        }
      : undefined,
    asOf: new Date().toISOString(),
  };
}

export function mapHoldings(rows: unknown[]): Holding[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      instrument: {
        exchange: String(r.exchange ?? "NSE"),
        symbol: String(r.tradingsymbol ?? r.symbol ?? ""),
        instrumentType: "EQUITY" as const,
      },
      quantity: money(Number(r.quantity ?? 0), 4),
      averagePrice: money(Number(r.average_price ?? 0)),
      lastPrice: r.last_price != null ? money(Number(r.last_price)) : undefined,
      pnl: r.pnl != null ? money(Number(r.pnl)) : undefined,
      product: r.product != null ? String(r.product) : undefined,
    };
  });
}

export function mapOrders(rows: unknown[]): BrokerOrder[] {
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const side = String(r.transaction_type ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
      return {
        brokerOrderId: String(r.order_id ?? ""),
        status: String(r.status ?? "UNKNOWN"),
        exchange: String(r.exchange ?? ""),
        symbol: String(r.tradingsymbol ?? r.symbol ?? ""),
        quantity: Number(r.quantity ?? 0),
        filledQuantity: Number(r.filled_quantity ?? 0),
        pendingQuantity: Number(r.pending_quantity ?? 0),
        price: r.price != null ? money(Number(r.price)) : undefined,
        averagePrice: r.average_price != null ? money(Number(r.average_price)) : undefined,
        rawStatus: String(r.status ?? ""),
        transactionType: side as "BUY" | "SELL",
        orderTimestamp: r.order_timestamp != null ? String(r.order_timestamp) : r.exchange_timestamp != null ? String(r.exchange_timestamp) : undefined,
      };
    })
    .filter((order) => Boolean(order.brokerOrderId));
}

export function mapPositions(payload: { net?: unknown[]; day?: unknown[] }): PositionSnapshot[] {
  const rows = payload.net ?? [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        instrument: {
          exchange: String(r.exchange ?? "NSE"),
          symbol: String(r.tradingsymbol ?? ""),
          instrumentType: "EQUITY" as const,
        },
        product: String(r.product ?? "CNC"),
        quantity: money(Number(r.quantity ?? 0), 4),
        averagePrice: money(Number(r.average_price ?? 0)),
        lastPrice: r.last_price != null ? money(Number(r.last_price)) : undefined,
        pnl: r.pnl != null ? money(Number(r.pnl)) : undefined,
        overnightQuantity: r.overnight_quantity != null ? money(Number(r.overnight_quantity), 4) : undefined,
        dayQuantity: r.day_quantity != null ? money(Number(r.day_quantity), 4) : undefined,
      };
    })
    .filter((p) => Number(p.quantity) !== 0);
}
