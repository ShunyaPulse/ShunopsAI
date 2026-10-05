import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { PRIMARY_MODEL, FALLBACK_MODELS, toolRegistry } from "../../agent/index.js";
import { getShunopsDashboardHtml } from "../../dashboard/html.js";

export interface DashboardRouteOptions {
  requireDashboardAuth?: preHandlerHookHandler;
}

/**
 * Public landing routes: browser dashboard, JSON service index, and /dashboard.
 */
export async function dashboardRoutes(app: FastifyInstance, opts: DashboardRouteOptions = {}): Promise<void> {
  const preHandler = opts.requireDashboardAuth ? [opts.requireDashboardAuth] : [];

  const renderDashboard = () =>
    getShunopsDashboardHtml({
      models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
      tools: Object.keys(toolRegistry),
      uptimeSeconds: Math.floor(process.uptime()),
    });

  app.get("/", { preHandler }, async (req, reply) => {
    // If visited from a web browser, render the ShunopsAI Command Center UI
    if (req.headers.accept?.includes("text/html")) {
      return reply.type("text/html").send(renderDashboard());
    }

    return {
      status: "online",
      name: "ShunopsAI Autonomous Multi-Cloud & DevOps API (Fastify Engine)",
      primaryModel: PRIMARY_MODEL,
      fallbackModels: FALLBACK_MODELS,
      availableTools: Object.keys(toolRegistry),
      endpoints: {
        dashboard: "GET / (in browser)",
        health: "GET /health",
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

  app.get("/dashboard", { preHandler }, async (_req, reply) => {
    return reply.type("text/html").send(renderDashboard());
  });

  app.get("/health", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });
}
