import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { getAutonomyStatus, setAutonomyPaused, isAutonomyPaused } from "../../tools/autonomy-state.js";

export interface AutonomyRouteOptions {
  requireAuth?: preHandlerHookHandler;
  requireDashboardAuth?: preHandlerHookHandler;
}

/**
 * Autonomy Master Control routes: pause or resume all background automations and AI.
 */
export async function autonomyRoutes(app: FastifyInstance, opts: AutonomyRouteOptions = {}): Promise<void> {
  const readPreHandler = opts.requireDashboardAuth ? [opts.requireDashboardAuth] : [];
  const writePreHandler = opts.requireAuth ? [opts.requireAuth] : [];

  app.get("/api/autonomy/status", { preHandler: readPreHandler }, async (_req, reply) => {
    try {
      const status = await getAutonomyStatus();
      return status;
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  app.post("/api/autonomy/pause", { preHandler: writePreHandler }, async (req, reply) => {
    try {
      const body = (req.body as any) || {};
      const reason = body.reason || "Paused via ShunopsAI Command Center";
      const status = await setAutonomyPaused(true, "dashboard_admin", reason);
      return {
        success: true,
        message: "⚠️ All automatic background operations and AI inference are now PAUSED.",
        status,
      };
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  app.post("/api/autonomy/resume", { preHandler: writePreHandler }, async (_req, reply) => {
    try {
      const status = await setAutonomyPaused(false, "dashboard_admin", "Resumed by user");
      return {
        success: true,
        message: "▶️ All automatic background operations and AI inference are now RESUMED.",
        status,
      };
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  app.post("/api/autonomy/toggle", { preHandler: writePreHandler }, async (req, reply) => {
    try {
      const current = await isAutonomyPaused();
      const nextPaused = !current;
      const status = await setAutonomyPaused(
        nextPaused,
        "dashboard_admin",
        nextPaused ? "Paused via toggle button" : "Resumed via toggle button"
      );
      return {
        success: true,
        paused: nextPaused,
        message: nextPaused
          ? "⚠️ All automatic background operations and AI inference are now PAUSED."
          : "▶️ All automatic background operations and AI inference are now RESUMED.",
        status,
      };
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });
}
