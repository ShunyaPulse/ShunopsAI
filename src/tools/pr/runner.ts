import { colors } from "../../core/colors.js";
import { getTargetReposList } from "../../core/repos.js";
import { isAutonomyPaused } from "../autonomy-state.js";
import { diagnoseAndResolveFailedRun, fetchRecentFailedWorkflowRuns } from "./workflow-runs.js";
import { fetchOpenPRs, reviewAndResolvePR } from "./review.js";

// ==========================================
// Fleet runners
// ==========================================

/** Print a boxed section banner used by the autonomous runners. */
function logBanner(color: string, title: string): void {
  console.log(`\n${color}${colors.bold}====================================================${colors.reset}`);
  console.log(`${color}${colors.bold}${title}${colors.reset}`);
  console.log(`${color}${colors.bold}====================================================${colors.reset}\n`);
}

/** Repositories to operate on: the explicit target, or the configured fleet. */
function resolveTargetRepos(targetRepo?: string): string[] {
  return targetRepo ? [targetRepo] : getTargetReposList();
}

/**
 * Autonomous runner to diagnose, rerun, or report recent failed GitHub Actions workflow runs
 */
export async function runAutoActionResolver(
  targetRepo?: string
): Promise<{ total: number; resolved: number }> {
  logBanner(colors.yellow, "⚙️ ShunopsAI Autonomous CI/CD Actions Monitor & Resolver");

  const repos = resolveTargetRepos(targetRepo);
  let totalActions = 0;
  let resolvedActions = 0;

  for (const repo of repos) {
    console.log(`\n${colors.cyan}📂 Checking recent failed workflow runs in ${repo}...${colors.reset}`);
    const failedRuns = await fetchRecentFailedWorkflowRuns(repo, 3);
    console.log(`Found ${failedRuns.length} recent failed workflow run(s) in ${repo}.`);
    totalActions += failedRuns.length;

    for (const run of failedRuns) {
      const res = await diagnoseAndResolveFailedRun(run, repo);
      if (res.resolved) {
        resolvedActions++;
      }
    }
  }

  console.log(
    `\n${colors.green}${colors.bold}CI/CD Actions Audit Complete: ${resolvedActions}/${totalActions} failed runs diagnosed & resolved across ${repos.length} repos!${colors.reset}`
  );
  return { total: totalActions, resolved: resolvedActions };
}

/**
 * Main autonomous runner to review and resolve open PRs and recent failed actions across all target repositories
 */
export async function runAutoPRResolver(
  targetRepo?: string
): Promise<{ total: number; resolved: number; failedActionsTotal: number; failedActionsResolved: number }> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [PR Resolver] Skipped: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return { total: 0, resolved: 0, failedActionsTotal: 0, failedActionsResolved: 0 };
  }

  logBanner(colors.cyan, "🤖 ShunopsAI Autonomous Pull Request Reviewer & Resolver");

  const repos = resolveTargetRepos(targetRepo);
  let totalPRs = 0;
  let resolvedCount = 0;

  for (const repo of repos) {
    console.log(`\n${colors.cyan}📂 Scanning open PRs in ${repo}...${colors.reset}`);
    const prs = await fetchOpenPRs(repo);
    console.log(`Found ${prs.length} open Pull Request(s) in ${repo}.`);
    totalPRs += prs.length;

    for (const pr of prs) {
      const res = await reviewAndResolvePR(pr, repo);
      if (res.merged || res.approved) {
        resolvedCount++;
      }
    }
  }

  console.log(
    `\n${colors.green}${colors.bold}PR Resolution Complete: ${resolvedCount}/${totalPRs} PRs successfully reviewed and resolved across ${repos.length} repos!${colors.reset}`
  );

  // Scan and auto-resolve recent failed workflow runs across fleet
  const actionRes = await runAutoActionResolver(targetRepo);

  return {
    total: totalPRs,
    resolved: resolvedCount,
    failedActionsTotal: actionRes.total,
    failedActionsResolved: actionRes.resolved,
  };
}
