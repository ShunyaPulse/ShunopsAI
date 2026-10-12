import { execFileSync } from "node:child_process";
import { colors } from "../../core/colors.js";
import { getGitHubAuthEnv } from "../../core/github.js";
import { LOCAL_REPO_SLUG } from "../../core/repos.js";
import { isAutonomyPaused } from "../autonomy-state.js";
import { reviewAndResolvePR } from "../pr-auto-resolver.js";
import { DEFAULT_PROPOSER, DEFAULT_AUDITOR } from "../../ai/consensus.js";
import { collectFlawCandidates } from "./scanner.js";
import { remediateFlawWithConsensus } from "./consensus.js";
import { resolveCurrentCommitSha } from "./commit-identity.js";
import { MAX_FLAWS_PER_AUDIT, evaluateAuditQuota } from "./quota.js";
import { skippedAuditResult } from "./results.js";
import { saveAuditorState } from "./state.js";
import type { AuditResult, CodeFlawCandidate } from "./types.js";

// ==========================================
// Repository audit orchestration
// ==========================================

/** Print the auditor's run header. */
function logAuditorBanner(repoSlug: string, rootDir: string): void {
  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🛡️ ShunopsAI Autonomous Repository Auditor & Healer${colors.reset}`);
  console.log(`${colors.cyan}Target Repo:${colors.reset} ${repoSlug}`);
  console.log(`${colors.cyan}Directory:${colors.reset}   ${rootDir}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);
}

/** Remediate the highest-priority flaws, capped to guard model quota. */
async function remediateTopFlaws(
  allFlaws: CodeFlawCandidate[],
  rootDir: string
): Promise<{ remediatedCount: number; patchSummaries: string[] }> {
  const flawsToRemediate = allFlaws.slice(0, MAX_FLAWS_PER_AUDIT);
  if (allFlaws.length > MAX_FLAWS_PER_AUDIT) {
    console.log(
      `${colors.yellow}⚠️ Limiting remediation to top ${MAX_FLAWS_PER_AUDIT} flaws (out of ${allFlaws.length}) to guard model quota.${colors.reset}`
    );
  }

  let remediatedCount = 0;
  const patchSummaries: string[] = [];

  for (const flaw of flawsToRemediate) {
    const result = await remediateFlawWithConsensus(flaw, rootDir);
    if (result.success) {
      remediatedCount++;
      if (result.patchSummary) patchSummaries.push(result.patchSummary);
    }
  }

  return { remediatedCount, patchSummaries };
}

/** The branch to return to once the healing PR flow finishes. */
function resolveStartingBranch(rootDir: string): string {
  try {
    return (
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim() ||
      "main"
    );
  } catch {
    return "main";
  }
}

/**
 * Open a healing branch and PR for applied fixes, then hand it to the
 * dual-model reviewer. Always restores the starting branch.
 */
async function openHealingPullRequest(
  repoSlug: string,
  rootDir: string,
  remediatedCount: number,
  patchSummaries: string[],
  auditResult: AuditResult
): Promise<void> {
  const authEnv = getGitHubAuthEnv();
  const branchName = `heal/autonomous-fix-${Date.now().toString(36)}`;

  // Remember where we started: a failure part-way through the PR flow used to
  // leave the working tree on the temporary heal branch (or force-switch it
  // to `main` even when the caller was on a feature branch).
  const originalBranch = resolveStartingBranch(rootDir);

  try {
    console.log(`\n${colors.cyan}🚀 Creating autonomous branch and Pull Request for ${remediatedCount} fix(es)...${colors.reset}`);
    execFileSync("git", ["checkout", "-b", branchName], { cwd: rootDir, env: authEnv, stdio: "pipe" });
    execFileSync("git", ["add", "-A"], { cwd: rootDir, env: authEnv, stdio: "pipe" });

    const changeList = patchSummaries.map((s) => `- ${s}`).join("\n");
    const commitMessage = `fix(auto-heal): resolve ${remediatedCount} security & logic flaw(s)\n\n${changeList}\n\n🤖 Generated autonomously by ShunopsAI Dual-Model Consensus (${DEFAULT_PROPOSER.name} + ${DEFAULT_AUDITOR.name})`;
    execFileSync("git", ["commit", "-m", commitMessage], { cwd: rootDir, env: authEnv, stdio: "pipe" });

    execFileSync("git", ["push", "-u", "origin", branchName], { cwd: rootDir, env: authEnv, stdio: "pipe" });
    console.log(`${colors.green}✓ Pushed branch ${branchName} to origin!${colors.reset}`);

    const prBody = `## 🤖 ShunopsAI Autonomous Code Healing & Security Hardening\n\n### Summary of Changes:\n${changeList}\n\n### Consensus Verification:\n- **Model 1 (${DEFAULT_PROPOSER.name})**: Proposed semantic security & reliability patches.\n- **Model 2 (${DEFAULT_AUDITOR.name})**: Audited AST structures and edge cases.\n- **Verification**: Zero TypeScript compile errors (\`tsc --noEmit\` passed).\n\n*Created autonomously by ShunopsAI Sentinel.*`;

    const prRaw = execFileSync(
      "gh",
      [
        "pr", "create",
        "--repo", repoSlug,
        "--title", `fix(auto-heal): autonomous security hardening (${remediatedCount} flaws resolved)`,
        "--body", prBody,
        "--head", branchName,
        "--base", "main",
      ],
      { cwd: rootDir, env: authEnv, encoding: "utf-8" }
    );

    const prUrl = prRaw.trim();
    console.log(`${colors.green}✓ Created Pull Request: ${prUrl}${colors.reset}`);
    auditResult.prCreated = prUrl;

    // Extract PR number from URL and auto-review/auto-merge
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (match && match[1]) {
      const prNumber = parseInt(match[1], 10);
      console.log(`🤝 Triggering Dual-Model PR Auto-Resolver for #${prNumber}...`);
      const reviewResult = await reviewAndResolvePR(
        {
          number: prNumber,
          title: `fix(auto-heal): autonomous security hardening`,
          author: { login: "shunopsai" },
          headRefName: branchName,
          url: prUrl,
        },
        repoSlug
      );
      auditResult.prMerged = reviewResult.merged;
    }
  } catch (gitErr: any) {
    console.error(`GitOps PR creation notice: ${gitErr.message}`);
  } finally {
    // Always restore the starting branch, even when the PR flow failed.
    try {
      execFileSync("git", ["checkout", originalBranch], {
        cwd: rootDir,
        env: authEnv,
        stdio: "pipe",
      });
    } catch (restoreErr: any) {
      console.warn(
        `${colors.yellow}⚠️ Could not restore original branch ${originalBranch}: ${restoreErr.message}${colors.reset}`
      );
    }

    if (auditResult.prMerged) {
      try {
        execFileSync("git", ["pull", "origin", originalBranch], {
          cwd: rootDir,
          env: authEnv,
          stdio: "pipe",
        });
      } catch {}
    }
  }
}

