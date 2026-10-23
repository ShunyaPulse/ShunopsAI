import type OpenAI from "openai";
import { isToolAllowedForScope, hostToolRefusal, type ToolScope } from "../scope.js";
import { hostTools } from "./hostTools.js";
import { platformTools } from "./platformTools.js";
import { mediaTools } from "./mediaTools.js";
import { opsTools } from "./opsTools.js";
import { knowledgeTools } from "./knowledgeTools.js";
import { agenticTools } from "./agenticTools.js";
import type { ToolDefinition, ToolName } from "./types.js";

const definitions: Record<ToolName, ToolDefinition> = {
  ...hostTools,
  ...platformTools,
  ...mediaTools,
  ...opsTools,
  ...knowledgeTools,
  ...agenticTools,
};

/**
 * Presentation order is part of the model contract: keep the historical order
 * rather than module order, so prompt shape stays identical to the monolith.
 */
const TOOL_ORDER: ToolName[] = [
  "run_shell_command",
  "read_file",
  "write_file",
  "list_directory",
  "execute_neon_sql",
  "execute_redis_command",
  "manage_github",
  "manage_cloud_run",
  "manage_cloudflare",
  "inspect_website",
  "manage_compute_engine",
  "produce_video",
  "manage_kaggle",
  "publish_to_youtube",
  "ask_user_confirmation",
  "sentinel_health_check",
  "auto_heal_service",
  "run_cloudflare_ai",
  "dual_model_consensus",
  "resolve_code_scanning_alerts",
  "search_knowledge_base",
  "index_knowledge_document",
  "execute_sandboxed_code",
  "web_search",
  "inspect_gcp_cloud",
  "manage_workspace_files",
  "manage_agent_tasks",
  "manage_agent_memory",
  "run_agentic_pipeline",
  "delegate_to_agent_swarm",
  "manage_agent_schedules",
];

export const toolRegistry = Object.fromEntries(
  TOOL_ORDER.map((name) => [name, definitions[name]!])
) as Record<ToolName, ToolDefinition>;

/**
 * Scope enforcement, applied once across the whole registry so an individual
 * tool cannot forget it: host-tier tools refuse to run for a user scope, and
 * every tool receives the scope of the run.
 */
for (const [name, definition] of Object.entries(toolRegistry)) {
  const executeWithScope = definition.execute;
  definition.execute = async (args: any, scope?: ToolScope) => {
    const toolName = name as ToolName;
    if (!isToolAllowedForScope(toolName, scope)) {
      return hostToolRefusal(toolName);
    }
    return executeWithScope(args, scope);
  };
}

export const registeredTools: OpenAI.ChatCompletionTool[] = Object.values(toolRegistry).map(
  (t) => t.schema
);
