import express, { type Express, type Request } from "express";
import cors from "cors";
import { createRequireAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { mountRoutes } from "./routes/index.js";

export interface AppConfig {
  /** Bearer token guarding privileged endpoints. */
  apiToken: string;
  /** Interface the server binds to. */
  host: string;
  /** Allowed CORS origins (empty = deny cross-origin). */
  corsOrigins: string[];
  /** Requests allowed per window on heavy endpoints. */
  rateLimitMax: number;
  /** Rate-limit window in milliseconds. */
  rateLimitWindowMs: number;
}

/**
 * Read the server configuration from the process environment.
 */
export function loadAppConfig(): AppConfig {
  return {
    apiToken: process.env.AGENT_API_TOKEN || process.env.API_SECRET || "",
    host: process.env.HOST || "127.0.0.1",
    corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 20,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW) || 60_000,
  };
}

/**
 * Build the fully-wired Express application.
 */
export function createApp(config: AppConfig = loadAppConfig()): Express {
  const app = express();

  // Middleware — capture raw body so webhook signatures can be verified.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Standard CORS protection
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: true,
    })
  );

  const requireAuth = createRequireAuth({ apiToken: config.apiToken, host: config.host });
  const heavyLimiter = rateLimit(config.rateLimitMax, config.rateLimitWindowMs);
  const chatLimiter = rateLimit(60, 60_000);

  mountRoutes(app, { requireAuth, heavyLimiter, chatLimiter });

  return app;
}
