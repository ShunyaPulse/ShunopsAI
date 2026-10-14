import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { runComprehensiveSentinelScan, autoHealService } from "../../tools/sentinel.js";
import { isAdminUser } from "../scope.js";

export interface SentinelRouteOptions {
  requireDashboardAuth?: preHandlerHookHandler;
  requireAuth?: preHandlerHookHandler;
}

/**
 * Infrastructure Sentinel telemetry and auto-healing endpoints.
 */
export async function sentinelRoutes(app: FastifyInstance, opts: SentinelRouteOptions = {}): Promise<void> {
  const statusPreHandler = opts.requireDashboardAuth ? [opts.requireDashboardAuth] : [];
  const healPreHandler = opts.requireAuth ? [opts.requireAuth] : [];

  app.get("/api/sentinel/status", { preHandler: statusPreHandler }, async (req, reply) => {
    try {
      const summary = await runComprehensiveSentinelScan();
      return summary;
    } catch (err: any) {
      // Raw driver/cloud errors can carry internal hostnames, ports, or
      // connection-string fragments. Keep them server-side and return a
      // generic message to the caller.
      req.log.error({ err }, "[Sentinel] Infrastructure scan failed");
      reply.status(500);
      return { error: "Failed to scan infrastructure. See server logs for details." };
    }
  });

  app.post("/api/sentinel/heal", { preHandler: healPreHandler }, async (req, reply) => {
    // Only administrator/operator callers may trigger host infrastructure self-healing
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return { error: "Access denied. Administrator privileges required to trigger infrastructure self-healing." };
    }

    const body = (req.body as any) || {};
    const serviceName = body?.serviceName || "all";
    const reason = body?.reason;
    try {
      const healResult = await autoHealService(serviceName, reason);
      return healResult;
    } catch (err: any) {
      // Same rule as the scan endpoint: never echo provider/driver internals.
      req.log.error({ err, serviceName }, "[Sentinel] Self-healing failed");
      reply.status(500);
      return { error: "Self-healing failed. See server logs for details." };
    }
  });
}
