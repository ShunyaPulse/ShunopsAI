import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubAction {
  operation:
    | "list_issues"
    | "get_issue"
    | "create_issue"
    | "create_pr"
    | "list_prs"
    | "code_scanning_alerts"
    | "list_branches"
    | "list_repos";
  repo?: string; // owner/repo
  issueNumber?: number;
  prNumber?: number;
  title?: string;
  body?: string;
  head?: string;
  base?: string;
}

type Headers = Record<string, string>;

function githubHeaders(token: string): Headers {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ShunopsAI-Autonomous-Agent",
  };
}

/** Resolve the authenticated user's login from their token. */
async function getAuthUsername(headers: Headers): Promise<string | null> {
  try {
    const userRes = await fetch("https://api.github.com/user", { headers });
    if (userRes.ok) {
      const userData: any = await userRes.json();
      return userData?.login || null;
    }
  } catch {}
  return null;
}

/**
 * Expand a bare repo name to `owner/repo` using the token's user, or fall back
 * to the most recently updated accessible repository.
 */
async function resolveTargetRepo(rawRepo: string, headers: Headers): Promise<string> {
  if (!rawRepo) {
    try {
      const reposRes = await fetch("https://api.github.com/user/repos?per_page=1&sort=updated", {
        headers,
      });
      if (reposRes.ok) {
        const reposData: any = await reposRes.json();
        if (Array.isArray(reposData) && reposData[0]?.full_name) {
          return reposData[0].full_name;
        }
      }
    } catch {}
    return rawRepo;
  }
  if (rawRepo.includes("/")) return rawRepo;
  const username = await getAuthUsername(headers);
  return username ? `${username}/${rawRepo}` : rawRepo;
}

async function apiErrorMessage(res: Response): Promise<string> {
  const errData = (await res.json().catch(() => ({}))) as any;
  return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
}

async function listRepos(headers: Headers): Promise<string> {
  const username = await getAuthUsername(headers);
  const reposRes = await fetch("https://api.github.com/user/repos?per_page=30&sort=updated", { headers });
  if (!reposRes.ok) {
    return apiErrorMessage(reposRes);
  }
  const repos = (await reposRes.json()) as any[];
  const repoList = Array.isArray(repos)
    ? repos
        .map(
          (r: any) =>
            `• ${r.full_name} (${r.private ? "private" : "public"}, default branch: ${r.default_branch})`
        )
        .join("\n")
    : "No repositories found.";
  return `Connected GitHub User: @${username || "user"}\nAccessible Repositories (${Array.isArray(repos) ? repos.length : 0}):\n${repoList}`;
}

async function listBranches(repo: string, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=30`, { headers });
  if (!res.ok) {
    return `${await apiErrorMessage(res)} for repo "${repo}". Tip: Use operation "list_repos" to see all accessible repositories.`;
  }
  const data = (await res.json()) as any;
  const branchList = Array.isArray(data)
    ? data.map((b: any) => `• ${b.name} (${b.commit?.sha?.slice(0, 7) || "unknown"})`).join("\n")
    : "No branches found.";
  return `GitHub branches for ${repo} (${Array.isArray(data) ? data.length : 0}):\n${branchList}`;
}

async function listIssues(repo: string, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=10`, { headers });
  if (!res.ok) return apiErrorMessage(res);
  const data = (await res.json()) as any;
  return Array.isArray(data)
    ? `Open issues in ${repo} (${data.length}):\n` +
        data.map((i: any) => `#${i.number} [${i.title}] by @${i.user?.login || "unknown"}`).join("\n")
    : JSON.stringify(data, null, 2);
}

async function getIssue(repo: string, issueNumber: number | undefined, headers: Headers): Promise<string> {
  if (!issueNumber) return "Error: issueNumber is required for get_issue.";
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, { headers });
  if (!res.ok) return apiErrorMessage(res);
  const data = (await res.json()) as any;
  return `Issue #${data.number}: ${data.title}\nState: ${data.state}\nAuthor: @${data.user?.login}\n\n${data.body || "(No description)"}`;
}

async function createIssue(repo: string, action: GitHubAction, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: action.title || "New Issue", body: action.body || "" }),
  });
  if (!res.ok) return apiErrorMessage(res);
  const data = (await res.json()) as any;
  return `Successfully created Issue #${data.number}: ${data.title} (${data.html_url})`;
}

async function listPullRequests(repo: string, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`, { headers });
  if (!res.ok) return apiErrorMessage(res);
  const data = (await res.json()) as any;
  return Array.isArray(data)
    ? `Open PRs in ${repo} (${data.length}):\n` +
        data
          .map(
            (p: any) =>
              `#${p.number} [${p.title}] (${p.head?.ref} -> ${p.base?.ref}) by @${p.user?.login || "unknown"}`
          )
          .join("\n")
    : JSON.stringify(data, null, 2);
}

