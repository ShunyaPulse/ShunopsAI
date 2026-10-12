import OpenAI from "openai";
import { colors } from "../../core/colors.js";
import { extractJsonObject } from "../../core/json.js";
import { DEFAULT_PROPOSER, BACKUP_OPENROUTER_PROPOSER, callModel } from "../../ai/consensus.js";
import { gh, parseGhJson } from "./gh.js";
import type { FailedWorkflowRunItem } from "./types.js";

// ==========================================
// Workflow-run inspection
// ==========================================

const TRANSIENT_RUNNER_FAILURE =
  /runner connection lost|network request timed out|ETIMEDOUT|503 Service Unavailable|502 Bad Gateway/i;
const NPM_AUDIT_FAILURE = /npm audit --audit-level|vulnerabilities\s*\(\d+\s*high|\d+\s*critical\)/i;

/** Root-cause diagnosis the proposer produces for a failed workflow run. */
interface FailureDiagnosis {
  failureCategory: string;
  rootCause: string;
  remediation: string;
  autoFixable: boolean;
}

/**
 * Fetch recent failed workflow runs in repository
 */
export async function fetchRecentFailedWorkflowRuns(
  repo = "ShunyaPulse/ShunopsAI",
  limit = 5
): Promise<FailedWorkflowRunItem[]> {
  try {
    const raw = gh([
      "run",
      "list",
      "--repo",
      repo,
      "--status",
      "failure",
      "--limit",
      String(limit),
      "--json",
      "databaseId,workflowName,workflowDatabaseId,headBranch,headSha,event,displayTitle,url,conclusion,createdAt",
    ]);
    return parseGhJson<FailedWorkflowRunItem[]>(raw);
  } catch (err: any) {
    console.error(`[Error fetching failed workflow runs in ${repo}] ${String(err?.message || err)}`);
    return [];
  }
}

/**
 * Fetch failed step log for a workflow run
 */
export async function fetchFailedRunLog(runId: number, repo: string): Promise<string> {
  try {
    return gh(["run", "view", String(runId), "--repo", repo, "--log-failed"]) || "";
  } catch (err: any) {
    console.warn(`[fetchFailedRunLog error on #${runId}] ${err.message}`);
    return "";
  }
}

/** Whether the run's branch no longer has an open PR (already merged or closed). */
function isBranchAlreadyResolved(run: FailedWorkflowRunItem, repo: string): boolean | null {
  if (!run.headBranch || run.headBranch === "main" || run.headBranch === "master") {
    return null;
  }
  try {
    const openPrs = parseGhJson<any[]>(
      gh(["pr", "list", "--repo", repo, "--head", run.headBranch, "--state", "open", "--json", "number"])
    );
    return openPrs.length === 0;
  } catch {
    // Fall back to checking workflow history.
    return null;
  }
}

/** Find a strictly newer successful run of the exact same workflow, if any. */
function findNewerSuccessfulRun(run: FailedWorkflowRunItem, repo: string): any | null {
  const workflowTarget = run.workflowDatabaseId ? String(run.workflowDatabaseId) : run.workflowName;
  const successRuns = parseGhJson<any[]>(
    gh([
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      workflowTarget,
      "--branch",
      run.headBranch,
      "--status",
      "success",
      "--limit",
      "5",
      "--json",
      "databaseId,workflowName,workflowDatabaseId,createdAt",
    ])
  );

  return (
    successRuns.find((s: any) => {
      // Strict identity check: MUST be the exact same workflow by ID or exact Name
      const isSameWorkflow =
        (run.workflowDatabaseId && s.workflowDatabaseId && s.workflowDatabaseId === run.workflowDatabaseId) ||
        (s.workflowName && run.workflowName && s.workflowName.trim().toLowerCase() === run.workflowName.trim().toLowerCase());

      if (!isSameWorkflow) {
        return false;
      }

      return new Date(s.createdAt).getTime() > new Date(run.createdAt).getTime();
    }) || null
  );
}

/**
 * Check if a failed workflow run is superseded by a newer successful run of the exact same workflow or if its PR branch is closed
 */
export async function isRunSupersededOrResolved(
  run: FailedWorkflowRunItem,
  repo: string
): Promise<{ resolved: boolean; reason: string }> {
  try {
    if (isBranchAlreadyResolved(run, repo)) {
      return { resolved: true, reason: `Branch ${run.headBranch} is no longer open or was already merged/closed.` };
    }

    const newerSuccess = findNewerSuccessfulRun(run, repo);
    if (newerSuccess) {
      return {
        resolved: true,
        reason: `Superseded by newer successful run #${newerSuccess.databaseId} of exact same workflow "${run.workflowName}" (ID: ${run.workflowDatabaseId ?? "N/A"}) at ${newerSuccess.createdAt}.`,
      };
    }

    return { resolved: false, reason: `No newer successful run found for workflow "${run.workflowName}".` };
  } catch (err: any) {
    return { resolved: false, reason: `Check failed: ${err.message}` };
  }
}

