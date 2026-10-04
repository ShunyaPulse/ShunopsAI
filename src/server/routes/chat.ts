import { Router, type Request, type Response, type RequestHandler } from "express";
import { runAutonomousAgent, toolRegistry, type ToolName } from "../../agent/index.js";

export interface ChatRouterDeps {
  chatLimiter: RequestHandler;
}

/**
 * Public conversational endpoint for website visitors.
 * Body: { message: string, history?: string }
 *
 * Exposes NO tools, so visitor input cannot trigger shell/fs/cloud actions.
 */
export function chatRouter({ chatLimiter }: ChatRouterDeps): Router {
  const router = Router();

  router.post("/api/chat", chatLimiter, async (req: Request, res: Response) => {
    const { message, history } = req.body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing required parameter 'message'." });
      return;
    }

    try {
      const goal = `Answer this website visitor query politely and helpfully: "${message}". Context/History: ${history || "None"}`;
      const result = await runAutonomousAgent(goal, {
        maxSteps: 3,
        disabledTools: Object.keys(toolRegistry) as ToolName[],
      });

      res.json({
        reply: result.finalAnswer || "I'm here to help! Could you please clarify your question?",
        success: result.success,
      });
    } catch (error: any) {
      console.error("[api/chat] error:", error?.message);
      res.status(500).json({
        reply: "Sorry, I encountered an issue processing your request. Please try again shortly.",
      });
    }
  });

  return router;
}
