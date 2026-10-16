import OpenAI from "openai";
import { colors } from "../core/colors.js";
import { AGENT_MODELS_CHAIN, callChatCompletionWithFailover, type ModelTarget, type ProviderKeyOverrides } from "./models.js";
import { buildSystemPrompt } from "./prompts.js";
import { sensitivityPayload } from "./sandbox.js";
import { toolRegistry, registeredTools, type ToolDefinition, type ToolName } from "./tools.js";
import { allowedToolsForScope, type ToolScope } from "./scope.js";
import { requestHumanApproval, isActionSensitive } from "../tools/safety.js";
import { withSpan } from "../telemetry/otel.js";
import {
  getTenantAgenticContextSummary,
  autoSyncTasksOnRunCompletion,
  resolveTenantKey,
} from "../tools/agentic.js";

// ==========================================
// Autonomous Agent Runner Loop (Stage 8 SOTA + Strengthened Step 2 Engine)
// - OpenTelemetry W3C TraceContext spans (`agent.run`, `tool.execute`)
// - Real-Time Progress Event Hooks (`onProgress`) for SSE streaming
// - 4-Format Universal Tool Call Parser (`<tool_call>`, `<function=...>`, ReAct `Action:`, Fenced JSON)
// - Multi-Intent Action & Deliverable Verification Guardrail + Auto-Task Completion Sync
// ==========================================

export type AgentProgressEvent =
  | { type: "step_start"; step: number; maxSteps: number; primaryModel: string }
  | { type: "reasoning"; step: number; model: string; text: string }
  | { type: "tool_call"; step: number; name: string; args: Record<string, any> }
  | { type: "tool_result"; step: number; name: string; preview: string; isError: boolean }
  | { type: "final_answer"; step: number; model: string; text: string };

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  initialContext?: string | undefined;
  models?: string[];
  targets?: ModelTarget[];
  /** Tools that must never be exposed or executed for this run (least-privilege). */
  disabledTools?: ToolName[];
  /** Optional request-scoped BYOK provider key overrides. */
  keyOverrides?: ProviderKeyOverrides | undefined;
  /** Optional validated base64 image data URI for multimodal vision turns. */
  image?: string | undefined;
  /**
   * Whose accounts this run may touch. Defaults to the operator scope, which is
   * what internal CLI/cron/admin callers have always used.
   */
  scope?: ToolScope | undefined;
  /**
   * Optional real-time progress callback for Server-Sent Events (SSE) streaming.
   */
  onProgress?: ((event: AgentProgressEvent) => void) | undefined;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentStepLogEntry {
  step: number;
  tool: string;
  argsPreview: string;
  resultPreview: string;
  durationMs: number;
  isError: boolean;
}

export interface AgentRunResult {
  success: boolean;
  finalAnswer?: string;
  stepsTaken: number;
  stepsLog?: AgentStepLogEntry[];
  history: OpenAI.ChatCompletionMessageParam[];
  usage?: AgentTokenUsage;
  usedModel?: string;
}

/**
 * Strip raw XML/ReAct tool-call tags (`<tool_call>...</tool_call>`, `<function=...>...</function>`)
 * from assistant text so internal tool markup never leaks into UI chat bubbles.
 */
export function stripEmbeddedToolCallMarkup(content: string | null | undefined): string {
  if (!content || typeof content !== "string") return "";
  return content
    .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/gi, "")
    .replace(/<function=[a-zA-Z0-9_:-]+>\s*[\s\S]*?\s*<\/function>/gi, "")
    .replace(/<function=[a-zA-Z0-9_:-]+\(\s*\{[\s\S]*?\}\s*\)\s*\/?>/gi, "")
    .trim();
}

/**
 * Extract tool invocations across all 4 common LLM text-based tool-call formats:
 * 1. `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` (Hermes / Qwen / Universal)
 * 2. `<function=tool_name>{"arg": ...}</function>` or `<function=tool_name({...})>` (Llama 3.1/3.3 on Groq & Cloudflare)
 * 3. `Action: tool_name\nAction Input: {...}` (Classic ReAct format)
 * 4. Fenced ```tool_call / ```json blocks with `{"name": "...", "arguments": {...}}`
 */