/** Rerun the failed jobs of a run; returns whether the rerun was triggered. */
function rerunFailedJobs(run: FailedWorkflowRunItem, repo: string): boolean {
  try {
    gh(["run", "rerun", String(run.databaseId), "--repo", repo, "--failed"]);
    console.log(`${colors.green}✓ Triggered rerun for failed jobs in run #${run.databaseId}!${colors.reset}`);
    return true;
  } catch (rerunErr: any) {
    console.warn(`[Rerun error on #${run.databaseId}] ${rerunErr.message}`);
    return false;
  }
}

/** Log dependency-scope guidance for the known npm audit CI failure pattern. */
function reportNpmAuditGuidance(run: FailedWorkflowRunItem, failedLog: string): void {
  if (!NPM_AUDIT_FAILURE.test(failedLog)) return;

  console.log(
    `${colors.yellow}⚠️ Detected npm audit failure in run #${run.databaseId}. Analyzing dependency scope...${colors.reset}`
  );
  if (/braces/i.test(failedLog) || /eslint-config-next/i.test(failedLog)) {
    console.log(
      `${colors.magenta}Fix identified: CI workflow running npm audit on unpatched transitive devDependencies. Use --omit=dev or update audit level.${colors.reset}`
    );
  }
}

/**
 * Ask the proposer model to diagnose a failed run.
 *
 * Returns the recorded action summary, or `null` when no diagnosis was produced.
 */
async function diagnoseFailureWithConsensus(
  run: FailedWorkflowRunItem,
  repo: string,
  failedLog: string
): Promise<string | null> {
  try {
    const logSnippet = failedLog.slice(-2500);
    const m1Prompt: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are an Autonomous Site Reliability & CI/CD Engineer. Diagnose the following failed GitHub Actions log and provide a concise JSON object:
{
  "failureCategory": "dependency_audit" | "test_failure" | "build_error" | "secret_leak" | "transient_infra",
  "rootCause": "<1-2 sentence technical explanation>",
  "remediation": "<exact fix required in code or workflow yaml>",
  "autoFixable": boolean
}`,
      },
      {
        role: "user",
        content: `Repository: ${repo}\nWorkflow: ${run.workflowName}\nBranch: ${run.headBranch}\nRun ID: ${run.databaseId}\nTitle: ${run.displayTitle}\n\nFailed Log Output:\n\`\`\`\n${logSnippet}\n\`\`\``,
      },
    ];

    const m1Res = await callModel(DEFAULT_PROPOSER, m1Prompt, BACKUP_OPENROUTER_PROPOSER, 0.1);
    const diagnosis = extractJsonObject<FailureDiagnosis>(m1Res.text);
    if (!diagnosis) {
      return null;
    }

    console.log(
      `${colors.cyan}🤖 [Dual-Model Action Diagnosis] ${diagnosis.failureCategory}: ${diagnosis.rootCause}${colors.reset}`
    );
    console.log(`${colors.gray}Proposed Remediation: ${diagnosis.remediation}${colors.reset}`);
    return `Diagnosed (${diagnosis.failureCategory}): ${diagnosis.rootCause}. Remediation: ${diagnosis.remediation}`;
  } catch (diagErr: any) {
    console.warn(`[Diagnosis error on #${run.databaseId}] ${diagErr.message}`);
    return null;
  }
}

/**
 * Diagnose and resolve or rerun a failed workflow run
 */
export async function diagnoseAndResolveFailedRun(
  run: FailedWorkflowRunItem,
  repo: string
): Promise<{ resolved: boolean; actionTaken: string }> {
  console.log(
    `\n${colors.yellow}🔍 Inspecting failed workflow run #${run.databaseId} (${run.workflowName}) on ${repo}:${run.headBranch}...${colors.reset}`
  );

  // 1. Check if already superseded or resolved
  const check = await isRunSupersededOrResolved(run, repo);
  if (check.resolved) {
    console.log(`${colors.green}✓ Run #${run.databaseId} resolved: ${check.reason}${colors.reset}`);
    return { resolved: true, actionTaken: check.reason };
  }

  // 2. Fetch the failure logs
  const failedLog = await fetchFailedRunLog(run.databaseId, repo);
  if (!failedLog) {
    return { resolved: false, actionTaken: "No failure logs available to diagnose." };
  }

  // 3. Transient infrastructure failures: rerun the failed jobs
  if (TRANSIENT_RUNNER_FAILURE.test(failedLog)) {
    console.log(
      `${colors.cyan}⚡ Transient infrastructure failure detected in run #${run.databaseId}. Attempting auto-rerun...${colors.reset}`
    );
    if (rerunFailedJobs(run, repo)) {
      return { resolved: true, actionTaken: "Triggered GitHub Actions rerun for transient failure." };
    }
  }

  // 4. Known npm audit failure pattern: report fix guidance
  reportNpmAuditGuidance(run, failedLog);

  // 5. Dual-Model Consensus Diagnosis for complex failures
  const diagnosis = await diagnoseFailureWithConsensus(run, repo, failedLog);
  if (diagnosis) {
    return { resolved: false, actionTaken: diagnosis };
  }

  return { resolved: false, actionTaken: `Workflow #${run.databaseId} requires manual remediation.` };
}
