import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyRawBody from "fastify-raw-body";
import fastifyCookie from "@fastify/cookie";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { createRequireAuth, createRequireDashboardAuth } from "./middleware/auth.js";
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
  /** Dashboard web UI Basic Auth username. */
  dashboardUsername: string;
  /** Dashboard web UI Basic Auth password. */
  dashboardPassword: string;
}

/**
 * Read the server configuration from the process environment.
 */
export function loadAppConfig(): AppConfig {
  return {
    apiToken: process.env.AGENT_API_TOKEN || process.env.API_SECRET || "",
    host: process.env.HOST || "0.0.0.0",
    corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 30,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW) || 60_000,
    dashboardUsername: process.env.DASHBOARD_USERNAME || "admin",
    dashboardPassword: process.env.DASHBOARD_PASSWORD || process.env.API_SECRET || "",
  };
}

/**
 * Build the fully-wired Fastify application with TypeBox validation & raw body support.
 */
export async function createApp(config: AppConfig = loadAppConfig()): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === "test";
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: process.env.LOG_LEVEL || "info",
          redact: [
            "req.headers.authorization",
            "req.headers['x-api-key']",
            "req.headers['x-groq-key']",
            "req.headers['x-gemini-key']",
            "req.headers.cookie",
            "password",
            "token",
            "newPassword",
            "currentPassword",
            "apiKey",
          ],
        },
    bodyLimit: 2 * 1024 * 1024, // 2MB
    // Only trust X-Forwarded-* when explicitly running behind a known proxy.
    trustProxy: process.env.TRUST_PROXY === "true",
  });

  // Preserve raw request body buffers for cryptographic HMAC signature verification
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: true,
    encoding: false, // returns Buffer
    runFirst: true,
  });

  // Secure HTTP-Only Cookie Support for User Authentication
  await app.register(fastifyCookie, {
    secret: config.apiToken || "shunops-cookie-signing-secret-2026",
    parseOptions: {},
  });

  // Malicious URL probe filter (blocks vulnerability scanners, traversal, SQLi, and shell probes)
  // Directly mirrors the security baseline from Kanban Cloud middleware.ts
  // (the CSRF exemptions used by the mutation check below are declared next to it)
  /**
 * Mutation endpoints exempt from the ambient-credential CSRF check, because they
 * authenticate per request: HMAC (GitHub/cloud webhooks), a shared secret
 * header, or the bot-shield challenge that guards anonymous chat.
 */
const CSRF_EXEMPT_MUTATION_PREFIXES = [
  "/api/github-webhook",
  "/api/webhook/",
  "/api/chat",
  "/api/shield/",
  "/api/widget",
  "/api/action/confirm",
];

const MALICIOUS_PROBE_REGEX =
    /(?:\.env|\.git|wp-admin|wp-login|xmlrpc|phpinfo|eval\(|<script|\.\.[\/\\]|etc\/passwd|union\s+select|sleep\(\d+\)|benchmark\(|drop\s+table|exec\s*\(|cmd\.exe|\/bin\/sh)/i;

  app.addHook("onRequest", async (req, reply) => {
    const rawUrl = req.raw.url || req.url;
    if (MALICIOUS_PROBE_REGEX.test(rawUrl)) {
      reply.status(400).send({ error: "Bad Request: Security policy violation" });
      return reply;
    }

    // CSRF Protection: For state-changing mutations under /api/ (login, register, chat, etc.)
    // Ensure request origin matches host, or sec-fetch-site is 'same-origin'
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method) && req.url.startsWith("/api/")) {
      // Endpoints that authenticate with a per-request header, signature or
      // challenge rather than ambient browser credentials. A cross-site marker
      // is not evidence of CSRF for them, and blocking it breaks the two
      // integrations that are cross-site by design: the embeddable widget posts
      // to /api/chat from customer domains, and monitoring services (GCP Cloud
      // Monitoring, UptimeRobot, BetterStack) post to the alert webhook from
      // outside the browser.
      if (!CSRF_EXEMPT_MUTATION_PREFIXES.some((prefix) => req.url.startsWith(prefix))) {
        const origin = req.headers.origin;
        const host = req.headers.host;
        const secFetchSite = req.headers["sec-fetch-site"];

        if (secFetchSite === "cross-site") {
          reply.status(403).send({ error: "Forbidden: Cross-site request rejected" });
          return reply;
        }

        if (origin && host) {
          try {
            const originHost = new URL(origin).host;
            if (originHost !== host && !config.corsOrigins.includes(origin)) {
              reply.status(403).send({ error: "Forbidden: Cross-origin mutation rejected" });
              return reply;
            }
          } catch {
            reply.status(400).send({ error: "Bad Request: Invalid origin header" });
            return reply;
          }
        }
      }
    }
  });

  // CORS protection: cross-origin access is DENIED by default. Only when the
  // operator explicitly lists origins do we allow them (and then credentials).
  // Reflecting arbitrary origins while sending credentials is unsafe.
  const hasCorsOrigins = config.corsOrigins.length > 0;
  await app.register(cors, {
    origin: hasCorsOrigins ? config.corsOrigins : false,
    credentials: hasCorsOrigins,
  });

  // Baseline security headers on every response (no new dependency needed).
  // Mirrors patterns from SaralGati middleware.ts for consistency across the org.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    // HSTS: enforce HTTPS for 2 years (matching SaralGati)
    reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    // Disable legacy XSS auditor (OWASP guidance: its filter mode introduced its own vulnerabilities)
    reply.header("X-XSS-Protection", "0");
    // Restrict powerful browser features
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
    // Deliberately minimal CSP: it restricts framing/objects without breaking
    // the dashboard's inline styles/scripts (no default-src directive).
    if (!reply.hasHeader("Content-Security-Policy")) {
      reply.header(
        "Content-Security-Policy",
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
      );
    }
    return payload;
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

  const authOpts = {
    apiToken: config.apiToken,
    host: config.host,
    dashboardUsername: config.dashboardUsername,
    dashboardPassword: config.dashboardPassword,
  };

  const requireAuth = createRequireAuth(authOpts);
  const requireDashboardAuth = createRequireDashboardAuth(authOpts);

  // Gate the interactive API docs behind the dashboard credentials so the full
  // API surface isn't advertised to unauthenticated callers.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/docs" || req.url.startsWith("/docs/")) {
      await requireDashboardAuth(req, reply);
    }
  });

  await registerRoutes(app, { requireAuth, requireDashboardAuth });

  return app;
}
