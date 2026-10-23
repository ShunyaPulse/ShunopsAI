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

/**
 * Extract target repository from a text query, prompt, or repo argument.
 * Matches explicit 'owner/repo' slugs or searches for known repo names (e.g. 'shunopsai', 'saralgati', 'kanban-cloud').
 * Defaults to LOCAL_REPO_SLUG if no specific target repository is identified.
 */
export function extractTargetRepo(query?: string): string {
  if (!query || typeof query !== "string") {
    return LOCAL_REPO_SLUG;
  }
  const clean = query.trim();

  // 1. Explicit owner/repo pattern (e.g. ShunyaPulse/SaralGati or user/repo)
  const fullSlugMatch = clean.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  if (fullSlugMatch && fullSlugMatch[1]) {
    const targetRepos = getTargetReposList();
    const found = targetRepos.find((r) => r.toLowerCase() === fullSlugMatch[1]!.toLowerCase());
    return found || fullSlugMatch[1];
  }

  // 2. Base repo name match across known target fleet (e.g. 'saralgati', 'kanban-cloud', 'shunopsai')
  const targetRepos = getTargetReposList();
  for (const repo of targetRepos) {
    const baseName = repo.split("/")[1] || repo;
    const re = new RegExp(`\\b${baseName.replace(/[^a-zA-Z0-9_-]/g, "")}\\b`, "i");
    if (re.test(clean)) {
      return repo;
    }
  }

  return LOCAL_REPO_SLUG;
}
