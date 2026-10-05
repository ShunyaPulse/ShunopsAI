import type { FastifyInstance } from "fastify";
import { runComprehensiveSentinelScan, autoHealService } from "../../tools/sentinel.js";

/**
 * Infrastructure Sentinel telemetry and auto-healing endpoints.
 */
export async function sentinelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sentinel/status", async (_req, reply) => {
    try {
      const summary = await runComprehensiveSentinelScan();
      return summary;
    } catch (err: any) {
      reply.status(500);
      return { error: "Failed to scan infrastructure: " + err.message };
    }
  });

  app.post("/api/sentinel/heal", async (req, reply) => {
    const body = (req.body as any) || {};
    const serviceName = body?.serviceName || "all";
    const reason = body?.reason;
    try {
      const healResult = await autoHealService(serviceName, reason);
      return healResult;
    } catch (err: any) {
      reply.status(500);
      return { error: "Self-healing failed: " + err.message };
    }
  });
}
