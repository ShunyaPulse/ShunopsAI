import type OpenAI from "openai";
import { AGENT_MODELS_CHAIN, type ModelTarget } from "../models.js";
import { buildSystemPrompt } from "../prompts.js";
import { registeredTools, type ToolName } from "../tools.js";
import { allowedToolsForScope, type ToolScope } from "../scope.js";
import { getTenantAgenticContextSummary, resolveTenantKey } from "../../tools/agentic.js";
import type { DynamicMcpTool } from "../mcp/registry.js";
import type { AgentOptions } from "./types.js";

/** Everything a run needs before the first model call. */
export interface PreparedRun {
  targets: ModelTarget[];
  scope: ToolScope | undefined;
  activeTenantKey: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  activeTools: OpenAI.ChatCompletionTool[];
  allowedNames: Set<string>;
  mcpToolHandlers: Map<string, DynamicMcpTool>;
}

/**
 * Resolve the ordered model targets for a run based on caller overrides.
 */
export function resolveTargets(options: AgentOptions): ModelTarget[] {
  if (options.targets && options.targets.length > 0) {
    return options.targets;
  }
  if (options.models && options.models.length > 0) {
    return options.models.map((m) => {
      const match = AGENT_MODELS_CHAIN.find((t) => t.model === m);
      if (match) return match;
      if (m.startsWith("gemini")) return { provider: "gemini", model: m, name: m };
      if (m.includes("gpt-oss") || (m.includes("qwen") && !m.endsWith(":free"))) {
        return { provider: "groq", model: m, name: m };
      }
      return { provider: "openrouter", model: m, name: m };
    });
  }
  return AGENT_MODELS_CHAIN;
}

/**
 * Describe whose accounts this run may touch and which platforms are connected.
 * These lines are untrusted tenant context: they go in the user turn, never the
 * static system prompt.
 */
