import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { PRIMARY_MODEL, FALLBACK_MODELS, toolRegistry } from "../../agent/index.js";
import { getShunopsDashboardHtml } from "../../dashboard/html.js";
import { getShunopsPortalHtml } from "../../dashboard/portal.js";
import { getAuthPageHtml } from "../../dashboard/auth-pages.js";
import { getUserWorkspaceHtml } from "../../dashboard/workspace.js";
import { getPrivacyPolicyHtml, getTermsOfServiceHtml, getAboutHtml } from "../../dashboard/legal-pages.js";
import { findUserBySessionToken, checkDbHealth } from "../db.js";
import { checkRedisHealth } from "../redis.js";

export interface DashboardRouteOptions {
  requireDashboardAuth?: (req: any, reply: any) => Promise<void>;
}

/**
 * Public landing routes: browser dashboard, JSON service index, /dashboard, and /portal.
 */
export async function dashboardRoutes(app: FastifyInstance, opts: DashboardRouteOptions = {}): Promise<void> {
  const preHandler = opts.requireDashboardAuth ? [opts.requireDashboardAuth] : [];

  const renderDashboard = () =>
    getShunopsDashboardHtml({
      models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
      tools: Object.keys(toolRegistry),
      uptimeSeconds: Math.floor(process.uptime()),
    });

  const renderPortal = () => getShunopsPortalHtml();

  app.get("/", async (req, reply) => {
    // If visited from a web browser, check authenticated session
    if (req.headers.accept?.includes("text/html")) {
      const token = (req.cookies as any)?.shunops_user_session;
      if (!token) {
        return reply.redirect("/login");
      }
      const user = await findUserBySessionToken(token);
      if (!user) {
        return reply.redirect("/login");
      }
      if (user.role === "admin") {
        return reply.type("text/html").send(renderDashboard());
      }
      return reply.redirect("/workspace");
    }

    return {
      status: "online",
      name: "ShunopsAI Autonomous Multi-Cloud & DevOps API (Fastify Engine)",
      primaryModel: PRIMARY_MODEL,
      fallbackModels: FALLBACK_MODELS,
      availableTools: Object.keys(toolRegistry),
      endpoints: {
        dashboard: "GET /dashboard (Admin Command Center)",
        workspace: "GET /workspace (User Workspace)",
        portal: "GET /portal (Protected BYOK & Key Hub)",
        health: "GET /health",
        login: "GET /login",
        register: "GET /register",
        sentinelStatus: "GET /api/sentinel/status",
        sentinelHeal: "POST /api/sentinel/heal",
        runTask: "POST /api/task",
        websiteChat: "POST /api/chat",
        pendingApprovals: "GET /api/pending-approvals",
        approveAction: "POST /api/approve",
        githubWebhook: "POST /api/github-webhook",
        cloudAlertWebhook: "POST /api/webhook/cloud-alert",
        embeddableWidget: "GET /widget.js",
      },
      integrations: {
        n8n: "Use 'HTTP Request' node pointing to POST /api/task or import integrations/n8n/shunops-n8n-workflow.json",
        dify: "Use 'API Extension' pointing to POST /api/chat with integrations/dify/dify-tool-openapi.yaml",
      },
    };
  });

  app.get("/dashboard", async (req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");

    const token = (req.cookies as any)?.shunops_user_session;
    if (token) {
      const user = await findUserBySessionToken(token);
      if (user && user.role === "admin") {
        return reply.type("text/html").send(renderDashboard());
      }
      if (user) {
        return reply.redirect("/workspace");
      }
    }

    // Check optional header credentials for CLI / automation
    const authHeader = (req.headers.authorization as string) || "";
    if (authHeader && opts.requireDashboardAuth) {
      try {
        await opts.requireDashboardAuth(req, reply);
        if (reply.sent) return;
        return reply.type("text/html").send(renderDashboard());
      } catch {}
    }

    return reply.redirect("/login");
  });

  // Protected BYOK & Key Hub (Requires authenticated session)
  app.get("/portal", async (req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");

    const token = (req.cookies as any)?.shunops_user_session;
    if (!token) {
      return reply.redirect("/login");
    }
    const user = await findUserBySessionToken(token);
    if (!user) {
      return reply.redirect("/login");
    }

    return reply.type("text/html").send(renderPortal());
  });

  app.get("/connect", async (req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");

    const token = (req.cookies as any)?.shunops_user_session;
    if (!token) {
      return reply.redirect("/login");
    }
    const user = await findUserBySessionToken(token);
    if (!user) {
      return reply.redirect("/login");
    }

    return reply.type("text/html").send(renderPortal());
  });

  // User Authentication Pages (Login & Register)
  app.get("/login", async (_req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.type("text/html").send(getAuthPageHtml("login"));
  });

  app.get("/register", async (_req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.type("text/html").send(getAuthPageHtml("register"));
  });

  // User Private Workspace Dashboard
  app.get("/workspace", async (req, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    const token = (req.cookies as any)?.shunops_user_session;
    if (!token) {
      return reply.redirect("/login");
    }

    const user = await findUserBySessionToken(token);
    if (!user) {
      return reply.redirect("/login");
    }

    return reply.type("text/html").send(getUserWorkspaceHtml(user.username));
  });

  // Legal & Technical Architecture Documentation Pages
  app.get("/privacy", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.type("text/html").send(getPrivacyPolicyHtml());
  });

  app.get("/terms", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.type("text/html").send(getTermsOfServiceHtml());
  });

  app.get("/about", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.type("text/html").send(getAboutHtml());
  });

  app.get("/health", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  // Readiness probe verifying Neon Postgres and Redis connectivity
  app.get("/ready", async (_req, reply) => {
    const dbHealth = await checkDbHealth();
    const redisHealth = await checkRedisHealth();

    const isReady = dbHealth.ok;
    const statusCode = isReady ? 200 : 503;

    reply.status(statusCode);
    return {
      status: isReady ? "ready" : "unhealthy",
      database: dbHealth.status,
      databaseLatencyMs: dbHealth.latencyMs,
      redis: redisHealth.status,
      redisLatencyMs: redisHealth.latencyMs,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });
}
