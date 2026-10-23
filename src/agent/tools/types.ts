import type OpenAI from "openai";
import type { ToolScope } from "../scope.js";

export interface ToolDefinition {
  schema: OpenAI.ChatCompletionTool;
  /**
   * `scope` identifies whose accounts this run may touch. Platform tools resolve
   * credentials from it and refuse (rather than escalate to server credentials)
   * when the caller has not connected that platform.
   */
  execute: (args: any, scope?: ToolScope) => Promise<string>;
}

export type ToolName =
  | "run_shell_command"
  | "read_file"
  | "write_file"
  | "list_directory"
  | "execute_neon_sql"
  | "execute_redis_command"
  | "manage_github"
  | "manage_cloud_run"
  | "manage_cloudflare"
  | "inspect_website"
  | "manage_compute_engine"
  | "produce_video"
  | "manage_kaggle"
  | "publish_to_youtube"
  | "ask_user_confirmation"
  | "sentinel_health_check"
  | "auto_heal_service"
  | "run_cloudflare_ai"
  | "dual_model_consensus"
  | "resolve_code_scanning_alerts"
  | "search_knowledge_base"
  | "index_knowledge_document"
  | "execute_sandboxed_code"
  | "web_search"
  | "inspect_gcp_cloud"
  | "manage_workspace_files"
  | "manage_agent_tasks"
  | "manage_agent_memory"
  | "run_agentic_pipeline"
  | "delegate_to_agent_swarm"
  | "manage_agent_schedules";

/** A registry slice keyed by the tool names a module owns. */
export type ToolGroup<K extends ToolName> = Record<K, ToolDefinition>;
