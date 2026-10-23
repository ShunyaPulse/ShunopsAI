import { errorMessage } from "../../core/errors.js";
import { executeInSandbox } from "../../agent/sandbox/runner.js";
import { executeWebSearch, inspectWebsite } from "../cloud.js";
import { executeManageWorkspaceFiles, persistSandboxWrittenFiles } from "./files.js";
import { executeManageAgentMemory } from "./memory.js";
import { executeManageAgentTasks } from "./tasks.js";
import { getTenantFilesMap } from "./store.js";
import type { AgenticPipelineStep } from "./types.js";

/**
 * 4. Compound Multi-Tool Chaining Engine (`run_agentic_pipeline`)
 *
 * Runs up to eight dependent steps in order, feeding each step's output to the
 * next one through `pipelineOutputs`. A failing step is reported, never thrown,
 * so the remaining steps still run.
 */

const MAX_PIPELINE_STEPS = 8;
const MAX_STEP_OUTPUT_CHARS = 1500;

export interface WebSearchCredentials {
  provider?: "tavily" | "brave";
  apiKey?: string;
}

function lastOutput(outputs: string[]): string {
  return outputs[outputs.length - 1] || "";
}

function formatSandboxOutcome(
  sandbox: Awaited<ReturnType<typeof executeInSandbox>>,
  savedNames: string[]
): string {
  if (!sandbox.success) return `Error in sandbox step: ${sandbox.error}`;
  const parts = [
    sandbox.result !== null ? JSON.stringify(sandbox.result, null, 2) : "",
    sandbox.logs.length > 0 ? `Logs:\n${sandbox.logs.join("\n")}` : "",
    savedNames.length > 0 ? `Saved workspace files: ${savedNames.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("\n") || "Executed successfully.";
}

async function runStep(
  step: AgenticPipelineStep,
  tenantKey: string,
  outputs: string[],
  webSearchCredentials?: WebSearchCredentials
): Promise<string> {
  switch (step.action) {
    case "create_plan":
      return executeManageAgentTasks(
        { operation: "create_plan", tasks: step.tasks || [] },
        tenantKey
      );

    case "update_task":
      return executeManageAgentTasks(
        {
          operation: "update_task",
          taskId: step.taskId,
          status: step.status || "completed",
          notes: step.notes,
        },
        tenantKey
      );

    case "web_search":
      return executeWebSearch(String(step.query || ""), {
        ...(webSearchCredentials || {}),
        maxResults: 5,
      });

    case "inspect_website":
      return inspectWebsite(String(step.url || ""), step.focusQuery);

    case "write_file":
      return executeManageWorkspaceFiles(
        {
          operation: step.append ? "append" : "write",
          filename: step.filename,
          content: step.content ?? lastOutput(outputs),
        },
        tenantKey
      );

    case "read_file":
      return executeManageWorkspaceFiles(
        { operation: "read", filename: step.filename },
        tenantKey
      );

    case "remember":
      return executeManageAgentMemory(
        {
          operation: "remember",
          key: step.key,
          fact: step.fact ?? lastOutput(outputs),
          tags: step.tags,
        },
        tenantKey
      );

    case "recall":
      return executeManageAgentMemory(
        { operation: "recall", query: step.query || step.key },
        tenantKey
      );

    case "execute_code": {
      const sandbox = await executeInSandbox(String(step.code || ""), {
        timeoutMs: step.timeoutMs,
        workspaceFiles: getTenantFilesMap(tenantKey),
        pipelineOutputs: outputs,
      });
      if (!sandbox.success) {
        return `Error in sandbox step: ${sandbox.error}`;
      }
      const savedNames = await persistSandboxWrittenFiles(sandbox.writtenFiles, tenantKey);
      return formatSandboxOutcome(sandbox, savedNames);
    }

    default:
      return `Error: Unsupported pipeline action "${(step as { action?: unknown }).action}".`;
  }
}

export async function executeAgenticPipeline(
  args: { steps: AgenticPipelineStep[] },
  tenantKey: string,
  webSearchCredentials?: WebSearchCredentials
): Promise<string> {
  const steps = Array.isArray(args?.steps) ? args.steps.slice(0, MAX_PIPELINE_STEPS) : [];
  if (steps.length === 0) {
    return "Error: 'steps' array must contain at least 1 pipeline step.";
  }

  const outputs: string[] = [];
  const stepReports: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepNum = i + 1;
    const startedAt = Date.now();
    let out: string;

    try {
      out = await runStep(step, tenantKey, outputs, webSearchCredentials);
    } catch (err) {
      out = `Error in pipeline step ${stepNum} (${step.action}): ${errorMessage(err)}`;
    }

    outputs.push(out);
    const elapsed = Math.max(1, Date.now() - startedAt);
    stepReports.push(
      `--- [Pipeline Step ${stepNum}/${steps.length}: ${step.action} (${elapsed}ms)] ---\n${out.slice(0, MAX_STEP_OUTPUT_CHARS)}`
    );
  }

  return `Agentic Pipeline Completed (${steps.length} steps):\n\n${stepReports.join("\n\n")}`;
}
