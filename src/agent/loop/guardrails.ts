import { getCachedTurnIntakeDecision } from "../../ai/decisions.js";

/** Per-run tally of agentic actions the user explicitly asked for. */
export interface FulfilledActionCounts {
  workspaceFilesSaved: number;
  memoriesSaved: number;
  tasksPlanned: number;
  schedulesCreated: number;
  swarmsDispatched: number;
}

export function createActionCounters(): FulfilledActionCounts {
  return {
    workspaceFilesSaved: 0,
    memoriesSaved: 0,
    tasksPlanned: 0,
    schedulesCreated: 0,
    swarmsDispatched: 0,
  };
}

/** Tool output that starts like this is treated as a failed execution. */
export function isErrorToolOutput(result: string): boolean {
  return /^Error\b|Execution Failed|Aborted by safety gate/i.test(result.trim());
}

interface DeliverableCheck {
  goalPattern: RegExp;
  /** Semantic Mammoth-1 intake flag corresponding to this deliverable. */
  mammothKey: keyof NonNullable<ReturnType<typeof getCachedTurnIntakeDecision>>["expectedDeliverables"];
  /** Counter field that must have been incremented. */
  counter: keyof FulfilledActionCounts;
  tool: string;
  /** Instruction fed back to the model when the deliverable is missing. */
  instruction: (match: RegExpMatchArray | null, userGoal: string) => string;
}

const DELIVERABLE_CHECKS: DeliverableCheck[] = [
  {
    goalPattern:
      /\b(?:save|write|create|draft|store|export)\b[\s\S]{0,80}?\b([a-zA-Z0-9_\-./]+\.(?:md|json|csv|js|ts|txt|html|sql|py|yaml|yml))\b/i,
    mammothKey: "saveWorkspaceFile",
    counter: "workspaceFilesSaved",
    tool: "manage_workspace_files",
    instruction: (match, userGoal) => {
      const explicitFile =
        match?.[1] ||
        userGoal.match(/\b([a-zA-Z0-9_\-./]+\.(?:md|json|csv|js|ts|txt|html|sql|py|yaml|yml))\b/i)?.[1];
      return explicitFile
        ? `Save the requested file "${explicitFile}" using manage_workspace_files (operation: "write", filename: "${explicitFile}", content: "...").`
        : `Save the requested workspace file using manage_workspace_files (operation: "write", filename: "...", content: "...").`;
    },
  },
  {
    goalPattern:
      /\b(?:remember\s+that|save\s+(?:this\s+)?to\s+(?:your\s+|agent\s+)?memory|store\s+in\s+(?:long-term\s+)?memory)\b/i,
    mammothKey: "saveMemory",
    counter: "memoriesSaved",
    tool: "manage_agent_memory",
    instruction: () =>
      `Save the user's fact/preference using manage_agent_memory (operation: "remember", key: "...", fact: "...").`,
  },
  {
    goalPattern:
      /\b(?:create\s+a\s+(?:\d+-step\s+)?(?:task\s+|action\s+|launch\s+|rollout\s+)?plan|add\s+to\s+(?:my\s+)?checklist)\b/i,
    mammothKey: "createTaskPlan",
    counter: "tasksPlanned",
    tool: "manage_agent_tasks",
    instruction: () =>
      `Create the requested task plan using manage_agent_tasks (operation: "create_plan", tasks: [...]).`,
  },
  {
    goalPattern:
      /\b(?:create\s+a\s+scheduled|schedule\s+a\s+(?:website\s+)?monitor|monitor\s+https?:\/\/\S+\s+every\s+\d+)\b/i,
    mammothKey: "createSchedule",
    counter: "schedulesCreated",
    tool: "manage_agent_schedules",
    instruction: () =>
      `Create the requested recurring monitor using manage_agent_schedules (operation: "create_schedule", ...).`,
  },
  {
    goalPattern:
      /\b(?:delegate\s+to\s+(?:an?\s+)?(?:agent\s+)?swarm|run\s+a\s+multi-agent\s+swarm|spawn\s+an?\s+agent\s+swarm)\b/i,
    mammothKey: "dispatchSwarm",
    counter: "swarmsDispatched",
    tool: "delegate_to_agent_swarm",
    instruction: () =>
      `Dispatch the requested Multi-Agent Swarm using delegate_to_agent_swarm (objective: "...", agents: [...]).`,
  },
];

