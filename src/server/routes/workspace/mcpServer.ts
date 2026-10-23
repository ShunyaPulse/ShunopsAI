import type { FastifyInstance } from "fastify";
import {
  executeManageWorkspaceFiles,
  executeManageAgentTasks,
  executeManageAgentMemory,
} from "../../../tools/agentic.js";
import { safeStringify, tenantKeyFor, type WorkspaceRouteDeps } from "./shared.js";

/**
 * Tools the built-in sovereign `/api/mcp` server actually implements. It
 * advertises exactly what its `tools/call` branch can run: listing tools the
 * server cannot execute just makes the agent report phantom failures.
 */
export const BUILT_IN_MCP_TOOLS = [
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

const SANDBOX_MIN_TIMEOUT_MS = 500;
const SANDBOX_MAX_TIMEOUT_MS = 10_000;
const SANDBOX_DEFAULT_TIMEOUT_MS = 5000;

/** Run code in the same isolated V8 sandbox the native agent tool uses. */
async function runSandboxedCode(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const code = typeof args.code === "string" ? args.code : "";
  if (!code.trim()) {
    return { text: "Refused: 'code' is required.", isError: true };
  }
  const rawTimeout = Number(args.timeoutMs);
  const safeTimeout = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(SANDBOX_MIN_TIMEOUT_MS, Math.floor(rawTimeout)), SANDBOX_MAX_TIMEOUT_MS)
    : SANDBOX_DEFAULT_TIMEOUT_MS;

  const { executeInSandbox } = await import("../../../agent/sandbox/runner.js");
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

/** Arithmetic-only evaluator; no identifiers, calls, or member access. */
async function calculateExpression(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const expression = typeof args.expression === "string" ? args.expression : "";
  const compact = expression.replace(/\s+/g, "");
  if (!compact || !/^[0-9+\-*/().,%eE]+$/.test(compact)) {
    return {
      text: "Refused: the expression may only contain digits and the operators + - * / ( ) . % and e.",
      isError: true,
    };
  }
  const { executeInSandbox } = await import("../../../agent/sandbox/runner.js");
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

/**
 * Execute one built-in sovereign tool. All tools run inside the isolated V8
 * sandbox or the tenant-scoped workspace, so a caller cannot reach the host.
 */
export async function callBuiltInMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantKey = "admin:0"
): Promise<{ text: string; isError: boolean }> {
  if (name === "execute_sandboxed_code") return runSandboxedCode(args);
  if (name === "calculate_math_expression") return calculateExpression(args);

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

/** JSON-RPC 2.0 surface for the built-in MCP server. */
export function registerBuiltInMcpRoute(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { requireAuth } = deps;

  // 6c. ShunopsAI Sovereign Built-in MCP JSON-RPC Server.
  // Authenticated like every other /api route, and it answers `tools/call` for
  // the tools it lists instead of advertising tools that cannot be executed.
  app.post<{ Body: { jsonrpc?: string; id?: any; method?: string; params?: any } }>(
    "/api/mcp",
    { preHandler: [requireAuth] },
    async (req) => {
      const tenantKey = tenantKeyFor((req as any).user);
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
            if (t > SANDBOX_MAX_TIMEOUT_MS) t = SANDBOX_MAX_TIMEOUT_MS;
            if (t < SANDBOX_MIN_TIMEOUT_MS) t = SANDBOX_MIN_TIMEOUT_MS;
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
}
