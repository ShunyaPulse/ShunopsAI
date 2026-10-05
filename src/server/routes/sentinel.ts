import { Router, type Request, type Response } from "express";
import { runComprehensiveSentinelScan, autoHealService } from "../../tools/sentinel.js";

/**
 * Infrastructure Sentinel telemetry and auto-healing endpoints.
 */
export function sentinelRouter(): Router {
  const router = Router();

  router.get("/api/sentinel/status", async (_req: Request, res: Response) => {
    try {
      const summary = await runComprehensiveSentinelScan();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to scan infrastructure: " + err.message });
    }
  });

  router.post("/api/sentinel/heal", async (req: Request, res: Response) => {
    const serviceName = req.body?.serviceName || "all";
    const reason = req.body?.reason;
    try {
      const healResult = await autoHealService(serviceName, reason);
      res.json(healResult);
    } catch (err: any) {
      res.status(500).json({ error: "Self-healing failed: " + err.message });
    }
  });

  return router;
}
