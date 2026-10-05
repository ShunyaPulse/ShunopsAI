/**
 * GitHub authentication helpers shared by every component that shells out to
 * the `gh` CLI (PR resolver, code-scanning resolver, agents).
 */

/**
 * Resolve the first configured GitHub token from the supported environment
 * variables and return an environment object that exposes it as both
 * `GH_TOKEN` and `GITHUB_TOKEN` (what the `gh` CLI expects).
 */
export function getGitHubAuthEnv(): NodeJS.ProcessEnv {
  const token =
    process.env.GH_TOKEN ||
    process.env.GH_PAT ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    "";
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

/**
 * The raw GitHub token (may be empty when none is configured).
 */
export function getGitHubToken(): string {
  return (
    process.env.GH_TOKEN ||
    process.env.GH_PAT ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    ""
  );
}
