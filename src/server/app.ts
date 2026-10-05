import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyRawBody from "fastify-raw-body";
import { createRequireAuth } from "./middleware/auth.js";
import { registerRoutes } from "./routes/index.js";

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
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 30,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW) || 60_000,
  };
}

/**
 * Build the fully-wired Fastify application with TypeBox validation & raw body support.
 */
export async function createApp(config: AppConfig = loadAppConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024, // 2MB
  });

  // Preserve raw request body buffers for cryptographic HMAC signature verification
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: true,
    encoding: false, // returns Buffer
    runFirst: true,
  });

  // CORS protection
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
  });

  // Rate Limiting protection
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  const requireAuth = createRequireAuth({ apiToken: config.apiToken, host: config.host });

  await registerRoutes(app, { requireAuth });

  return app;
}
