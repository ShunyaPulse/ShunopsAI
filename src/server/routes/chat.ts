import type { FastifyInstance } from "fastify";
import { runAutonomousAgent, toolRegistry, type ToolName } from "../../agent/index.js";
import { ChatRequestSchema, type ChatRequest } from "../schemas/alert.js";

/**
 * Public conversational endpoint for website visitors (Fastify Engine).
 * Body: { message: string, history?: string }
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatRequest }>(
    "/api/chat",
    {
      schema: {
        body: ChatRequestSchema,
      },
    },
    async (req, reply) => {
      const { message, history } = req.body;

      try {
        const goal = `Answer this website visitor query politely and helpfully: "${message}". Context/History: ${history || "None"}`;
        const result = await runAutonomousAgent(goal, {
          maxSteps: 3,
          disabledTools: Object.keys(toolRegistry) as ToolName[],
        });

        return {
          reply: result.finalAnswer || "I'm here to help! Could you please clarify your question?",
          success: result.success,
        };
      } catch (error: any) {
        req.log.error(error);
        reply.status(500);
        return {
          reply: "Sorry, I encountered an issue processing your request. Please try again shortly.",
        };
      }
    }
  );
}
