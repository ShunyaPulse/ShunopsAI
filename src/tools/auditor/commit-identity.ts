import { execFileSync } from "node:child_process";
import { getGitHubAuthEnv } from "../../core/github.js";
import { LOCAL_REPO_SLUG } from "../../core/repos.js";

// ==========================================
// Commit identity & self-heal detection
// ==========================================

/** Marker matcher shared by the local-git and remote-GitHub commit lookups. */
function isSelfGeneratedCommitMessage(message: string): boolean {
  return (
    /fix\(auto-heal\)/i.test(message) ||
    /Generated autonomously by ShunopsAI/i.test(message) ||
    /\[auto-heal\]/i.test(message)
  );
}

/**
 * Check if a commit was authored or generated autonomously by ShunopsAI
 */
export function isSelfGeneratedCommit(
  commitSha: string,
  rootDir = process.cwd(),
  repoSlug = LOCAL_REPO_SLUG
): boolean {
  if (!commitSha) return false;
  try {
    const message = execFileSync("git", ["log", "-1", "--format=%s%n%b", commitSha], {
      cwd: rootDir,
      encoding: "utf-8",
    });
    if (isSelfGeneratedCommitMessage(message)) {
      return true;
    }
  } catch {
    try {
      const raw = execFileSync(
        "gh",
        ["api", `repos/${repoSlug}/commits/${commitSha}`, "--jq", ".commit.message"],
        { env: getGitHubAuthEnv(), encoding: "utf-8" }
      );
      if (isSelfGeneratedCommitMessage(raw)) {
        return true;
      }
    } catch {}
  }
  return false;
}

/** Resolve the commit under audit: local HEAD, else the remote HEAD SHA. */
export function resolveCurrentCommitSha(rootDir: string, repoSlug: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {
    try {
      return execFileSync("gh", ["api", `repos/${repoSlug}/commits/HEAD`, "--jq", ".sha"], {
        env: getGitHubAuthEnv(),
        encoding: "utf-8",
      }).trim();
    } catch {
      return "";
    }
  }
}

/** Read the remote HEAD SHA straight from GitHub (empty string when unreadable). */
export function resolveRemoteHeadSha(repoSlug: string): string {
  try {
    return execFileSync("gh", ["api", `repos/${repoSlug}/commits/HEAD`, "--jq", ".sha"], {
      env: getGitHubAuthEnv(),
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}
