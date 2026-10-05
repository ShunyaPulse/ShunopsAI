import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { runAutonomousAgent } from "../../agent/index.js";
import { TaskRequestSchema, type TaskRequest } from "../schemas/alert.js";
import { createQueuedTask, getTaskState } from "../taskQueue.js";

export interface TaskRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Privileged autonomous task execution endpoint (Fastify Engine with Hybrid Lifecycle).
 * Body: { goal?: string, task?: string, maxSteps?: number, context?: string, async?: boolean }
 */
export async function taskRoutes(app: FastifyInstance, options: TaskRouteOptions): Promise<void> {
  const { requireAuth } = options;

  app.post<{ Body: TaskRequest }>(
    "/api/task",
    {
      preHandler: [requireAuth],
      schema: {
        body: TaskRequestSchema,
      },
    },
    async (req, reply) => {
      const body = req.body || {};
      const taskGoal =
        body.goal ||
        body.task ||
        body.prompt ||
        body.message ||
        "Perform autonomous repository and database health check";

      const maxSteps = typeof body.maxSteps === "number" ? body.maxSteps : 6;
      const context = body.context;

      // Check if caller requests async execution via body or HTTP header
      const isAsync =
        Boolean(body.async) ||
        req.headers.prefer === "respond-async" ||
        (req.headers["x-execution-mode"] as string)?.toLowerCase() === "async";

      if (isAsync) {
        const queued = createQueuedTask(taskGoal, maxSteps, context);
        reply.status(202);
        return {
          success: true,
          status: queued.status,
          taskId: queued.id,
          message: "Task accepted for background processing.",
          pollUrl: `/api/task/${queued.id}`,
        };
      }

      // Synchronous execution (default for zero-config n8n compatibility)
      try {
        const result = await runAutonomousAgent(taskGoal, {
          maxSteps,
          ...(context ? { initialContext: context } : {}),
        });

        return {
          success: result.success,
          finalAnswer: result.finalAnswer,
          stepsTaken: result.stepsTaken,
        };
      } catch (error: any) {
        req.log.error(error);
        reply.status(500);
        return { success: false, error: "Failed to execute autonomous agent task: " + error?.message };
      }
    }
  );

  // Status check endpoint for async / queued tasks
  app.get<{ Params: { taskId: string } }>("/api/task/:taskId", async (req, reply) => {
    const task = getTaskState(req.params.taskId);
    if (!task) {
      reply.status(404);
      return { success: false, error: `Task '${req.params.taskId}' not found.` };
    }
    return { success: true, task };
  });
}
