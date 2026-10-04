import { Router, type Request, type Response, type RequestHandler } from "express";
import { runAutonomousAgent } from "../../agent/index.js";

export interface TaskRouterDeps {
  requireAuth: RequestHandler;
  heavyLimiter: RequestHandler;
}

/**
 * Privileged autonomous task execution endpoint.
 * Body: { goal: string, maxSteps?: number, context?: string }
 * Used by Flowise, n8n, Dify, or the dashboard terminal.
 */
export function taskRouter({ requireAuth, heavyLimiter }: TaskRouterDeps): Router {
  const router = Router();

  router.post("/api/task", requireAuth, heavyLimiter, async (req: Request, res: Response) => {
    const body = req.body || {};
    const taskGoal =
      body.goal ||
      body.task ||
      body.prompt ||
      body.message ||
      body.body?.task ||
      body.body?.goal ||
      (typeof body === "string" && body.length > 0 ? body : "Perform autonomous repository and database health check");

    const { maxSteps, context } = body;

    try {
      const result = await runAutonomousAgent(taskGoal, {
        maxSteps: typeof maxSteps === "number" ? maxSteps : 6,
        initialContext: context,
      });

      // Do not return the full history: it can contain file contents and secrets.
      res.json({
        success: result.success,
        finalAnswer: result.finalAnswer,
        stepsTaken: result.stepsTaken,
      });
    } catch (error: any) {
      console.error("[api/task] error:", error?.message);
      res.status(500).json({ success: false, error: "Failed to execute autonomous agent task." });
    }
  });

  return router;
}
