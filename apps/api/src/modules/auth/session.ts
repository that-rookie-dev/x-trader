import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { appSessions, brokerAccounts } from "../../db/schema.js";
import type { CryptoService } from "../../security/crypto.js";

const COOKIE = "xtrader_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function sessionCookieName(): string {
  return COOKIE;
}

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly secureCookie: boolean,
  ) {}

  attachCookie(res: Response, rawToken: string): void {
    res.cookie(COOKIE, rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.secureCookie,
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(COOKIE, { path: "/" });
  }

  async create(userId: string, res: Response): Promise<void> {
    const raw = this.crypto.randomToken(32);
    const tokenHash = this.crypto.hash(raw);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(appSessions).values({
      userId,
      tokenHash,
      expiresAt,
    });
    this.attachCookie(res, raw);
  }

  async resolve(req: Request): Promise<{ id: string; userId: string } | null> {
    const raw = req.cookies?.[COOKIE] as string | undefined;
    if (!raw) return null;
    const tokenHash = this.crypto.hash(raw);
    const [row] = await this.db
      .select()
      .from(appSessions)
      .where(
        and(eq(appSessions.tokenHash, tokenHash), isNull(appSessions.revokedAt), gt(appSessions.expiresAt, new Date())),
      )
      .limit(1);
    if (!row) return null;
    return { id: row.id, userId: row.userId };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db
      .update(appSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(appSessions.userId, userId), isNull(appSessions.revokedAt)));
  }

  async instanceLinked(): Promise<boolean> {
    const [row] = await this.db.select({ id: brokerAccounts.id }).from(brokerAccounts).limit(1);
    return Boolean(row);
  }

  middleware(mode: "required" | "optional" = "required") {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const session = await this.resolve(req);
        if (session) {
          req.session = session;
          next();
          return;
        }
        if (mode === "optional") {
          next();
          return;
        }
        throw new UnauthorizedError();
      } catch (error) {
        next(error);
      }
    };
  }
}

export { desc };