export function extractEmbeddedToolCalls(
  content: string | null | undefined,
  allowedNames: Set<string>,
  step: number
): OpenAI.ChatCompletionMessageToolCall[] {
  if (!content || typeof content !== "string") return [];
  const extracted: OpenAI.ChatCompletionMessageToolCall[] = [];

  // 1. Check `<tool_call>...</tool_call>` tags
  const xmlMatches = Array.from(content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi));
  for (let i = 0; i < xmlMatches.length; i++) {
    const rawJson = (xmlMatches[i]?.[1] || "").trim();
    try {
      const parsed = JSON.parse(rawJson);
      const toolName = String(parsed?.name || parsed?.tool || "").trim();
      const argsObj = parsed?.arguments ?? parsed?.args ?? parsed?.parameters ?? {};
      if (toolName && allowedNames.has(toolName)) {
        extracted.push({
          id: `call_xml_${step}_${i}`,
          type: "function",
          function: {
            name: toolName,
            arguments: typeof argsObj === "string" ? argsObj : JSON.stringify(argsObj),
          },
        });
      }
    } catch {}
  }
  if (extracted.length > 0) return extracted;

  // 2. Check Llama-style `<function=tool_name>{...}</function>` or `<function=tool_name({...})>`
  const llamaMatches = Array.from(
    content.matchAll(
      /<function=([a-zA-Z0-9_:-]+)(?:>\s*(\{[\s\S]*?\})\s*<\/function>|\(\s*(\{[\s\S]*?\})\s*\)\s*\/?>)/gi
    )
  );
  for (let i = 0; i < llamaMatches.length; i++) {
    const toolName = (llamaMatches[i]?.[1] || "").trim();
    const rawArgs = (llamaMatches[i]?.[2] || llamaMatches[i]?.[3] || "{}").trim();
    if (toolName && allowedNames.has(toolName)) {
      try {
        const parsedArgs = JSON.parse(rawArgs);
        extracted.push({
          id: `call_llama_${step}_${i}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(parsedArgs),
          },
        });
      } catch {}
    }
  }
  if (extracted.length > 0) return extracted;

  // 3. Check Classic ReAct `Action: <tool_name>` + `Action Input: {...}`
  const reactMatches = Array.from(
    content.matchAll(/Action\s*:\s*`?([a-zA-Z0-9_:-]+)`?\s*[\r\n]+Action\s+Input\s*:\s*(\{[\s\S]*?\})(?=\r?\n(?:Thought|Action|Observation|$)|$)/gi)
  );
  for (let i = 0; i < reactMatches.length; i++) {
    const toolName = (reactMatches[i]?.[1] || "").trim();
    const rawArgs = (reactMatches[i]?.[2] || "{}").trim();
    if (toolName && allowedNames.has(toolName)) {
      try {
        const parsedArgs = JSON.parse(rawArgs);
        extracted.push({
          id: `call_react_${step}_${i}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(parsedArgs),
          },
        });
      } catch {}
    }
  }
  if (extracted.length > 0) return extracted;

  // 4. Check fenced ```json or ```tool_call blocks that represent a tool invocation
  const fenceMatches = Array.from(
    content.matchAll(/```(?:tool_call|json)?\s*(\{[\s\S]*?\})\s*```/gi)
  );
  for (let i = 0; i < fenceMatches.length; i++) {
    const rawJson = (fenceMatches[i]?.[1] || "").trim();
    try {
      const parsed = JSON.parse(rawJson);
      const toolName = String(parsed?.name || parsed?.tool || "").trim();
      const argsObj = parsed?.arguments ?? parsed?.args ?? parsed?.parameters;
      if (toolName && allowedNames.has(toolName) && argsObj !== undefined) {
        extracted.push({
          id: `call_fence_${step}_${i}`,
          type: "function",
          function: {
            name: toolName,
            arguments: typeof argsObj === "string" ? argsObj : JSON.stringify(argsObj),
          },
        });
      }
    } catch {}
  }

  return extracted;
}

