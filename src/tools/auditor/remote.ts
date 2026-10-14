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

const SAFE_REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Clone a repo into an isolated temp directory with symlinks and git hooks
 * disabled, then audit the clone. Returns `null` when the clone or audit failed.
 */
async function cloneAndAudit(repo: string, tmpDir: string): Promise<AuditResult | null> {
  if (!SAFE_REPO_SLUG.test(repo)) {
    console.error(`Refusing to clone invalid repository slug: ${repo}`);
    return null;
  }

  try {
    console.log(`\n📥 Cloning target repository ${repo} to ${tmpDir}...`);
    execFileSync(
      "gh",
      [
        "repo",
        "clone",
        repo,
        tmpDir,
        "--",
        "-c",
        "core.symlinks=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
      ],
      { env: getGitHubAuthEnv(), stdio: "pipe" }
    );
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
 * Audit a remote repository, cloning it into a cryptographically unique temp directory.
 * Returns `null` when the clone or audit itself failed.
 */
export async function auditRemoteRepository(repo: string): Promise<AuditResult | null> {
  if (!SAFE_REPO_SLUG.test(repo)) return null;

  const remoteSha = resolveRemoteHeadSha(repo);

  if (remoteSha) {
    const skip = await evaluateRemoteSkip(repo, remoteSha);
    if (skip.skip) {
      return skippedAuditResult(repo, skip.reason);
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shunopsai-audit-"));
  return cloneAndAudit(repo, tmpDir);
}
