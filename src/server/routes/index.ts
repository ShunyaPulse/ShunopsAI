import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { dashboardRoutes } from "./dashboard.js";
import { sentinelRoutes } from "./sentinel.js";
import { taskRoutes } from "./task.js";
import { chatRoutes } from "./chat.js";
import { approvalsRoutes } from "./approvals.js";
import { webhookRoutes } from "./webhook.js";
import { widgetRoutes } from "./widget.js";

export interface MountRoutesDeps {
  requireAuth: preHandlerHookHandler;
  requireDashboardAuth: preHandlerHookHandler;
}

/**
 * Register all Fastify route plugins onto the application.
 */
export async function registerRoutes(app: FastifyInstance, deps: MountRoutesDeps): Promise<void> {
  await app.register(dashboardRoutes, { requireDashboardAuth: deps.requireDashboardAuth });
  await app.register(sentinelRoutes, {
    requireDashboardAuth: deps.requireDashboardAuth,
    requireAuth: deps.requireAuth,
  });
  await app.register(taskRoutes, { requireAuth: deps.requireAuth });
  await app.register(chatRoutes);
  await app.register(approvalsRoutes, { requireAuth: deps.requireAuth });
  await app.register(webhookRoutes);
  await app.register(widgetRoutes);
}
