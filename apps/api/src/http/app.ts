import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler, originGuard, requestIdMiddleware } from "../http/middleware.js";
import { notFound, registerRoutes } from "../http/routes.js";
import type { AppServices } from "../app/context.js";

export function createHttpApp(services: AppServices) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(
    cors({
      origin: services.env.APP_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(originGuard(services.env.APP_ORIGIN));
  registerRoutes(app, services);
  app.use(notFound);
  app.use(errorHandler(services.log));
  return app;
}
