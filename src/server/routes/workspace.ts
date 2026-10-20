import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  findUserBySessionToken,
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  createApiKey,
  listUserApiKeys,
  deleteApiKey,
  listUserPlatformCredentials,
  upsertUserPlatformCredential,
  deleteUserPlatformCredential,
  getUserCredentialBundle,
  PLATFORM_SPECS,
  CredentialVaultError,
  isVaultConfigured,
} from "../db.js";
import {
  McpHttpClient,
  allowMcpEndpoint,
  assertAllowedMcpUrl,
  isBuiltInMcpEndpoint,
  KNOWN_ALLOWED_MCP_HOSTS,
} from "../../agent/mcp/client.js";
import {
  executeManageWorkspaceFiles,
  executeManageAgentTasks,
  executeManageAgentMemory,
  executeManageAgentSchedules,
  getTenantAgenticSnapshot,
  hydrateTenantAgenticState,
  syncTenantAgenticState,
  persistTenantAgenticState,
  resolveTenantKey,
  type ScheduledActionType,
} from "../../tools/agentic.js";
import { executeAgentSwarm, getTenantSwarmHistory, type SwarmSubAgentSpec, type SwarmExecutionMode } from "../../agent/swarm.js";
import { buildRequestScope } from "../scope.js";
import { isPrivateHost } from "../../tools/cloud.js";
import { getClientIp, checkDistributedSubnetQuota } from "../middleware/ratelimit.js";
import { verifyCloudflareTurnstile, verifyShieldSolution } from "../middleware/bot-shield.js";

/**
 * Tools the built-in sovereign `/api/mcp` server actually implements. It
 * advertises exactly what its `tools/call` branch can run: listing tools the
 * server cannot execute just makes the agent report phantom failures.
 */
const BUILT_IN_MCP_TOOLS = [
  {
    name: "execute_sandboxed_code",
    description: "Secure isolated in-memory V8 code execution sandbox (no host filesystem or network)",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["code"],
    },
  },
  {
    name: "calculate_math_expression",
    description: "Arithmetic expression solver, evaluated inside the isolated sandbox",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
  {
    name: "manage_workspace_files",
    description: "Create, read, append, list, search, or delete files in the isolated Agent Workspace File System",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["write", "append", "read", "list", "delete", "search"] },
        filename: { type: "string" },
        content: { type: "string" },
        query: { type: "string" },
      },
      required: ["operation"],
    },
  },
  {
    name: "manage_agent_tasks",
    description: "Manage the persistent Agent Task Planner & Checklist (create_plan, add_task, update_task, list_tasks, clear_completed)",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create_plan", "add_task", "update_task", "list_tasks", "clear_completed"] },
        tasks: { type: "array", items: { type: "string" } },
        title: { type: "string" },
        taskId: { type: "number" },
        status: { type: "string", enum: ["pending", "in_progress", "completed"] },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        notes: { type: "string" },
      },
      required: ["operation"],
    },
  },
  {
    name: "manage_agent_memory",
    description: "Store and recall persistent long-term semantic & episodic agent memories",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["remember", "recall", "list", "forget"] },
        key: { type: "string" },
        fact: { type: "string" },
        query: { type: "string" },
      },
      required: ["operation"],
    },
  },
];

/**
 * One message shape for every MCP URL refusal, so the panel, the probe and the
 * registry all explain the same policy instead of three near-miss variants.
 */
