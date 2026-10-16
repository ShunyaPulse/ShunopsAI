import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { runAutonomousAgent, type ProviderKeyOverrides } from "../../agent/index.js";
import { TaskRequestSchema, type TaskRequest } from "../schemas/alert.js";
import { createQueuedTask, getTaskState } from "../taskQueue.js";
import { listUserTasks, saveTaskRecord, checkUserTokenQuota, recordUserTokenUsage } from "../db.js";
import { buildRequestScope, isAdminUser } from "../scope.js";

export interface TaskRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Privileged autonomous task execution endpoint (Fastify Engine with Multi-Tenant Isolation
 * and Stage 8 Real-Time SSE Progress Streaming).
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
      const isAdmin = isAdminUser(user);
      const userId = user?.id && user.id > 0 ? user.id : undefined;

      // Tenant isolation: a signed-in user's run may only touch the accounts
      // they connected themselves, never the operator's infrastructure.
      const scope = await buildRequestScope(user);

      const rawGoal =
        body.goal ||
        body.task ||
        body.prompt ||
        body.message ||
        "Perform autonomous repository and database health check";

      const requestedSteps = typeof body.maxSteps === "number" ? body.maxSteps : 6;
      const maxSteps = isAdmin ? requestedSteps : Math.min(Math.max(1, requestedSteps), 10);
      // Only admin/operator runs may inject privileged system-level `initialContext`;
      // for tenant users, fold `body.context` safely into the user-turn goal.
      const context = isAdmin ? body.context : undefined;
      const taskGoal = !isAdmin && body.context
        ? `Context (user-provided):\n${body.context}\n\nGoal: ${rawGoal}`
        : rawGoal;

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

      const isBYOK = Boolean(isValidGroqFormat || isValidGeminiFormat);
      const keyOverrides: ProviderKeyOverrides | undefined =
        isBYOK || scope.credentials?.github?.token || scope.credentials?.cloudflare
          ? {
              groqApiKey: isValidGroqFormat ? userGroqKey : undefined,
              geminiApiKey: isValidGeminiFormat ? userGeminiKey : undefined,
              githubToken: scope.credentials?.github?.token,
              cloudflareAccountId: scope.credentials?.cloudflare?.accountId,
              cloudflareApiToken: scope.credentials?.cloudflare?.apiToken,
            }
          : undefined;

      // Enforce monthly token quota for non-admin tenant users unless BYOK is used
      if (!isAdmin && userId && !isBYOK) {
        const quotaCheck = await checkUserTokenQuota(userId);
        if (!quotaCheck.allowed) {
          reply.status(429);
          return {
            success: false,
            error: "Monthly token quota reached for your account. Please upgrade or provide a BYOK key.",
          };
        }
      }

      // Check if caller requests async execution via body or HTTP header
      const isAsync =
        Boolean(body.async) ||
        req.headers.prefer === "respond-async" ||
        (req.headers["x-execution-mode"] as string)?.toLowerCase() === "async";

      if (isAsync) {
        const queued = createQueuedTask(
          taskGoal,
          maxSteps,
          context,
          userId,
          keyOverrides,
          scope,
          { isBYOK, isAdmin }
        );
        reply.status(202);
        return {
          success: true,
          status: queued.status,
          taskId: queued.id,
          message: "Task accepted for background processing.",
          pollUrl: `/api/task/${queued.id}`,
        };
      }

      const syncTaskId = `task_${Date.now()}_sync`;
      const wantsSse = String(req.headers.accept || "").includes("text/event-stream");

      // Stage 8 SOTA: Real-Time SSE Streaming Mode when requested via `Accept: text/event-stream`
      if (wantsSse) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const sendSse = (event: string, data: Record<string, unknown>) => {
          try {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {}
        };

        sendSse("start", { taskId: syncTaskId, maxSteps });

        try {
          const result = await runAutonomousAgent(taskGoal, {
            maxSteps,
            ...(context ? { initialContext: context } : {}),
            keyOverrides,
            scope,
            onProgress: (ev) => {
              if (ev.type === "step_start") {
                sendSse("step", { step: ev.step, maxSteps: ev.maxSteps, model: ev.primaryModel });
              } else if (ev.type === "reasoning") {
                sendSse("reasoning", { step: ev.step, model: ev.model, text: ev.text });
              } else if (ev.type === "tool_call") {
                sendSse("tool_call", { step: ev.step, name: ev.name, args: ev.args });
              } else if (ev.type === "tool_result") {
                sendSse("tool_result", {
                  step: ev.step,
                  name: ev.name,
                  preview: ev.preview,
                  isError: ev.isError,
                });
              } else if (ev.type === "final_answer") {
                sendSse("chunk", { text: ev.text });
              }
            },
          });

          if (!isAdmin && userId && !isBYOK) {
            const inTokens = result.usage?.promptTokens || Math.ceil(taskGoal.length / 4);
            const outTokens =
              result.usage?.completionTokens || Math.ceil((result.finalAnswer || "").length / 4);
            recordUserTokenUsage(userId, inTokens, outTokens).catch(() => {});
          }

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

          sendSse("done", {
            success: result.success,
            taskId: syncTaskId,
            stepsTaken: result.stepsTaken,
            stepsLog: result.stepsLog || [],
            usedModel: result.usedModel,
            finalAnswer: result.finalAnswer,
          });
        } catch (err: any) {
          sendSse("error", { error: "Failed to execute autonomous agent task." });
        } finally {
          reply.raw.end();
        }
        return reply;
      }

      // Synchronous JSON execution (default for zero-config n8n compatibility)
      try {
        const result = await runAutonomousAgent(taskGoal, {
          maxSteps,
          ...(context ? { initialContext: context } : {}),
          keyOverrides,
          scope,
        });

        if (!isAdmin && userId && !isBYOK) {
          const inTokens = result.usage?.promptTokens || Math.ceil(taskGoal.length / 4);
          const outTokens = result.usage?.completionTokens || Math.ceil((result.finalAnswer || "").length / 4);
          recordUserTokenUsage(userId, inTokens, outTokens).catch(() => {});
        }

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
          stepsLog: result.stepsLog || [],
          usedModel: result.usedModel,
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

  // Status check endpoint for async / queued tasks with strict multi-tenant isolation
  app.get<{ Params: { taskId: string } }>(
    "/api/task/:taskId",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const taskId = req.params.taskId;
      if (!/^task_\d+_[a-zA-Z0-9_-]+$/.test(taskId)) {
        reply.status(400);
        return { success: false, error: "Invalid task ID format." };
      }

      const task = await getTaskState(taskId);
      if (!task) {
        reply.status(404);
        return { success: false, error: "Task not found." };
      }

      const user = (req as any).user;
      if (!isAdminUser(user) && (!task.userId || task.userId !== user?.id)) {
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
      const isAdmin = isAdminUser(user);
      const userId = typeof user?.id === "number" && user.id > 0 ? user.id : 0;
      if (!isAdmin && userId <= 0) {
        return { success: true, tasks: [] };
      }
      const tasks = await listUserTasks(userId, 50, { isAdmin });
      return { success: true, tasks };
    }
  );
}
