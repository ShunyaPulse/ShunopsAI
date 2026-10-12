import { colors } from "../../core/colors.js";
import { getTargetReposList, isLocalRepo } from "../../core/repos.js";
import { isAutonomyPaused } from "../autonomy-state.js";
import { auditAndHealRepository } from "./audit.js";
import { auditRemoteRepository } from "./remote.js";
import type { AuditResult } from "./types.js";

// ==========================================
// Multi-repository runner
// ==========================================

/**
 * Multi-Repository runner: iterates through all target repositories configured in AUTONOMOUS_TARGET_REPOS
 */
export async function runMultiRepoAutonomousAuditor(): Promise<AuditResult[]> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [Multi-Repo Auditor] Skipped: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return [];
  }

  const results: AuditResult[] = [];

  for (const repo of getTargetReposList()) {
    if (isLocalRepo(repo)) {
      // Local repo
      results.push(await auditAndHealRepository(repo, process.cwd(), { createPR: true }));
      continue;
    }

    const remoteResult = await auditRemoteRepository(repo);
    if (remoteResult) {
      results.push(remoteResult);
    }
  }

  return results;
}