function mcpPolicyHint(err: unknown): string {
  const message = err instanceof Error ? err.message : "invalid MCP server URL";
  return `${message} Public MCP hosts must be listed in ALLOWED_MCP_HOSTS; loopback and private addresses are only reachable in a development run.`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Execute one built-in sovereign tool. Both tools run inside the same isolated
 * V8 sandbox the agent's native tool uses, so a caller cannot reach the host.
 */
async function callBuiltInMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantKey = "admin:0"
): Promise<{ text: string; isError: boolean }> {
  const { executeInSandbox } = await import("../../agent/sandbox/runner.js");

  if (name === "execute_sandboxed_code") {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) {
      return { text: "Refused: 'code' is required.", isError: true };
    }
    const rawTimeout = Number(args.timeoutMs);
    const safeTimeout = Number.isFinite(rawTimeout)
      ? Math.min(Math.max(500, Math.floor(rawTimeout)), 10_000)
      : 5000;
    const res = await executeInSandbox(code, { timeoutMs: safeTimeout });
    if (!res.success) {
      return { text: `Execution failed in ${res.executionTimeMs}ms: ${res.error}`, isError: true };
    }
    const output = [
      `Executed in ${res.executionTimeMs}ms.`,
      res.result !== null ? `Return value: ${safeStringify(res.result)}` : "",
      res.logs.length > 0 ? `Console output:\n${res.logs.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { text: output || "Executed successfully with no output.", isError: false };
  }

  if (name === "calculate_math_expression") {
    const expression = typeof args.expression === "string" ? args.expression : "";
    // Only arithmetic reaches the sandbox: no identifiers, calls, or member
    // access, so this stays a calculator rather than an eval channel.
    const compact = expression.replace(/\s+/g, "");
    if (!compact || !/^[0-9+\-*/().,%eE]+$/.test(compact)) {
      return {
        text: "Refused: the expression may only contain digits and the operators + - * / ( ) . % and e.",
        isError: true,
      };
    }
    const res = await executeInSandbox(`return (${compact});`);
    const value = res.success ? res.result : undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        text: `Could not evaluate that expression${res.error ? `: ${res.error}` : "."}`,
        isError: true,
      };
    }
    return { text: String(value), isError: false };
  }

  if (name === "manage_workspace_files") {
    const text = await executeManageWorkspaceFiles(args as any, tenantKey);
    return { text, isError: text.startsWith("Error:") };
  }

  if (name === "manage_agent_tasks") {
    const text = await executeManageAgentTasks(args as any, tenantKey);
    return { text, isError: text.startsWith("Error:") };
  }

  if (name === "manage_agent_memory") {
    const text = await executeManageAgentMemory(args as any, tenantKey);
    return { text, isError: text.startsWith("Error:") };
  }

  return { text: `Unknown tool: ${name || "(missing name)"}`, isError: true };
}

/**
 * MCP credentials are only useful if the run-time registry is allowed to call
 * them, and the registry refuses any endpoint that fails the shared outbound
 * URL policy. Reject it at connect time so the panel can never show a green
 * "connected" row for a server the agent could never reach.
 */
function mcpCredentialRejection(platform: string, values: Record<string, unknown>): string | null {
  if (platform !== "mcp" && platform !== "local_bridge" && !platform.startsWith("mcp:") && !platform.startsWith("local_bridge:")) {
    return null;
  }

  const candidate = [values.serverUrl, values.bridgeUrl].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (!candidate) return null; // A missing URL is reported by the required-field check.
  if (isBuiltInMcpEndpoint(candidate)) return null;

  try {
    assertAllowedMcpUrl(candidate);
    return null;
  } catch (err) {
    return `That MCP endpoint cannot be used: ${mcpPolicyHint(err)}`;
  }
}

export interface WorkspaceRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * User Workspace Routes: Chat Conversation Persistence, Agentic Workspace Hub
 * (Tasks, Files, Long-Term Memory), & Personal API Keys.
 */
export async function workspaceRoutes(app: FastifyInstance, options: WorkspaceRouteOptions): Promise<void> {
  const { requireAuth } = options;

  // 1. Get Chat History for Authenticated User
  app.get("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const messages = await getChatHistory(userId, 100);
    return { success: true, messages };
  });

  // 2. Save Chat Message
  app.post<{ Body: { role: "user" | "assistant"; message: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id || 0;
      const { role, message } = req.body || {};

      if (!message || (role !== "user" && role !== "assistant")) {
        reply.status(400);
        return { error: "Valid role ('user' or 'assistant') and message required." };
      }

      await saveChatMessage(userId, role, message);
      return { success: true };
    }
  );

  // 3. Clear Chat History
  app.delete("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    await clearChatHistory(userId);
    return { success: true, message: "Chat history cleared." };
  });

  // 3b. Agentic Workspace Hub Snapshot (Tasks, Files, Memories, Schedules) with DB hydration & ETag
  app.get("/api/workspace/agentic-state", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    await hydrateTenantAgenticState(tenantKey);
    const snapshot = getTenantAgenticSnapshot(tenantKey);
    const rawJson = JSON.stringify(snapshot);
    let h = 2166136261;
    for (let i = 0; i < rawJson.length; i++) {
      h ^= rawJson.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const etag = `W/"ag-${h.toString(16)}-${rawJson.length}"`;
    reply.header("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      reply.status(304);
      return "";
    }
    return {
      success: true,
      ...snapshot,
    };
  });

  // 3b-sync. Non-Destructive Sync Endpoint (Merges client local state + DB state + memory state)
  app.post("/api/workspace/agentic-state/sync", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = (req.body || {}) as any;
    const merged = await syncTenantAgenticState(tenantKey, {
      files: Array.isArray(body.files) ? body.files : undefined,
      tasks: Array.isArray(body.tasks) ? body.tasks : undefined,
      memories: Array.isArray(body.memories) ? body.memories : undefined,
      schedules: Array.isArray(body.schedules) ? body.schedules : undefined,
    });
    return {
      success: true,
      ...merged,
    };
  });

  // 3c. Interactive Task Planner Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "create_plan" | "add_task" | "update_task" | "list_tasks" | "clear_completed";
      tasks?: string[];
      title?: string;
      taskId?: number;
      status?: "pending" | "in_progress" | "completed";
      priority?: "low" | "medium" | "high";
      notes?: string;
    };
  }>("/api/workspace/agent-tasks", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = req.body || {};
    const op = body.operation || "list_tasks";
    const message = await executeManageAgentTasks(
      {
        operation: op,
        tasks: body.tasks,
        title: body.title,
        taskId: body.taskId,
        status: body.status,
        priority: body.priority,
        notes: body.notes,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return {
      success: true,
      message,
      ...getTenantAgenticSnapshot(tenantKey),
    };
  });

  // 3d. Interactive Workspace File System Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "write" | "append" | "read" | "list" | "delete" | "search";
      filename?: string;
      content?: string;
      query?: string;
    };
  }>("/api/workspace/files", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = req.body || {};
    const op = body.operation || "list";
    const message = await executeManageWorkspaceFiles(
      {
        operation: op,
        filename: body.filename,
        content: body.content,
        query: body.query,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return {
      success: true,
      message,
      ...getTenantAgenticSnapshot(tenantKey),
    };
  });

  // 3e. Interactive Long-Term Memory Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "remember" | "recall" | "list" | "forget";
      key?: string;
      fact?: string;
      query?: string;
      tags?: string[];
    };
  }>("/api/workspace/memories", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = req.body || {};
    const op = body.operation || "list";
    const message = await executeManageAgentMemory(
      {
        operation: op,
        key: body.key,
        fact: body.fact,
        query: body.query,
        tags: body.tags,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return {
      success: true,
      message,
      ...getTenantAgenticSnapshot(tenantKey),
    };
  });

  // 3f. Interactive Code Sandbox Runner & AI Task-to-Code Generator from Workspace UI (Zero Signup Barrier)
  app.post<{ Body: { code?: string; taskPrompt?: string; timeoutMs?: number; turnstileToken?: string; shield?: any } }>(
    "/api/workspace/execute-code",
    async (req, reply) => {
      const sessionToken = (req.cookies as any)?.shunops_user_session;
      let user: any = (req as any).user || null;
      if (!user && sessionToken) {
        try {
          user = await findUserBySessionToken(sessionToken);
        } catch {}
      }

      const clientIp = getClientIp(req);
      const isGuest = !user;

      // Pillar 2 & 3: Anti-Bot & Token Bucket Quota for Guests
      if (isGuest) {
        const body = req.body || {};
        const turnstileToken = body.turnstileToken;
        const shield = body.shield;

        if (!turnstileToken && !shield) {
          reply.status(403);
          return {
            success: false,
            error: "Bot shield validation required for guest trial. Please solve the challenge or sign up.",
          };
        }

        if (turnstileToken) {
          const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
          if (!isHuman) {
            reply.status(403);
            return {
              success: false,
              error: "Cloudflare Turnstile verification failed. Please refresh and try again.",
            };
          }
        } else if (shield) {
          const isValid = verifyShieldSolution(
            shield.salt,
            Number(shield.timestamp),
            Number(shield.targetDifficulty),
            shield.signature,
            String(shield.solution)
          );
          if (!isValid) {
            reply.status(403);
            return {
              success: false,
              error: "Browser security challenge failed. Please refresh.",
            };
          }
        }

        // Strict 3 Trial Runs per 24 hours per IP address via OCI Redis Token Bucket
        const quota = await checkDistributedSubnetQuota(`guest:trial:${clientIp}`, 3, 86400);
        if (!quota.allowed) {
          reply.status(429);
          return {
            success: false,
            trialExhausted: true,
            error: "Free guest trial limit reached (3 runs per 24 hours). Create a free account to unlock unlimited workspace runs!",
          };
        }
      }

      const tenantKey = user
        ? resolveTenantKey(user.id, user.role === "admin" ? "admin" : "user")
        : `tenant:guest:${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}`;

      if (user) {
        await hydrateTenantAgenticState(tenantKey);
      }
      const { executeInSandbox } = await import("../../agent/sandbox/runner.js");
      const { getTenantFilesMap, persistSandboxWrittenFiles } = await import("../../tools/agentic.js");
      const { AGENT_MODELS_CHAIN, callChatCompletionWithFailover } = await import("../../agent/models.js");
      type ModelTarget = (typeof AGENT_MODELS_CHAIN)[number];
      const { extractRunnableJsFromText } = await import("../../agent/swarm.js");

      let code = String(req.body?.code || "").trim();
      const taskPrompt = String(req.body?.taskPrompt || "").trim();
      let generatedByAi = false;

      const workspaceFiles = getTenantFilesMap(tenantKey);
      const existingFileNames = Object.keys(workspaceFiles);

      // If the user provided a natural-language taskPrompt, dynamically generate runnable JS code for it!
      if (taskPrompt) {
        generatedByAi = true;
        const userGroqKey = (req.headers["x-groq-key"] as string | undefined)?.trim();
        const userGeminiKey = (req.headers["x-gemini-key"] as string | undefined)?.trim();
        const scope = user ? await buildRequestScope(user) : { credentials: {} };
        const creds = (scope.credentials || {}) as any;
        const keyOverrides = {
          ...(userGroqKey ? { groqApiKey: userGroqKey } : {}),
          ...(userGeminiKey ? { geminiApiKey: userGeminiKey } : {}),
          ...(creds.github?.token ? { githubToken: creds.github.token } : {}),
          ...(creds.cloudflare?.accountId ? { cloudflareAccountId: creds.cloudflare.accountId } : {}),
          ...(creds.cloudflare?.apiToken ? { cloudflareApiToken: creds.cloudflare.apiToken } : {}),
        };

        const sysPrompt = [
          "You are the ShunopsAI Sandbox JavaScript Engineer.",
          "Write clean, self-contained, immediately runnable JavaScript for the isolated V8 sandbox to fulfill the user's task.",
          "Available built-in sandbox globals (no imports or require needed):",
          "- `writeWorkspaceFile(filename, content)`: Save a file (e.g. .json, .md, .csv, .txt) to the user's workspace",
          "- `appendWorkspaceFile(filename, content)`: Append to a workspace file",
          "- `readWorkspaceFile(filename)`: Read an existing workspace file",
          "- `listWorkspaceFiles()`: List workspace filenames",
          "- `sum(arr)`, `mean(arr)`, `median(arr)`, `stdDev(arr)`, `groupBy(arr, key)`, `csvParse(text)`, `formatMarkdownTable(rows)`",
          "Enclose your code in a single ```javascript code block and end with `return ...;` so the result is returned.",
        ].join("\n");

        const userMsg = [
          existingFileNames.length > 0 ? `Existing workspace files: ${existingFileNames.join(", ")}` : "",
          `Task to solve in JavaScript sandbox: ${taskPrompt}`,
        ].filter(Boolean).join("\n");

        try {
          const { response } = await callChatCompletionWithFailover(
            [
              { role: "system", content: sysPrompt },
              { role: "user", content: userMsg },
            ],
            (isGuest
              ? [
                  { provider: "gemini" as const, model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Guest Active)" },
                  { provider: "groq" as const, model: "qwen/qwen3.8-27b", name: "Groq Qwen 27B (Guest Active)" },
                ]
              : AGENT_MODELS_CHAIN),
            [],
            0.2,
            keyOverrides
          );
          const rawReply = response.choices?.[0]?.message?.content?.trim() || "";
          const extracted = extractRunnableJsFromText(rawReply);
          if (extracted) {
            code = extracted;
          } else if (rawReply && !rawReply.includes("```")) {
            code = rawReply;
          }
        } catch (err: any) {
          if (!code) {
            reply.status(500);
            return {
              success: false,
              error: `AI code generation failed: ${err?.message || "model unavailable"}. You can also type JavaScript directly in the editor.`,
            };
          }
        }
      }

      if (!code.trim()) {
        reply.status(400);
        return { success: false, error: "Provide a task description or JavaScript code to execute." };
      }

      let safeTimeoutMs = 5000;
      if (req.body?.timeoutMs !== undefined) {
        const raw = Number(req.body.timeoutMs);
        if (Number.isFinite(raw)) {
          safeTimeoutMs = Math.floor(raw);
          if (safeTimeoutMs > 10000) safeTimeoutMs = 10000;
          if (safeTimeoutMs < 500) safeTimeoutMs = 500;
        }
      }
      const res = await executeInSandbox(code, {
        timeoutMs: safeTimeoutMs,
        workspaceFiles,
      });
      const savedFiles = (res.success && !isGuest) ? await persistSandboxWrittenFiles(res.writtenFiles, tenantKey) : [];
      if (savedFiles.length > 0 && !isGuest) {
        await persistTenantAgenticState(tenantKey);
      }
      return {
        success: res.success,
        generatedByAi,
        generatedCode: code,
        result: res.result,
        error: res.error,
        logs: res.logs,
        savedFiles,
        executionTimeMs: res.executionTimeMs,
        engine: res.engine,
        isGuest,
        ...(isGuest ? {} : getTenantAgenticSnapshot(tenantKey)),
      };
    }
  );


  // 3g. Interactive Autonomous Scheduled Monitors from Workspace UI
  app.post<{
    Body: {
      operation?: "create_schedule" | "list_schedules" | "run_now" | "pause_schedule" | "resume_schedule" | "delete_schedule";
      scheduleId?: number;
      name?: string;
      actionType?: ScheduledActionType;
      intervalMinutes?: number;
      targetUrl?: string;
      query?: string;
      code?: string;
      outputFilename?: string;
    };
  }>("/api/workspace/schedules", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = req.body || {};
    const op = body.operation || "list_schedules";
    const message = await executeManageAgentSchedules(
      {
        operation: op,
        scheduleId: body.scheduleId,
        name: body.name,
        actionType: body.actionType,
        intervalMinutes: body.intervalMinutes,
        targetUrl: body.targetUrl,
        query: body.query,
        code: body.code,
        outputFilename: body.outputFilename,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return {
      success: true,
      message,
      ...getTenantAgenticSnapshot(tenantKey),
    };
  });

  // 3h. Interactive Multi-Agent Swarm Dispatcher from Workspace UI
  app.post<{
    Body: {
      objective?: string;
      mode?: SwarmExecutionMode;
      agents?: SwarmSubAgentSpec[];
      saveDeliverableAs?: string;
    };
  }>("/api/workspace/swarm", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    const body = req.body || {};
    const objective = String(body.objective || "").trim();
    const agents = Array.isArray(body.agents) ? body.agents : [];
    if (!objective || agents.length === 0) {
      reply.status(400);
      return { success: false, error: "Swarm objective and at least one sub-agent are required." };
    }
    const sanitizedAgents: SwarmSubAgentSpec[] = agents.map((a) => {
      let safeTargetUrl: string | undefined;
      if (typeof a.targetUrl === "string" && a.targetUrl.trim()) {
        try {
          const raw = a.targetUrl.trim();
          const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
          if (
            (u.protocol === "http:" || u.protocol === "https:") &&
            !isPrivateHost(u.hostname) &&
            /^[a-zA-Z0-9_.-]+$/.test(u.hostname)
          ) {
            const port = u.port ? `:${u.port}` : "";
            safeTargetUrl = `${u.protocol}//${u.hostname}${port}${u.pathname}${u.search}`;
          }
        } catch {}
      }
      return {
        ...a,
        targetUrl: safeTargetUrl,
      };
    });

    const scope = await buildRequestScope(user);
    const result = await executeAgentSwarm({
      objective,
      mode: body.mode || "hybrid_dag",
      agents: sanitizedAgents,
      saveDeliverableAs: body.saveDeliverableAs,
      scope,
    });
    return {
      success: true,
      swarm: result,
      ...getTenantAgenticSnapshot(tenantKey),
    };
  });

  app.get("/api/workspace/swarm-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
    return {
      success: true,
      history: getTenantSwarmHistory(tenantKey),
    };
  });

  // 4. List Personal API Keys
  app.get("/api/user/api-keys", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const keys = await listUserApiKeys(userId);
    return { success: true, keys };
  });

  // 5. Create Personal API Key
  app.post<{ Body: { name?: string } }>(
    "/api/user/api-keys",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to generate an API key." };
      }

      const name = (req.body?.name || "Personal API Key").trim().slice(0, 64);
      const newKey = await createApiKey(userId, name);
      return {
        success: true,
        id: newKey.id,
        key: newKey.rawKey,
        keyPrefix: newKey.keyPrefix,
        message: "API key generated. Please save this secret key now, as it cannot be displayed again.",
      };
    }
  );

  // 6. Platform Connections — the user's OWN provider credentials.
  // Agent runs started by this account use these and nothing else, so a user's
  // Neon/GitHub/Redis/Cloudflare commands can only ever touch their account.
  app.get("/api/user/platform-credentials", { preHandler: [requireAuth] }, async (req) => {
    const userId = (req as any).user?.id || 0;
    return {
      success: true,
      // Lets the form warn up front instead of failing only after a submit.
      vaultReady: isVaultConfigured(),
      available: Object.values(PLATFORM_SPECS).map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        tier: spec.tier,
        fields: spec.fields.map((field) => ({
          key: field.key,
          label: field.label,
          secret: field.secret,
          placeholder: field.placeholder,
          optional: field.optional,
        })),
      })),
      connected: await listUserPlatformCredentials(userId),
    };
  });

  app.post<{ Body: { platform?: string; label?: string; values?: Record<string, unknown> } }>(
    "/api/user/platform-credentials",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to connect a platform account." };
      }

      const platform = String(req.body?.platform || "");
      const values = (req.body?.values || {}) as Record<string, unknown>;
      const rejection = mcpCredentialRejection(platform, values);
      if (rejection) {
        reply.status(400);
        return { error: rejection };
      }

      try {
        const credential = await upsertUserPlatformCredential(
          userId,
          platform,
          values,
          req.body?.label
        );
        // Only the masked summary is echoed back; the secret never leaves the vault.
        return { success: true, credential };
      } catch (err: any) {
        reply.status(400);
        return {
          error:
            err instanceof CredentialVaultError
              ? err.message
              : "Could not store that credential.",
        };
      }
    }
  );

  // 6b. Test MCP Server Connection
  app.post<{ Body: { serverUrl?: string; apiKey?: string; platform?: string } }>(
    "/api/user/platform-credentials/test-mcp",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      let serverUrl = typeof req.body?.serverUrl === "string" ? req.body.serverUrl.trim() : "";
      let apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
      const platform = typeof req.body?.platform === "string" ? req.body.platform.trim() : "";

      // If testing an already connected platform by ID
      if (!serverUrl && platform) {
        const userId = (req as any).user?.id;
        if (userId) {
          try {
            const bundle = await getUserCredentialBundle(userId);
            const found = bundle.mcpServers?.find((s) => s.id === platform) || (platform === "mcp" ? bundle.mcp : undefined);
            if (found) {
              serverUrl = found.serverUrl;
              apiKey = found.apiKey || "";
            }
          } catch {
            // ignore and proceed to validation
          }
        }
      }

      // Handle Built-in Sovereign MCP endpoint
      if (isBuiltInMcpEndpoint(serverUrl)) {
        const tools = BUILT_IN_MCP_TOOLS.map(({ name, description }) => ({ name, description }));
        return {
          success: true,
          connected: true,
          toolsCount: tools.length,
          tools,
          message: `Connection successful! ${tools.length} built-in sovereign tools active.`,
        };
      }

      if (!serverUrl) {
        reply.status(400);
        return { success: false, connected: false, error: "Server URL is required to test MCP connection." };
      }

      let matchedEndpoint: string;
      try {
        // Same validator the connect form and the run-time registry use, so
        // "test" can never pass a URL that a real run would refuse.
        matchedEndpoint = allowMcpEndpoint(serverUrl);
      } catch (err: any) {
        reply.status(400);
        return {
          success: false,
          connected: false,
          error: mcpPolicyHint(err),
        };
      }

      const testUrl = new URL(matchedEndpoint);
      const testHost = testUrl.hostname.toLowerCase();
      const matchedTestHost = KNOWN_ALLOWED_MCP_HOSTS.find((h) => h === testHost);
      if (!matchedTestHost) {
        const customHosts = (process.env.ALLOWED_MCP_HOSTS || "")
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean);
        if (!customHosts.includes(testHost)) {
          reply.status(400);
          return {
            success: false,
            connected: false,
            error: `Disallowed MCP host: ${testUrl.hostname}`,
          };
        }
      }

      const safePort = testUrl.port ? `:${testUrl.port}` : "";
      const safeProtocol = testUrl.protocol === "http:" ? "http:" : "https:";
      const safeOrigin = `${safeProtocol}//${matchedTestHost || testHost}${safePort}`;
      const safeTestEndpoint = new URL(`${testUrl.pathname}${testUrl.search}`, safeOrigin).href;

      try {
        const client = new McpHttpClient({
          id: "test-mcp",
          name: "MCP Connection Test",
          transport: "http",
          url: safeTestEndpoint,
          headers: apiKey
            ? { Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}` }
            : {},
        });

        const res = await client.listTools();
        const tools = (res?.tools || []).map((t) => ({
          name: t.name,
          description: t.description || "",
        }));

        return {
          success: true,
          connected: true,
          toolsCount: tools.length,
          tools,
          message: `Connection successful! ${tools.length} tool${tools.length === 1 ? "" : "s"} discovered.`,
        };
      } catch (err: any) {
        reply.status(400);
        return {
          success: false,
          connected: false,
          error: err.message || "Failed to reach MCP server. If this is a local bridge, verify it is running on your machine.",
        };
      }
    }
  );

  // 6c. ShunopsAI Sovereign Built-in MCP JSON-RPC Server.
  // Authenticated like every other /api route, and it answers `tools/call` for
  // the tools it lists instead of advertising tools that cannot be executed.
  app.post<{ Body: { jsonrpc?: string; id?: any; method?: string; params?: any } }>(
    "/api/mcp",
    { preHandler: [requireAuth] },
    async (req) => {
      const user = (req as any).user;
      const tenantKey = resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
      const { id, method, params } = req.body || {};
      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: id || 1,
          result: {
            tools: BUILT_IN_MCP_TOOLS.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        };
      }

      if (method === "tools/call") {
        const toolName = typeof params?.name === "string" ? params.name : "";
        const rawArgs = (
          params?.arguments && typeof params.arguments === "object" ? params.arguments : {}
        ) as Record<string, unknown>;
        const args: Record<string, unknown> = { ...rawArgs };
        if (args.timeoutMs !== undefined) {
          const raw = Number(args.timeoutMs);
          if (Number.isFinite(raw)) {
            let t = Math.floor(raw);
            if (t > 10000) t = 10000;
            if (t < 500) t = 500;
            args.timeoutMs = t;
          } else {
            args.timeoutMs = 3000;
          }
        }
        const outcome = await callBuiltInMcpTool(toolName, args, tenantKey);
        return {
          jsonrpc: "2.0",
          id: id || 1,
          result: { content: [{ type: "text", text: outcome.text }], isError: outcome.isError },
        };
      }

      return {
        jsonrpc: "2.0",
        id: id || 1,
        result: { status: "ShunopsAI Sovereign MCP Server Online" },
      };
    }
  );

  app.delete<{ Params: { platform: string } }>(
    "/api/user/platform-credentials/:platform",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to disconnect a platform account." };
      }

      const deleted = await deleteUserPlatformCredential(userId, req.params.platform);
      if (!deleted) {
        reply.status(404);
        return { error: "No credential stored for that platform." };
      }

      return { success: true, message: "Platform account disconnected." };
    }
  );

  // 7. Revoke Personal API Key
  app.delete<{ Params: { id: string } }>(
    "/api/user/api-keys/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      const keyId = Number(req.params.id);

      if (!userId || !keyId) {
        reply.status(400);
        return { error: "Valid key ID required." };
      }

      const deleted = await deleteApiKey(userId, keyId);
      if (!deleted) {
        reply.status(404);
        return { error: "Key not found." };
      }

      return { success: true, message: "API key revoked." };
    }
  );
}
