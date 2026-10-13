import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { runAutonomousAgent } from "../../agent/index.js";
import { TaskRequestSchema, type TaskRequest } from "../schemas/alert.js";
import { createQueuedTask, getTaskState } from "../taskQueue.js";
import { listUserTasks, saveTaskRecord } from "../db.js";
import { buildRequestScope } from "../scope.js";

export interface TaskRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Privileged autonomous task execution endpoint (Fastify Engine with Multi-Tenant Isolation).
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
      const user = (req as any).user;
      const userId = user?.id && user.id > 0 ? user.id : undefined;

      // Tenant isolation: a signed-in user's run may only touch the accounts
      // they connected themselves, never the operator's infrastructure.
      const scope = await buildRequestScope(user);

      const taskGoal =
        body.goal ||
        body.task ||
        body.prompt ||
        body.message ||
        "Perform autonomous repository and database health check";

      const maxSteps = typeof body.maxSteps === "number" ? body.maxSteps : 6;
      const context = body.context;

      const userGroqKey = (req.headers["x-groq-key"] as string | undefined)?.trim();
      const userGeminiKey = (req.headers["x-gemini-key"] as string | undefined)?.trim();

      const isValidGroqFormat = Boolean(userGroqKey && /^gsk_[a-zA-Z0-9_-]{20,}$/.test(userGroqKey));
      const isValidGeminiFormat = Boolean(userGeminiKey && /^AIzaSy[a-zA-Z0-9_-]{25,}$/.test(userGeminiKey));

      if ((userGroqKey && !isValidGroqFormat) || (userGeminiKey && !isValidGeminiFormat)) {
        reply.status(400);
        return {
          success: false,
          error: "Invalid BYOK API key format provided in request headers.",
        };
      }

      const keyOverrides:
        | { groqApiKey?: string | undefined; geminiApiKey?: string | undefined }
        | undefined =
        isValidGroqFormat || isValidGeminiFormat
          ? {
              groqApiKey: isValidGroqFormat ? userGroqKey : undefined,
              geminiApiKey: isValidGeminiFormat ? userGeminiKey : undefined,
            }
          : undefined;

      // Check if caller requests async execution via body or HTTP header
      const isAsync =
        Boolean(body.async) ||
        req.headers.prefer === "respond-async" ||
        (req.headers["x-execution-mode"] as string)?.toLowerCase() === "async";

      if (isAsync) {
        const queued = createQueuedTask(taskGoal, maxSteps, context, userId, keyOverrides, scope);
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
      const syncTaskId = `task_${Date.now()}_sync`;
      try {
        const result = await runAutonomousAgent(taskGoal, {
          maxSteps,
          ...(context ? { initialContext: context } : {}),
          keyOverrides,
          scope,
        });

        // Record task outcome in database
        saveTaskRecord({
          id: syncTaskId,
          userId,
          goal: taskGoal,
          status: result.success ? "COMPLETED" : "FAILED",
          stepsTaken: result.stepsTaken,
          finalAnswer: result.finalAnswer || undefined,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }).catch(() => {});

        return {
          success: result.success,
          finalAnswer: result.finalAnswer,
          stepsTaken: result.stepsTaken,
          taskId: syncTaskId,
        };
      } catch (error: any) {
        req.log.error(error);
        saveTaskRecord({
          id: syncTaskId,
          userId,
          goal: taskGoal,
          status: "FAILED",
          error: "Failed to execute autonomous agent task.",
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }).catch(() => {});

        reply.status(500);
        return { success: false, error: "Failed to execute autonomous agent task." };
      }
    }
  );

  // Status check endpoint for async / queued tasks with multi-tenant isolation
  app.get<{ Params: { taskId: string } }>(
    "/api/task/:taskId",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const taskId = req.params.taskId;
      if (!/^task_\d+_[a-f0-9_]+$/.test(taskId)) {
        reply.status(400);
        return { success: false, error: "Invalid task ID format." };
      }

      const task = await getTaskState(taskId);
      if (!task) {
        reply.status(404);
        return { success: false, error: "Task not found." };
      }

      const user = (req as any).user;
      // Multi-tenant task isolation: If user is not admin, prevent viewing tasks belonging to other accounts
      if (user && user.role !== "admin" && task.userId && task.userId !== user.id) {
        reply.status(403);
        return { success: false, error: "Access denied. You can only view tasks belonging to your account." };
      }

      return { success: true, task };
    }
  );

  // List all tasks for the authenticated user
  app.get(
    "/api/tasks",
    { preHandler: [requireAuth] },
    async (req) => {
      const user = (req as any).user;
      const userId = user?.id || 0;
      const tasks = await listUserTasks(userId);
      return { success: true, tasks };
    }
  );
}