async function createPullRequest(repo: string, action: GitHubAction, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: action.title || "Fix",
      body: action.body || "",
      head: action.head || "HEAD",
      base: action.base || "main",
    }),
  });
  if (!res.ok) return apiErrorMessage(res);
  const data = (await res.json()) as any;
  return `Successfully created PR #${data.number}: ${data.title} (${data.html_url})`;
}

async function codeScanningAlerts(repo: string, headers: Headers): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/code-scanning/alerts`, { headers });
  if (!res.ok) return apiErrorMessage(res);
  return JSON.stringify(await res.json(), null, 2);
}

/** REST dispatch table for a resolved repository. */
const REST_OPERATIONS: Record<
  GitHubAction["operation"],
  ((repo: string, action: GitHubAction, headers: Headers) => Promise<string>) | null
> = {
  list_repos: null,
  list_branches: (repo, _action, headers) => listBranches(repo, headers),
  list_issues: (repo, _action, headers) => listIssues(repo, headers),
  get_issue: (repo, action, headers) => getIssue(repo, action.issueNumber, headers),
  create_issue: (repo, action, headers) => createIssue(repo, action, headers),
  list_prs: (repo, _action, headers) => listPullRequests(repo, headers),
  create_pr: (repo, action, headers) => createPullRequest(repo, action, headers),
  code_scanning_alerts: (repo, _action, headers) => codeScanningAlerts(repo, headers),
};

/** gh / git CLI fallback for workstations where the CLI is authenticated. */
function buildGhArgv(operation: GitHubAction["operation"], repo: string, action: GitHubAction): {
  bin: "gh" | "git";
  argv: string[];
} | null {
  const repoArg = repo ? ["-R", repo] : [];
  switch (operation) {
    case "list_issues":
      return { bin: "gh", argv: ["issue", "list", ...repoArg, "--limit", "10"] };
    case "get_issue":
      return { bin: "gh", argv: ["issue", "view", String(action.issueNumber ?? ""), ...repoArg] };
    case "create_issue":
      return {
        bin: "gh",
        argv: ["issue", "create", ...repoArg, "--title", action.title || "Bug", "--body", action.body || ""],
      };
    case "list_prs":
      return { bin: "gh", argv: ["pr", "list", ...repoArg, "--limit", "10"] };
    case "create_pr":
      return {
        bin: "gh",
        argv: [
          "pr", "create", ...repoArg,
          "--title", action.title || "Fix",
          "--body", action.body || "",
          "--base", action.base || "main",
          "--head", action.head || "HEAD",
        ],
      };
    case "code_scanning_alerts":
      return {
        bin: "gh",
        argv: ["api", "-H", "Accept: application/vnd.github+json", `/repos/${repo}/code-scanning/alerts`],
      };
    case "list_branches":
      return { bin: "git", argv: ["branch", "-a"] };
    default:
      return null;
  }
}

/**
 * GitHub operations tool (issues, pull requests, code scanning alerts, branches).
 * Uses the REST API when a token is available, so it works in a bare container
 * without the gh CLI or a checkout.
 */
export async function manageGitHub(
  action: GitHubAction,
  /** Per-user token. When present it is the ONLY identity used, never the operator's. */
  opts: { token?: string } = {}
): Promise<string> {
  const token = opts.token || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  const rawRepo = (action.repo || "").trim();
  let targetRepo = rawRepo;

  if (token) {
    try {
      const headers = githubHeaders(token);
      targetRepo = await resolveTargetRepo(rawRepo, headers);

      if (action.operation === "list_repos") {
        return await listRepos(headers);
      }

      const operation = REST_OPERATIONS[action.operation];
      if (operation) {
        return await operation(targetRepo, action, headers);
      }
    } catch (apiErr: any) {
      return `GitHub REST API Error: ${apiErr.message}`;
    }
  }

  try {
    const invocation = buildGhArgv(action.operation, targetRepo, action);
    if (invocation) {
      const { stdout, stderr } = await execFileAsync(invocation.bin, invocation.argv, {
        env: {
          ...process.env,
          GITHUB_TOKEN: token || process.env.GITHUB_TOKEN,
          ...(opts.token ? { GH_TOKEN: opts.token } : {}),
        },
      });
      return stdout || stderr || `GitHub action '${action.operation}' completed.`;
    }
  } catch (cliErr: any) {
    return `GitHub Operation Error: ${cliErr.message}. Ensure GitHub token is connected in Account Settings → Platform Connections.`;
  }

  return "Unsupported GitHub operation.";
}
