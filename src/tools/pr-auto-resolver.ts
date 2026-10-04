import { execFileSync } from "node:child_process";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

// ANSI color helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export interface PullRequestItem {
  number: number;
  title: string;
  author: {
    login: string;
  };
  headRefName: string;
  url: string;
}

function getAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.GH_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "";
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

function getLLMClient(): { client: OpenAI; model: string; provider: string } {
  const apiKey = process.env.GROQ_API_KEY || "dummy";
  return {
    client: new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey,
    }),
    model: "openai/gpt-oss-120b",
    provider: "GROQ",
  };
}

/**
 * Fetch all open PRs in repository
 */
export async function fetchOpenPRs(repo = "ShunyaPulse/ShunopsAI"): Promise<PullRequestItem[]> {
  try {
    // execFileSync (argv form) avoids shell interpolation of the repo name.
    const raw = execFileSync(
      "gh",
      ["pr", "list", "--repo", repo, "--state", "open", "--json", "number,title,author,headRefName,url"],
      { encoding: "utf-8", env: getAuthEnv() }
    );
    return JSON.parse(raw || "[]");
  } catch (err: any) {
    console.error(`[Error fetching PRs] ${String(err?.message || err)}`);
    return [];
  }
}

/**
 * Review a single PR with AI and decide whether to approve & merge or request changes
 */
export async function reviewAndResolvePR(pr: PullRequestItem, repo = "ShunyaPulse/ShunopsAI"): Promise<{ approved: boolean; merged: boolean; message: string }> {
  console.log(`\n${colors.cyan}${colors.bold}🔍 Reviewing PR #${pr.number}: "${pr.title}" by @${pr.author.login}${colors.reset}`);

  let diff = "";
  try {
    diff = execFileSync("gh", ["pr", "diff", String(pr.number), "--repo", repo], {
      encoding: "utf-8",
      env: getAuthEnv(),
    });
  } catch (e: any) {
    return { approved: false, merged: false, message: `Could not fetch diff: ${e.message}` };
  }

  if (!diff.trim()) {
    return { approved: false, merged: false, message: "Diff is empty" };
  }

  // Truncate diff if very large
  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + "\n... [diff truncated]" : diff;

  const { client, model, provider } = getLLMClient();

  const prompt = `You are an elite Senior Staff Security & DevOps Architect conducting an automated Pull Request Code Review for ShunopsAI repository.
PR Metadata:
- Number: #${pr.number}
- Title: ${pr.title}
- Author: @${pr.author.login}
- Head Branch: ${pr.headRefName}

PR Diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

AUDIT REQUIREMENTS:
1. Is this a legitimate, safe update (e.g. official GitHub Action version bump, security patch, bugfix)?
2. Does this introduce any malicious code, backdoors, syntax errors, or breaking changes?
3. Output ONLY a JSON object with this exact schema:
{
  "approved": boolean,
  "confidence": number,
  "rationale": "Clear, concise 1-2 sentence explanation of why this PR is approved or rejected"
}
Do NOT include any conversational filler, markdown formatting outside JSON, or reasoning tokens. ONLY the raw JSON object.`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are an automated PR reviewer. Return ONLY valid JSON with approved, confidence, and rationale fields." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    });

    const reply = res.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { approved: false, merged: false, message: `Model did not return valid JSON: ${reply.slice(0, 100)}` };
    }

    const { approved, confidence, rationale } = JSON.parse(jsonMatch[0]);
    console.log(`${colors.gray}AI Verdict: ${approved ? colors.green + "APPROVED" : colors.red + "REJECTED"} (Confidence: ${confidence}) - ${rationale}${colors.reset}`);

    const authEnv = getAuthEnv();

    if (approved) {
      // 1. Submit approval review
      try {
        execFileSync(
          "gh",
          [
            "pr", "review", String(pr.number), "--repo", repo, "--approve",
            "--body", `🤖 **ShunopsAI Autonomous Review (${provider}:${model})**: Approved. ${rationale}`,
          ],
          { stdio: "pipe", env: authEnv }
        );
        console.log(`${colors.green}✓ Approved PR #${pr.number}${colors.reset}`);
      } catch (reviewErr: any) {
        console.warn(`[Review notice] ${reviewErr.message}`);
      }

      // 2. Merge PR
      try {
        execFileSync(
          "gh",
          ["pr", "merge", String(pr.number), "--repo", repo, "--squash", "--delete-branch", "--admin"],
          { stdio: "pipe", env: authEnv }
        );
        console.log(`${colors.green}${colors.bold}🚀 Successfully Merged PR #${pr.number} & deleted branch ${pr.headRefName}!${colors.reset}`);
        return { approved: true, merged: true, message: rationale };
      } catch (mergeErr: any) {
        console.warn(`Could not direct-merge #${pr.number} (trying auto-merge): ${mergeErr.message}`);
        try {
          execFileSync(
            "gh",
            ["pr", "merge", String(pr.number), "--repo", repo, "--squash", "--auto"],
            { stdio: "pipe", env: authEnv }
          );
          return { approved: true, merged: true, message: `Auto-merge enabled: ${rationale}` };
        } catch (autoErr: any) {
          return { approved: true, merged: false, message: `Approved, but merge requires status check: ${autoErr.message}` };
        }
      }
    } else {
      // Leave comment on PR with rejection reasons
      try {
        execFileSync(
          "gh",
          [
            "pr", "comment", String(pr.number), "--repo", repo,
            "--body", `⚠️ **ShunopsAI Security Audit**: Changes not approved. ${rationale}`,
          ],
          { stdio: "pipe", env: authEnv }
        );
      } catch (commentErr: any) {
        console.error(`Comment error on #${pr.number}: ${commentErr.message}`);
      }
      return { approved: false, merged: false, message: rationale };
    }
  } catch (err: any) {
    return { approved: false, merged: false, message: `Inference failed: ${err.message}` };
  }
}

/**
 * Main autonomous runner to review and resolve all open PRs
 */
export async function runAutoPRResolver(): Promise<{ total: number; resolved: number }> {
  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🤖 ShunopsAI Autonomous Pull Request Reviewer & Resolver${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);

  const prs = await fetchOpenPRs();
  console.log(`Found ${prs.length} open Pull Requests awaiting review.`);

  if (prs.length === 0) {
    console.log(`${colors.green}All Pull Requests are already reviewed and resolved! 🎉${colors.reset}`);
    return { total: 0, resolved: 0 };
  }

  let resolved = 0;
  for (const pr of prs) {
    const res = await reviewAndResolvePR(pr);
    if (res.merged || res.approved) {
      resolved++;
    }
  }

  console.log(`\n${colors.green}${colors.bold}PR Resolution Complete: ${resolved}/${prs.length} PRs successfully reviewed and resolved!${colors.reset}`);
  return { total: prs.length, resolved };
}

// CLI handler
const isCLI = process.argv[1]?.endsWith("pr-auto-resolver.ts") || process.argv[1]?.endsWith("pr-auto-resolver.js");
if (isCLI) {
  runAutoPRResolver().then((res) => {
    process.exit(0);
  });
}
