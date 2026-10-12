import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getGitHubAuthEnv } from "../../core/github.js";
import { auditAndHealRepository } from "./audit.js";
import { resolveRemoteHeadSha } from "./commit-identity.js";
import { evaluateRemoteSkip } from "./quota.js";
import { skippedAuditResult } from "./results.js";
import type { AuditResult } from "./types.js";

// ==========================================
// Remote repository auditing
// ==========================================

/**
 * Clone a repo into an isolated temp directory and audit the clone.
 * Returns `null` when the clone or audit itself failed.
 */
async function cloneAndAudit(repo: string, tmpDir: string): Promise<AuditResult | null> {
  try {
    console.log(`\n📥 Cloning target repository ${repo} to ${tmpDir}...`);
    execFileSync("gh", ["repo", "clone", repo, tmpDir], { env: getGitHubAuthEnv(), stdio: "pipe" });
    return await auditAndHealRepository(repo, tmpDir, { createPR: true });
  } catch (cloneErr: any) {
    console.error(`Error auditing remote repo ${repo}: ${cloneErr.message}`);
    return null;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Audit a remote repository, cloning it into an isolated temp directory.
 * Returns `null` when the clone or audit itself failed.
 */
export async function auditRemoteRepository(repo: string): Promise<AuditResult | null> {
  const remoteSha = resolveRemoteHeadSha(repo);

  if (remoteSha) {
    const skip = await evaluateRemoteSkip(repo, remoteSha);
    if (skip.skip) {
      return skippedAuditResult(repo, skip.reason);
    }
  }

  const tmpDir = path.join(os.tmpdir(), `shunopsai-audit-${repo.replace("/", "-")}-${Date.now()}`);
  return cloneAndAudit(repo, tmpDir);
}