/**
 * Resolve the ordered model targets for a run based on caller overrides.
 */

const ALWAYS_ON_CORE_TOOLS = new Set<string>([
  "web_search",
  "inspect_website",
  "execute_sandboxed_code",
  "manage_workspace_files",
  "manage_agent_tasks",
  "manage_agent_memory",
  "run_agentic_pipeline",
  "search_knowledge_base",
  "ask_user_confirmation",
]);

/**
 * Zero-Loss Energy Efficiency: Intent-Scoped Dynamic Tool Schema Pruning.
 * Sends the 9 universal agentic tools + any domain-matched specialist tools on Step 1
 * (saving ~60-70% of GPU input schema tokens), while keeping 100% of scope-permitted
 * tools unlocked in `allowedNames` for execution.
 */
export function selectEnergyEfficientToolsForGoal(
  userGoal: string,
  allActiveTools: OpenAI.ChatCompletionTool[],
  step = 1
): OpenAI.ChatCompletionTool[] {
  if (step > 1 || allActiveTools.length <= 10) {
    return allActiveTools;
  }
  const g = String(userGoal || "").toLowerCase();
  const matchedSpecialists = new Set<string>();

  if (/\b(?:swarm|sub-?agent|multi-?agent|blackboard|consensus|debate|audit|auditor)\b/.test(g)) {
    matchedSpecialists.add("delegate_to_agent_swarm");
    matchedSpecialists.add("dual_model_consensus");
  }
  if (/\b(?:schedule|watchdog|monitor|recurring|every\s+\d+|cron|digest|interval|pause|resume)\b/.test(g)) {
    matchedSpecialists.add("manage_agent_schedules");
  }
  if (/\b(?:sql|postgres|neon|supabase|table|schema|query|database|db|row|rows|select|insert|users)\b/.test(g)) {
    matchedSpecialists.add("execute_neon_sql");
  }
  if (/\b(?:redis|upstash|cache|ttl|hget|incr)\b/.test(g)) {
    matchedSpecialists.add("execute_redis_command");
  }
  if (/\b(?:github|repo|repository|branch|commit|issue|pr|pull\s*request|codeql|alert|scan)\b/.test(g)) {
    matchedSpecialists.add("manage_github");
    matchedSpecialists.add("resolve_code_scanning_alerts");
  }
  if (/\b(?:gcp|google\s*cloud|bigquery|cloud\s*run|compute|vm|cloudflare|worker|sentinel|heal|shell|bash|directory|video|kaggle|youtube|index)\b/.test(g)) {
    return allActiveTools;
  }

  return allActiveTools.filter((t) => {
    if (t.type !== "function") return true;
    const name = t.function.name;
    return (
      ALWAYS_ON_CORE_TOOLS.has(name) ||
      matchedSpecialists.has(name) ||
      name.startsWith("mcp_")
    );
  });
}