/**
 * Step 2 Multi-Intent Action & Deliverable Verification Guardrail:
 * Combines Mammoth-1 semantic deliverable detection (covering English, Hinglish, and natural phrasing)
 * with regex fallback to verify requested deliverables were executed before concluding.
 */
export function findUnfulfilledRequestedActions(
  userGoal: string,
  allowedNames: Set<string>,
  counts: FulfilledActionCounts
): string[] {
  const missing: string[] = [];
  const mammothIntake = getCachedTurnIntakeDecision(userGoal);

  for (const check of DELIVERABLE_CHECKS) {
    if (counts[check.counter] > 0 || !allowedNames.has(check.tool)) continue;
    const match = userGoal.match(check.goalPattern);
    const semanticHit = Boolean(mammothIntake?.expectedDeliverables?.[check.mammothKey]);
    if (match || semanticHit) {
      missing.push(check.instruction(match, userGoal));
    }
  }
  return missing;
}

export function recordFulfilledActions(
  toolName: string,
  parsedArgs: Record<string, any>,
  executionResult: string,
  counts: FulfilledActionCounts
): void {
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
    counts.workspaceFilesSaved++;
  }
  if (
    (toolName === "manage_agent_memory" && parsedArgs.operation === "remember") ||
    (toolName === "run_agentic_pipeline" && executionResult.includes(": remember"))
  ) {
    counts.memoriesSaved++;
  }
  if (toolName === "manage_agent_schedules" && parsedArgs.operation === "create_schedule") {
    counts.schedulesCreated++;
  }
  if (toolName === "delegate_to_agent_swarm") {
    counts.swarmsDispatched++;
  }
  if (
    (toolName === "manage_agent_tasks" &&
      (parsedArgs.operation === "create_plan" ||
        parsedArgs.operation === "add_task")) ||
    (toolName === "run_agentic_pipeline" && executionResult.includes(": create_plan")) ||
    toolName === "delegate_to_agent_swarm"
  ) {
    counts.tasksPlanned++;
  }
}

const SANDBOX_REFLEXION_CUE =
  "\n\n[Autonomous Reflexion Cue]: Sandbox execution error. Built-in helpers available: readWorkspaceFile(name), writeWorkspaceFile(name, content), formatMarkdownTable(rows), csvParse(text), jsonParseSafe(text), sum(arr), mean(arr), median(arr), stdDev(arr), groupBy(arr, key). Fix the JavaScript syntax/logic and re-execute.";

const EMPTY_SEARCH_CUE =
  "\n\n[Autonomous Reflexion Cue]: Search returned 0 results. Reformulate your query: strip special characters, use broader technical synonyms, or inspect an authoritative documentation URL directly using inspect_website.";

export function augmentWithReflexionCue(
  toolName: string,
  result: string,
  isError: boolean,
  repeatCount: number
): string {
  if (isError) {
    if (toolName === "execute_sandboxed_code") {
      return result + SANDBOX_REFLEXION_CUE;
    }
    return (
      result +
      `\n\n[Self-Reflection Guardrail]: Tool "${toolName}" returned an error. Analyze the error message above, adjust your arguments or try an alternative approach, and do NOT repeat the exact same failing call.`
    );
  }
  if (toolName === "web_search" && result.includes("No live web search results found")) {
    return result + EMPTY_SEARCH_CUE;
  }
  if (repeatCount >= 2) {
    return (
      result +
      `\n\n[Self-Reflection Guardrail]: You have already invoked "${toolName}" with these identical arguments (${repeatCount}x). Synthesize the gathered data now and provide your final answer or proceed to the next distinct step.`
    );
  }
  return result;
}
