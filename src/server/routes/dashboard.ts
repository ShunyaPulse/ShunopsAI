import { Router, type Request, type Response } from "express";
import { PRIMARY_MODEL, FALLBACK_MODELS, toolRegistry } from "../../agent/index.js";
import { getShunopsDashboardHtml } from "../../dashboard/html.js";

/**
 * Public landing routes: browser dashboard, JSON service index, and /dashboard.
 */
export function dashboardRouter(): Router {
  const router = Router();

  const renderDashboard = () =>
    getShunopsDashboardHtml({
      models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
      tools: Object.keys(toolRegistry),
      uptimeSeconds: Math.floor(process.uptime()),
    });

  router.get("/", (req: Request, res: Response) => {
    // If visited from a web browser, render the ShunopsAI Command Center UI
    if (req.headers.accept?.includes("text/html")) {
      res.type("text/html").send(renderDashboard());
      return;
    }

    res.json({
      status: "online",
      name: "ShunopsAI Autonomous Multi-Cloud & DevOps API",
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
        embeddableWidget: "GET /widget.js",
      },
      integrations: {
        n8n: "Use 'HTTP Request' node pointing to POST /api/task or import integrations/n8n/shunops-n8n-workflow.json",
        dify: "Use 'API Extension' pointing to POST /api/chat with integrations/dify/dify-tool-openapi.yaml",
      },
    });
  });

  router.get("/dashboard", (_req: Request, res: Response) => {
    res.type("text/html").send(renderDashboard());
  });

  router.get("/health", (_req: Request, res: Response) => {
    // Public endpoint: report liveness only, not which secrets are configured.
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  return router;
}