function describeScope(scope: ToolScope, dynamicMcpTools: DynamicMcpTool[]): string[] {
  const lines: string[] = [];
  const connected = Object.keys(scope.credentials ?? {});
  const safeUsername = (scope.username || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  lines.push(
    `Workspace Execution Scope: running as "${safeUsername || (scope.kind === "admin" ? "admin" : `user_${scope.userId}`)}" (role: ${scope.kind}).`,
    `Connected platforms: ${connected.length > 0 ? connected.join(", ") : "none"}.`
  );
  if (scope.credentials?.neon || scope.credentials?.supabase) {
    const dbLabel =
      scope.credentials?.neon && scope.credentials?.supabase
        ? "Neon Postgres and Supabase Postgres"
        : scope.credentials?.supabase
        ? "Supabase Postgres"
        : "Neon Postgres";
    lines.push(
      `${dbLabel} is CONNECTED and active via \`execute_neon_sql\`. When the user asks about their database, projects, tables, schemas, or registered users: you HAVE direct visibility through \`execute_neon_sql\`! Proactively run queries (such as querying tables like \`users\` / \`pg_user\`, checking schemas, or \`SELECT current_database(), current_user, version();\`) to inspect and return answers directly. Never tell the user that ${dbLabel} is not connected when it is listed as connected here, and never ask them to reconnect it.`
    );
  }
  if (scope.credentials?.redis || scope.credentials?.upstash) {
    const redisLabel = scope.credentials?.upstash ? "Upstash Serverless Redis" : "Redis";
    lines.push(`${redisLabel} is CONNECTED and accessible via \`execute_redis_command\`.`);
  }
  if (scope.credentials?.github) {
    lines.push(
      "GitHub is CONNECTED and active via `manage_github` using the user's personal access token. When the user asks about GitHub, repositories, branches, issues, or PRs: you HAVE direct visibility through `manage_github`! You can call `manage_github` with operation: 'list_repos' to see all repositories in the user's account. When the user provides a repo name (e.g. 'shunopsAI'), the system automatically resolves it under their authenticated username. Proactively call `manage_github` (with operations like list_repos, list_branches, list_issues, list_prs) to inspect and report details. Never claim that GitHub is not connected or that a repo was not found without checking 'list_repos' first."
    );
  }
  if (scope.credentials?.cloudflare) {
    lines.push("Cloudflare is CONNECTED and accessible via `run_cloudflare_ai`.");
  }
  if (scope.credentials?.brave || scope.credentials?.tavily) {
    const searchProvider = scope.credentials?.tavily ? "Tavily AI Search" : "Brave Web Search";
    lines.push(
      `${searchProvider} is CONNECTED and active via \`web_search\`. Proactively use \`web_search\` for live web research or documentation queries.`
    );
  }
  if (scope.credentials?.gcp) {
    lines.push(
      "Google Cloud Platform (GCP) is CONNECTED and active via `inspect_gcp_cloud` (supports listing Cloud Run services, querying BigQuery SQL, and reading Cloud Logging entries)."
    );
  }
  if (dynamicMcpTools.length > 0) {
    lines.push(
      `Active MCP Tools (${dynamicMcpTools.length}): ${dynamicMcpTools.map((t) => t.name).join(", ")}.`
    );
  }
  if (scope.kind === "user") {
    lines.push(
      "Only connected platforms and safe diagnostic tools are available; host-level infrastructure is restricted.",
      "If a tool refuses because an account is not connected, tell the user to connect it under Account Settings → Platform Connections."
    );
  }
  return lines;
}

/**
 * Build the single user turn that carries all dynamic context.
 *
 * Security Invariant (CodeQL Alert 174 & 175): the system prompt stays strictly
 * static and trusted (`buildSystemPrompt()`). Tenant scope, workspace state,
 * task checklist, memories, and user context are supplied here instead.
 */
function buildUserTurn(
  userGoal: string,
  options: AgentOptions,
  scope: ToolScope | undefined,
  tenantSummary: string,
  scopeLines: string[]
): string {
  const blocks: string[] = [];
  if (scope && scopeLines.length > 0) {
    blocks.push(`[Workspace Environment & Connected Scope]:\n${scopeLines.join("\n")}`);
  }
  if (tenantSummary) {
    blocks.push(`[Active Workspace State & Memories]:\n${tenantSummary}`);
  }
  if (options.initialContext && typeof options.initialContext === "string") {
    blocks.push(`[Context Reference Material]:\n${options.initialContext.slice(0, 4000)}`);
  }
  const now = new Date();
  blocks.push(
    `[System Date & Temporal Grounding]: Current system date is ${now.toUTCString()} (UTC date: ${now.toISOString().slice(0, 10)}). Ground all time-relative queries ("today", "latest", "breaking news", "current year") against this reference.`
  );
  blocks.push(`[User Goal]:\n${userGoal}`);
  return blocks.join("\n\n");
}

/**
 * Resolve the run's scope, tools, MCP servers and the initial message list.
 */
export async function prepareRun(
  userGoal: string,
  options: AgentOptions
): Promise<PreparedRun> {
  const targets = resolveTargets(options);

  // Least-privilege: restrict the toolset exposed to the model for this run.
  const scope: ToolScope | undefined = options.scope
    ? {
        ...options.scope,
        ...(options.keyOverrides ? { keyOverrides: options.keyOverrides } : {}),
      }
    : undefined;
  const scopeAllowed = allowedToolsForScope(scope);
  const disabled = new Set<ToolName>(options.disabledTools ?? []);
  const baseActiveTools = registeredTools.filter(
    (t) =>
      t.type === "function" &&
      scopeAllowed.has(t.function.name as ToolName) &&
      !disabled.has(t.function.name as ToolName)
  );

  // Discover dynamic MCP tools from active servers (Zero-cost, lightweight JSON-RPC)
  const { mcpRegistry } = await import("../mcp/registry.js");
  const dynamicMcpTools = await mcpRegistry.getActiveTools(scope);
  const mcpToolHandlers = new Map(dynamicMcpTools.map((t) => [t.name, t]));

  const activeTools = [...baseActiveTools, ...dynamicMcpTools.map((t) => t.schema)];
  const allowedNames = new Set(
    activeTools.map((t) => (t.type === "function" ? t.function.name : ""))
  );

  const activeTenantKey = resolveTenantKey(scope?.userId, scope?.kind);
  const scopeLines = scope ? describeScope(scope, dynamicMcpTools) : [];
  const tenantSummary = getTenantAgenticContextSummary(activeTenantKey);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
  ];
  messages.push({
    role: "user",
    content: buildUserTurn(userGoal, options, scope, tenantSummary, scopeLines),
  });

  if (options.image) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "Attached reference image for the user goal above:" },
        { type: "image_url", image_url: { url: options.image } },
      ],
    });
  }

  return {
    targets,
    scope,
    activeTenantKey,
    messages,
    activeTools,
    allowedNames,
    mcpToolHandlers,
  };
}