function resolveTargets(options: AgentOptions): ModelTarget[] {
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

export async function runAutonomousAgent(
  userGoal: string,
  options: AgentOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 15;
  const temperature = options.temperature ?? 0.2;

  return withSpan(
    "agent.run",
    {
      kind: "INTERNAL",
      attributes: {
        "agent.goal": userGoal.slice(0, 160),
        "agent.max_steps": maxSteps,
        "agent.scope": options.scope?.kind || "admin",
        "agent.multimodal": Boolean(options.image),
      },
    },
    async (runSpan) => {
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
      const { mcpRegistry } = await import("./mcp/registry.js");
      const dynamicMcpTools = await mcpRegistry.getActiveTools(scope);
      const mcpToolHandlers = new Map(dynamicMcpTools.map((t) => [t.name, t]));

      const activeTools = [...baseActiveTools, ...dynamicMcpTools.map((t) => t.schema)];
      const allowedNames = new Set(
        activeTools.map((t) => (t.type === "function" ? t.function.name : ""))
      );

      const activeTenantKey = resolveTenantKey(scope?.userId, scope?.kind);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: buildSystemPrompt() },
      ];

      const lines: string[] = [];
      if (scope) {
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
      }

      // Security Invariant (CodeQL Alert 174 & 175): System prompt must remain strictly static
      // and trusted (buildSystemPrompt()). Dynamic tenant scope, workspace state, task checklist,
      // memories, and user context must NEVER be injected into { role: "system" }; supply them
      // exclusively in the user turn as structured reference context.
      const tenantSummary = getTenantAgenticContextSummary(activeTenantKey);
      const userTurnBlocks: string[] = [];

      if (scope && lines.length > 0) {
        userTurnBlocks.push(`[Workspace Environment & Connected Scope]:\n${lines.join("\n")}`);
      }
      if (tenantSummary) {
        userTurnBlocks.push(`[Active Workspace State & Memories]:\n${tenantSummary}`);
      }
      if (options.initialContext && typeof options.initialContext === "string") {
        userTurnBlocks.push(`[Context Reference Material]:\n${options.initialContext.slice(0, 4000)}`);
      }
      userTurnBlocks.push(`[User Goal]:\n${userGoal}`);

      const effectiveUserGoal = userTurnBlocks.join("\n\n");

      if (options.image) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: effectiveUserGoal },
            { type: "image_url", image_url: { url: options.image } },
          ],
        });
      } else {
        messages.push({ role: "user", content: effectiveUserGoal });
      }

      console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
      console.log(`${colors.green}${colors.bold}🎯 Autonomous Agent Initiated${colors.reset}`);
      console.log(`${colors.green}Goal:${colors.reset} ${userGoal}`);
      console.log(`${colors.green}Max Steps:${colors.reset} ${maxSteps}`);
      console.log(
        `${colors.green}Primary Model:${colors.reset} [${targets[0]?.provider.toUpperCase() ?? "UNKNOWN"}] ${targets[0]?.model ?? "unknown"}`
      );
      console.log(`${colors.green}${colors.bold}========================================${colors.reset}\n`);

      let stepsTaken = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let lastUsedModel = targets[0]?.model || "unknown";

      // Stage 8 & Step 2 Self-Reflection Guardrail & Action Verification Counters
      const priorToolCallSignatures = new Map<string, number>();
      const stepsLog: AgentStepLogEntry[] = [];
      let workspaceFilesSavedCount = 0;
      let memoriesSavedCount = 0;
      let tasksPlannedCount = 0;
      let schedulesCreatedCount = 0;
      let swarmsDispatchedCount = 0;
      let deliverableVerificationTriggered = false;

      for (let step = 1; step <= maxSteps; step++) {
        stepsTaken = step;
        console.log(
          `\n${colors.cyan}${colors.bold}--- [Step ${step}/${maxSteps}] ---${colors.reset}`
        );

        try {
          options.onProgress?.({
            type: "step_start",
            step,
            maxSteps,
            primaryModel: lastUsedModel,
          });
        } catch {}

        try {
          const stepTools = selectEnergyEfficientToolsForGoal(userGoal, activeTools, step);
          const { response, usedModel } = await callChatCompletionWithFailover(
            messages,
            targets,
            stepTools,
            temperature,
            options.keyOverrides
          );
          lastUsedModel = usedModel;

          // Accumulate industry-grade token metrics
          if (response.usage) {
            totalPromptTokens += response.usage.prompt_tokens || 0;
            totalCompletionTokens += response.usage.completion_tokens || 0;
          } else {
            const inChars = messages.reduce(
              (acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0),
              0
            );
            const outChars = response.choices?.[0]?.message?.content?.length || 0;
            totalPromptTokens += Math.ceil(inChars / 4);
            totalCompletionTokens += Math.ceil(outChars / 4);
          }

          const choice = response.choices?.[0];
          if (!choice || !choice.message) {
            throw new Error("Received an invalid response choice from OpenRouter API.");
          }

          const assistantMessage = choice.message;

          // Check native tool_calls first; if empty, check 4-Format Universal Tool Call Parser
          let toolCalls = assistantMessage.tool_calls;
          if (!toolCalls || toolCalls.length === 0) {
            const embeddedCalls = extractEmbeddedToolCalls(
              assistantMessage.content,
              allowedNames,
              step
            );
            if (embeddedCalls.length > 0) {
              toolCalls = embeddedCalls;
              assistantMessage.tool_calls = embeddedCalls;
              assistantMessage.content = stripEmbeddedToolCallMarkup(assistantMessage.content);
            }
          }

          messages.push(assistantMessage);

          // Log reasoning / thoughts if returned
          if (assistantMessage.content) {
            console.log(
              `\n${colors.magenta}${colors.bold}[Agent Reasoning (${usedModel})]${colors.reset}`
            );
            console.log(`${assistantMessage.content}`);
          }

          // Step 2 Multi-Intent Action & Deliverable Verification Guardrail:
          // Verify that explicit user requests to save a file, remember a fact, or create a task plan
          // were actually executed via tools before allowing the agent to conclude.
          if (!toolCalls || toolCalls.length === 0) {
            if (!deliverableVerificationTriggered && step < maxSteps) {
              const missingPrompts: string[] = [];

              const fileGoalMatch = userGoal.match(
                /\b(?:save|write|create|draft|store|export)\b[\s\S]{0,80}?\b([a-zA-Z0-9_\-./]+\.(?:md|json|csv|js|ts|txt|html|sql|py|yaml|yml))\b/i
              );
              if (
                fileGoalMatch &&
                workspaceFilesSavedCount === 0 &&
                allowedNames.has("manage_workspace_files")
              ) {
                missingPrompts.push(
                  `Save the requested file "${fileGoalMatch[1]}" using manage_workspace_files (operation: "write", filename: "${fileGoalMatch[1]}", content: "...").`
                );
              }

              const memoryGoalMatch =
                /\b(?:remember\s+that|save\s+(?:this\s+)?to\s+(?:your\s+|agent\s+)?memory|store\s+in\s+(?:long-term\s+)?memory)\b/i.test(
                  userGoal
                );
              if (
                memoryGoalMatch &&
                memoriesSavedCount === 0 &&
                allowedNames.has("manage_agent_memory")
              ) {
                missingPrompts.push(
                  `Save the user's fact/preference using manage_agent_memory (operation: "remember", key: "...", fact: "...").`
                );
              }

              const planGoalMatch =
                /\b(?:create\s+a\s+(?:\d+-step\s+)?(?:task\s+|action\s+|launch\s+|rollout\s+)?plan|add\s+to\s+(?:my\s+)?checklist)\b/i.test(
                  userGoal
                );
              if (
                planGoalMatch &&
                tasksPlannedCount === 0 &&
                allowedNames.has("manage_agent_tasks")
              ) {
                missingPrompts.push(
                  `Create the requested task plan using manage_agent_tasks (operation: "create_plan", tasks: [...]).`
                );
              }

              const scheduleGoalMatch =
                /\b(?:create\s+a\s+scheduled|schedule\s+a\s+(?:website\s+)?monitor|monitor\s+https?:\/\/\S+\s+every\s+\d+)\b/i.test(
                  userGoal
                );
              if (
                scheduleGoalMatch &&
                schedulesCreatedCount === 0 &&
                allowedNames.has("manage_agent_schedules")
              ) {
                missingPrompts.push(
                  `Create the requested recurring monitor using manage_agent_schedules (operation: "create_schedule", ...).`
                );
              }

              const swarmGoalMatch =
                /\b(?:delegate\s+to\s+(?:an?\s+)?(?:agent\s+)?swarm|run\s+a\s+multi-agent\s+swarm|spawn\s+an?\s+agent\s+swarm)\b/i.test(
                  userGoal
                );
              if (
                swarmGoalMatch &&
                swarmsDispatchedCount === 0 &&
                allowedNames.has("delegate_to_agent_swarm")
              ) {
                missingPrompts.push(
                  `Dispatch the requested Multi-Agent Swarm using delegate_to_agent_swarm (objective: "...", agents: [...]).`
                );
              }

              if (missingPrompts.length > 0) {
                deliverableVerificationTriggered = true;
                console.log(
                  `${colors.yellow}[Action Verification Guardrail]${colors.reset} Prompting agent to complete ${missingPrompts.length} unfulfilled action(s).`
                );
                messages.push({
                  role: "user",
                  content: `[Autonomous Action Verification Guardrail]: Before concluding your final response, you must execute the following requested tool action(s):\n- ${missingPrompts.join("\n- ")}`,
                });
                continue;
              }
            }

            // Synchronize active checklist tasks when multi-tool execution finishes
            if (stepsLog.length > 0) {
              autoSyncTasksOnRunCompletion(
                activeTenantKey,
                stepsLog.map((s) => s.tool),
                userGoal
              );
            }

            const finalText = stripEmbeddedToolCallMarkup(choice.message.content || "");
            console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
            console.log(`${colors.green}${colors.bold}✅ Task Finished Successfully${colors.reset}`);
            console.log(`${colors.green}${colors.bold}========================================${colors.reset}`);
            console.log(`\n${finalText || "(No text response provided)"}\n`);

            runSpan.setAttribute("agent.steps_taken", stepsTaken);
            runSpan.setAttribute("agent.used_model", lastUsedModel);
            runSpan.setAttribute("agent.total_tokens", totalPromptTokens + totalCompletionTokens);

            try {
              options.onProgress?.({
                type: "final_answer",
                step,
                model: lastUsedModel,
                text: finalText,
              });
            } catch {}

            return {
              success: true,
              finalAnswer: finalText,
              stepsTaken,
              stepsLog,
              history: messages,
              usedModel: lastUsedModel,
              usage: {
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalPromptTokens + totalCompletionTokens,
              },
            };
          }

          if (assistantMessage.content) {
            try {
              options.onProgress?.({
                type: "reasoning",
                step,
                model: lastUsedModel,
                text: assistantMessage.content,
              });
            } catch {}
          }

          // Execute tool calls in parallel (Concurrent SOTA Execution)
          const toolPromises = toolCalls.map(async (toolCall) => {
            if (toolCall.type !== "function") {
              return {
                role: "tool" as const,
                tool_call_id: toolCall.id,
                content: "Error: Unsupported non-function tool call. Skipped.",
              };
            }

            const toolName = toolCall.function.name;
            let parsedArgs: Record<string, any> = {};

            try {
              parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
              console.error(
                `${colors.red}[Tool Parse Error]${colors.reset} Invalid JSON in arguments for ${toolName}: ${toolCall.function.arguments}`
              );
              parsedArgs = { raw: toolCall.function.arguments };
            }

            console.log(
              `\n${colors.yellow}${colors.bold}[Tool Dispatch]${colors.reset} ${colors.bold}${toolName}${colors.reset}(${JSON.stringify(
                parsedArgs,
                null,
                2
              )})`
            );

            try {
              options.onProgress?.({
                type: "tool_call",
                step,
                name: toolName,
                args: parsedArgs,
              });
            } catch {}

            const callSignature = `${toolName}:${JSON.stringify(parsedArgs)}`;
            const repeatCount = (priorToolCallSignatures.get(callSignature) || 0) + 1;
            priorToolCallSignatures.set(callSignature, repeatCount);

            return withSpan(
              `tool.execute ${toolName}`,
              {
                kind: "INTERNAL",
                attributes: {
                  "tool.name": toolName,
                  "tool.step": step,
                  "tool.is_mcp": mcpToolHandlers.has(toolName),
                },
              },
              async (toolSpan) => {
                const toolStartMs = Date.now();
                let executionResult: string;
                const toolHandler = (toolRegistry as Record<string, ToolDefinition | undefined>)[
                  toolName
                ];

                if (!allowedNames.has(toolName)) {
                  executionResult = `Error: Tool "${toolName}" is not permitted for this task. Allowed tools: ${[...allowedNames].join(", ")}`;
                  toolSpan.setStatus("ERROR", "Tool not permitted for scope");
                } else if (mcpToolHandlers.has(toolName)) {
                  const mcpTool = mcpToolHandlers.get(toolName)!;
                  try {
                    const payload = sensitivityPayload(toolName, parsedArgs);
                    const sensitivity = isActionSensitive(payload);
                    if (sensitivity.isSensitive) {
                      const approval = await requestHumanApproval(
                        `MCP Tool: ${toolName}`,
                        payload,
                        sensitivity.reason,
                        { userId: scope?.userId, username: scope?.username }
                      );
                      executionResult = approval.approved
                        ? await mcpTool.execute(parsedArgs)
                        : `Aborted by safety gate: ${approval.message}`;
                    } else {
                      executionResult = await mcpTool.execute(parsedArgs);
                    }
                  } catch (mcpErr: any) {
                    executionResult = `Error executing MCP tool ${toolName}: ${mcpErr?.message || String(mcpErr)}`;
                    toolSpan.setStatus("ERROR", mcpErr?.message || String(mcpErr));
                  }
                } else if (!toolHandler) {
                  executionResult = `Error: Unknown tool "${toolName}". Available tools: ${Object.keys(
                    toolRegistry
                  ).join(", ")}`;
                  toolSpan.setStatus("ERROR", "Unknown tool");
                } else {
                  try {
                    const payload = sensitivityPayload(toolName, parsedArgs);
                    const sensitivity = isActionSensitive(payload);
                    if (sensitivity.isSensitive) {
                      const approval = await requestHumanApproval(
                        `Tool: ${toolName}`,
                        payload,
                        sensitivity.reason,
                        { userId: scope?.userId, username: scope?.username }
                      );
                      executionResult = approval.approved
                        ? await toolHandler
                            .execute(parsedArgs, scope)
                            .catch((e: any) => `Error executing tool ${toolName}: ${e.message}`)
                        : `Aborted by safety gate: ${approval.message}`;
                    } else {
                      executionResult = await toolHandler
                        .execute(parsedArgs, scope)
                        .catch((e: any) => `Error executing tool ${toolName}: ${e.message}`);
                    }
                  } catch (execErr: any) {
                    executionResult = `Error executing tool ${toolName}: ${execErr?.message || String(execErr)}`;
                    toolSpan.setStatus("ERROR", execErr?.message || String(execErr));
                  }
                }

                const isErrorOutput = /^Error\b|Execution Failed|Aborted by safety gate/i.test(
                  executionResult.trim()
                );

                // Track fulfilled agentic actions for Step 2 verification guardrail
                if (!isErrorOutput) {
                  if (
                    (toolName === "manage_workspace_files" &&
                      (parsedArgs.operation === "write" || parsedArgs.operation === "append")) ||
                    (toolName === "execute_sandboxed_code" &&
                      executionResult.includes("Saved Workspace Files:")) ||
                    (toolName === "run_agentic_pipeline" &&
                      (executionResult.includes("write_file") ||
                        executionResult.includes("Saved workspace files:"))) ||
                    (toolName === "delegate_to_agent_swarm" && Boolean(parsedArgs.saveDeliverableAs))
                  ) {
                    workspaceFilesSavedCount++;
                  }
                  if (
                    (toolName === "manage_agent_memory" && parsedArgs.operation === "remember") ||
                    (toolName === "run_agentic_pipeline" && executionResult.includes(": remember"))
                  ) {
                    memoriesSavedCount++;
                  }
                  if (toolName === "manage_agent_schedules" && parsedArgs.operation === "create_schedule") {
                    schedulesCreatedCount++;
                  }
                  if (toolName === "delegate_to_agent_swarm") {
                    swarmsDispatchedCount++;
                  }
                  if (
                    (toolName === "manage_agent_tasks" &&
                      (parsedArgs.operation === "create_plan" ||
                        parsedArgs.operation === "add_task")) ||
                    (toolName === "run_agentic_pipeline" && executionResult.includes(": create_plan")) ||
                    toolName === "delegate_to_agent_swarm"
                  ) {
                    tasksPlannedCount++;
                  }
                }

                if (isErrorOutput) {
                  if (toolName === "execute_sandboxed_code") {
                    executionResult += `\n\n[Autonomous Reflexion Cue]: Sandbox execution error. Built-in helpers available: readWorkspaceFile(name), writeWorkspaceFile(name, content), formatMarkdownTable(rows), csvParse(text), jsonParseSafe(text), sum(arr), mean(arr), median(arr), stdDev(arr), groupBy(arr, key). Fix the JavaScript syntax/logic and re-execute.`;
                  } else {
                    executionResult += `\n\n[Self-Reflection Guardrail]: Tool "${toolName}" returned an error. Analyze the error message above, adjust your arguments or try an alternative approach, and do NOT repeat the exact same failing call.`;
                  }
                } else if (
                  toolName === "web_search" &&
                  executionResult.includes("No live web search results found")
                ) {
                  executionResult += `\n\n[Autonomous Reflexion Cue]: Search returned 0 results. Reformulate your query: strip special characters, use broader technical synonyms, or inspect an authoritative documentation URL directly using inspect_website.`;
                } else if (repeatCount >= 2) {
                  executionResult += `\n\n[Self-Reflection Guardrail]: You have already invoked "${toolName}" with these identical arguments (${repeatCount}x). Synthesize the gathered data now and provide your final answer or proceed to the next distinct step.`;
                }

                const resultPreview =
                  executionResult.length > 500
                    ? executionResult.slice(0, 500) +
                      `\n... [${executionResult.length - 500} more chars]`
                    : executionResult;

                console.log(
                  `${colors.blue}[Tool Result] [${toolName}]${colors.reset}\n${resultPreview}`
                );

                const toolDurationMs = Math.max(1, Date.now() - toolStartMs);
                stepsLog.push({
                  step,
                  tool: toolName,
                  argsPreview: JSON.stringify(parsedArgs).slice(0, 180),
                  resultPreview: resultPreview.slice(0, 260),
                  durationMs: toolDurationMs,
                  isError: isErrorOutput,
                });

                try {
                  options.onProgress?.({
                    type: "tool_result",
                    step,
                    name: toolName,
                    preview: resultPreview.slice(0, 240),
                    isError: isErrorOutput,
                  });
                } catch {}

                return {
                  role: "tool" as const,
                  tool_call_id: toolCall.id,
                  content: executionResult,
                };
              }
            );
          });

          const toolResults = await Promise.all(toolPromises);
          for (const res of toolResults) {
            messages.push(res);
          }
        } catch (loopError: any) {
          console.error(
            `\n${colors.red}${colors.bold}[Step Error]${colors.reset} ${loopError.message}`
          );
          runSpan.setStatus("ERROR", loopError.message);
          return {
            success: false,
            finalAnswer: `Error during execution: ${loopError.message}`,
            stepsTaken,
            stepsLog,
            history: messages,
            usedModel: lastUsedModel,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
            },
          };
        }
      }

      console.warn(
        `\n${colors.yellow}${colors.bold}[Max Steps Reached]${colors.reset} Agent completed maximum allowed iterations (${maxSteps}).`
      );
      runSpan.setAttribute("agent.steps_taken", stepsTaken);
      runSpan.setAttribute("agent.max_steps_reached", true);

      return {
        success: false,
        finalAnswer: "Max steps reached without explicit task completion.",
        stepsTaken,
        stepsLog,
        history: messages,
        usedModel: lastUsedModel,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
      };
    }
  );
}
