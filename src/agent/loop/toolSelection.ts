import type OpenAI from "openai";
import { getCachedTurnIntakeDecision } from "../../ai/decisions.js";

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

/** Fast fallback keyword triggers when Mammoth-1 intake is not cached. */
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
    pattern: /\b(?:sql|postgres|neon|supabase|table|schema|query|database|db|row|rows|select|insert|users|signup|account|record)\b/,
    tools: ["execute_neon_sql"],
  },
  {
    pattern: /\b(?:redis|upstash|cache|ttl|hget|incr|queue|rate-?limit)\b/,
    tools: ["execute_redis_command"],
  },
  {
    pattern: /\b(?:github|repo|repository|branch|commit|issue|pr|pull\s*request|codeql|alert|scan)\b/,
    tools: ["manage_github", "resolve_code_scanning_alerts"],
  },
];

const FULL_SURFACE_PATTERN =
  /\b(?:gcp|google\s*cloud|bigquery|cloud\s*run|compute|vm|cloudflare|worker|sentinel|heal|shell|bash|directory|video|kaggle|youtube|index)\b/;

/**
 * Zero-Loss Energy Efficiency: Semantic + Intent-Scoped Dynamic Tool Schema Pruning.
 * Combines Baseten Mammoth 1's single-pass semantic capability detection (when available)
 * with fast fallback triggers so specialist tools are never pruned due to missing keywords.
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

  // Check Baseten Mammoth 1 semantic intake decision (populated during routing / prepareRun)
  const mammothIntake = getCachedTurnIntakeDecision(userGoal);
  if (mammothIntake?.unlockedToolFamilies.cloudOrFullSurface || FULL_SURFACE_PATTERN.test(g)) {
    return allActiveTools;
  }

  const matchedSpecialists = new Set<string>();

  if (mammothIntake) {
    const fam = mammothIntake.unlockedToolFamilies;
    if (fam.sqlDb) matchedSpecialists.add("execute_neon_sql");
    if (fam.redisCache) matchedSpecialists.add("execute_redis_command");
    if (fam.githubOps) {
      matchedSpecialists.add("manage_github");
      matchedSpecialists.add("resolve_code_scanning_alerts");
    }
    if (fam.multiAgentSwarm) {
      matchedSpecialists.add("delegate_to_agent_swarm");
      matchedSpecialists.add("dual_model_consensus");
    }
    if (fam.schedules) {
      matchedSpecialists.add("manage_agent_schedules");
    }
  }

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
