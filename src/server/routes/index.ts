import type { Express, RequestHandler } from "express";
import { dashboardRouter } from "./dashboard.js";
import { sentinelRouter } from "./sentinel.js";
import { taskRouter } from "./task.js";
import { chatRouter } from "./chat.js";
import { approvalsRouter } from "./approvals.js";
import { webhookRouter } from "./webhook.js";
import { widgetRouter } from "./widget.js";

export interface MountRoutesDeps {
  requireAuth: RequestHandler;
  heavyLimiter: RequestHandler;
  chatLimiter: RequestHandler;
}

/**
 * Mount every HTTP route on the given Express application.
 */
export function mountRoutes(app: Express, deps: MountRoutesDeps): void {
  app.use(dashboardRouter());
  app.use(sentinelRouter());
  app.use(taskRouter({ requireAuth: deps.requireAuth, heavyLimiter: deps.heavyLimiter }));
  app.use(chatRouter({ chatLimiter: deps.chatLimiter }));
  app.use(approvalsRouter({ requireAuth: deps.requireAuth }));
  app.use(webhookRouter());
  app.use(widgetRouter());
}