/** Persist the outcome of an audit run against its (possibly post-merge) commit. */
async function recordAuditState(
  repoSlug: string,
  rootDir: string,
  currentCommitSha: string,
  consecutiveRuns: number,
  auditResult: AuditResult,
  remediatedCount: number
): Promise<void> {
  let finalCommitSha = currentCommitSha;
  try {
    finalCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {}

  if (finalCommitSha) {
    await saveAuditorState(repoSlug, {
      lastAuditedCommitSha: finalCommitSha,
      lastSelfGeneratedCommitSha: auditResult.prMerged ? finalCommitSha : undefined,
      consecutiveRunsOnSameCommit: auditResult.prMerged ? 2 : consecutiveRuns,
      lastAuditedAt: new Date().toISOString(),
      lastStatus: remediatedCount > 0 ? "remediated" : "clean",
    });
  }
}

/**
 * Autonomously audit and heal a repository with Smart Quota Guardrails
 */
export async function auditAndHealRepository(
  repoSlug = LOCAL_REPO_SLUG,
  rootDir = process.cwd(),
  options: { createPR?: boolean; force?: boolean } = { createPR: true }
): Promise<AuditResult> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [Auditor] Skipped ${repoSlug}: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return skippedAuditResult(repoSlug, "Autonomy is paused by user killswitch");
  }

  logAuditorBanner(repoSlug, rootDir);

  // 1. Fetch current commit SHA for change tracking
  const currentCommitSha = resolveCurrentCommitSha(rootDir, repoSlug);

  // 2. Smart Quota Guardrail: Max 2 consecutive runs on the same commit SHA
  let consecutiveRuns = 1;
  if (!options.force && currentCommitSha) {
    const quota = await evaluateAuditQuota(repoSlug, currentCommitSha, rootDir);
    if (quota.skip) {
      return quota.result;
    }
    consecutiveRuns = quota.consecutiveRuns;
  }

  // 3. Scan every source file for heuristic flaws
  const { files, flaws: allFlaws } = await collectFlawCandidates(rootDir);
  console.log(`Audit complete: Found ${allFlaws.length} flaw candidate(s).`);

  if (allFlaws.length === 0) {
    console.log(`${colors.green}Repository is clean! No security or logic flaws detected. 🎉${colors.reset}`);
    if (currentCommitSha) {
      await saveAuditorState(repoSlug, {
        lastAuditedCommitSha: currentCommitSha,
        consecutiveRunsOnSameCommit: consecutiveRuns,
        lastAuditedAt: new Date().toISOString(),
        lastStatus: "clean",
      });
    }
    return {
      repo: repoSlug,
      scannedFiles: files.length,
      flawsDetected: 0,
      flawsRemediated: 0,
    };
  }

  // Quota Guardrail: Cap remediation to top 5 flaws per run to prevent token bursts
  const { remediatedCount, patchSummaries } = await remediateTopFlaws(allFlaws, rootDir);

  const auditResult: AuditResult = {
    repo: repoSlug,
    scannedFiles: files.length,
    flawsDetected: allFlaws.length,
    flawsRemediated: remediatedCount,
  };

  // If fixes were applied and createPR is requested:
  if (remediatedCount > 0 && options.createPR) {
    await openHealingPullRequest(repoSlug, rootDir, remediatedCount, patchSummaries, auditResult);
  }

  // Update audit state with the post-merge commit SHA
  await recordAuditState(repoSlug, rootDir, currentCommitSha, consecutiveRuns, auditResult, remediatedCount);

  return auditResult;
}
