import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyRawBody from "fastify-raw-body";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
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

  // Interactive Swagger / OpenAPI Documentation
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "ShunopsAI Autonomous Multi-Cloud & DevOps API",
        description: "Autonomous ReAct Agent & Multi-Cloud Sentinel Engine (Cloud Run, OCI Redis, Neon, Cloudflare, Kaggle).",
        version: "1.0.0",
      },
      servers: [{ url: `http://${config.host}:8080`, description: "ShunopsAI Host" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT/Token",
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  const requireAuth = createRequireAuth({ apiToken: config.apiToken, host: config.host });

  await registerRoutes(app, { requireAuth });

  return app;
}
