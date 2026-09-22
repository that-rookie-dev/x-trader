import { AppError } from "@xtrader/domain";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../config/logger.js";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const id = req.requestId;
    if (err instanceof AppError) {
      log.warn({ err, requestId: id, code: err.code }, err.message);
      res.status(err.status).json({
        error: { code: err.code, message: err.message, requestId: id },
      });
      return;
    }
    const message = err instanceof Error ? err.message : "internal error";
    log.error({ err, requestId: id }, "unhandled error");
    res.status(500).json({
      error: { code: "INTERNAL", message: "Internal server error", requestId: id },
    });
    void message;
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

export function originGuard(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    if (origin !== allowedOrigin) {
      res.status(403).json({ error: { code: "CSRF_ORIGIN", message: "Origin not allowed" } });
      return;
    }
    next();
  };
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      session?: {
        id: string;
        userId: string;
      };
    }
  }
}
