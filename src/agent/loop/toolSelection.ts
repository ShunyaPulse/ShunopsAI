import type OpenAI from "openai";

/**
 * Universal agentic tools every run keeps available regardless of intent.
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

/** Goal keywords that unlock specialist tool families. */
const SPECIALIST_TRIGGERS: Array<{ pattern: RegExp; tools: string[] }> = [
  {
    pattern: /\b(?:swarm|sub-?agent|multi-?agent|blackboard|consensus|debate|audit|auditor)\b/,
    tools: ["delegate_to_agent_swarm", "dual_model_consensus"],
  },
  {
    pattern: /\b(?:schedule|watchdog|monitor|recurring|every\s+\d+|cron|digest|interval|pause|resume)\b/,
    tools: ["manage_agent_schedules"],
  },
  {
    pattern: /\b(?:sql|postgres|neon|supabase|table|schema|query|database|db|row|rows|select|insert|users)\b/,
    tools: ["execute_neon_sql"],
  },
  {
    pattern: /\b(?:redis|upstash|cache|ttl|hget|incr)\b/,
    tools: ["execute_redis_command"],
  },
  {
    pattern: /\b(?:github|repo|repository|branch|commit|issue|pr|pull\s*request|codeql|alert|scan)\b/,
    tools: ["manage_github", "resolve_code_scanning_alerts"],
  },
];

/**
 * One goal covering any of these areas needs the complete tool surface, so the
 * pruning below returns every active tool unchanged.
 */
const FULL_SURFACE_PATTERN =
  /\b(?:gcp|google\s*cloud|bigquery|cloud\s*run|compute|vm|cloudflare|worker|sentinel|heal|shell|bash|directory|video|kaggle|youtube|index)\b/;

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

  if (FULL_SURFACE_PATTERN.test(g)) {
    return allActiveTools;
  }

  const matchedSpecialists = new Set<string>();
  for (const { pattern, tools } of SPECIALIST_TRIGGERS) {
    if (pattern.test(g)) {
      for (const tool of tools) matchedSpecialists.add(tool);
    }
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
