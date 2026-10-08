import * as path from "node:path";

/**
 * Target repositories the autonomous runners operate on.
 *
 * Centralised here because the PR resolver, workflow-run resolver, code
 * scanner, and repository auditor all iterate the same fleet and previously
 * each re-parsed `AUTONOMOUS_TARGET_REPOS` with a duplicated default list.
 */
export const LOCAL_REPO_SLUG = "ShunyaPulse/ShunopsAI";

export const DEFAULT_TARGET_REPOS = [
  LOCAL_REPO_SLUG,
  "ShunyaPulse/SaralGati",
  "ShunyaPulse/kanban-cloud",
];

/**
 * Repositories to audit, from `AUTONOMOUS_TARGET_REPOS` (comma-separated) or
 * the built-in default fleet.
 */
export function getTargetReposList(): string[] {
  const envRepos = process.env.AUTONOMOUS_TARGET_REPOS;
  if (!envRepos) {
    return DEFAULT_TARGET_REPOS;
  }
  return envRepos
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Whether a repo slug refers to the checkout this process is running inside,
 * where GitOps flows can operate on the local working tree directly.
 */
export function isLocalRepo(repo: string): boolean {
  return repo === LOCAL_REPO_SLUG || repo === path.basename(process.cwd());
}
