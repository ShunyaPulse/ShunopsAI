import { execFileSync } from "node:child_process";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import {
  DEFAULT_PROPOSER,
  DEFAULT_AUDITOR,
  BACKUP_OPENROUTER_PROPOSER,
  BACKUP_GROQ_AUDITOR,
  callModel,
} from "../ai/consensus.js";

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

  console.log(`${colors.cyan}🤝 Initiating Dual-Model Consensus Review for PR #${pr.number}...${colors.reset}`);

  try {
    // -------------------------------------------------------------
    // Round 1: Model 1 (Gemini 2.5 Flash) — Lead Architectural Review
    // -------------------------------------------------------------
    console.log(`${colors.gray}🧠 [Round 1/2] Proposer (${DEFAULT_PROPOSER.name}) analyzing diff...${colors.reset}`);
    const m1Messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are Model 1 (Lead Proposer & Code Architect) in ShunopsAI's Dual-Model Consensus Review.
Evaluate this PR diff for security, correctness, and functional integrity.
Return ONLY valid JSON with this schema:
{
  "approved": boolean,
  "confidence": number,
  "riskLevel": "low" | "medium" | "high",
  "rationale": "Concise 1-2 sentence explanation"
}
Do NOT return conversational filler or codeblocks outside the JSON.`,
      },
      {
        role: "user",
        content: `PR #${pr.number}: "${pr.title}" by @${pr.author.login}\nBranch: ${pr.headRefName}\n\nDiff:\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
      },
    ];

    const m1Response = await callModel(DEFAULT_PROPOSER, m1Messages, BACKUP_OPENROUTER_PROPOSER, 0.1);
    const m1Match = m1Response.text.match(/\{[\s\S]*\}/);
    if (!m1Match) {
      return { approved: false, merged: false, message: `Model 1 did not return valid JSON: ${m1Response.text.slice(0, 100)}` };
    }
    const m1Decision = JSON.parse(m1Match[0]);
    console.log(`${colors.gray}Model 1 Verdict: ${m1Decision.approved ? colors.green + "APPROVED" : colors.red + "REJECTED"} (Risk: ${m1Decision.riskLevel}) - ${m1Decision.rationale}${colors.reset}`);

    // -------------------------------------------------------------
    // Round 2: Model 2 (Groq GPT-OSS 120B) — Security Audit & Cross-Examination
    // -------------------------------------------------------------
    console.log(`${colors.gray}🕵️ [Round 2/2] Auditor (${DEFAULT_AUDITOR.name}) cross-examining review...${colors.reset}`);
    const m2Messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are Model 2 (Senior Security Auditor & Critic) in ShunopsAI's Dual-Model Consensus Protocol.
Audit Model 1's proposal and the PR diff. Check for hidden vulnerabilities, unredacted secrets/logs, command injection, breaking changes, or backdoors.
Return ONLY valid JSON with this schema:
{
  "agreedWithModel1": boolean,
  "finalApproved": boolean,
  "auditorCritique": "Concise 1-2 sentence audit findings"
}
Do NOT return conversational filler or codeblocks outside the JSON.`,
      },
      {
        role: "user",
        content: `PR #${pr.number}: "${pr.title}"\nDiff:\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\nModel 1 Review:\n${JSON.stringify(m1Decision, null, 2)}`,
      },
    ];

    const m2Response = await callModel(DEFAULT_AUDITOR, m2Messages, BACKUP_GROQ_AUDITOR, 0.1);
    const m2Match = m2Response.text.match(/\{[\s\S]*\}/);
    if (!m2Match) {
      return { approved: false, merged: false, message: `Model 2 did not return valid JSON: ${m2Response.text.slice(0, 100)}` };
    }
    const m2Decision = JSON.parse(m2Match[0]);
    console.log(`${colors.gray}Model 2 Verdict: ${m2Decision.finalApproved ? colors.green + "APPROVED" : colors.red + "REJECTED"} (Agreement: ${m2Decision.agreedWithModel1}) - ${m2Decision.auditorCritique}${colors.reset}`);

    // Consensus evaluation: both models must approve
    const approved = Boolean(m1Decision.approved && m2Decision.finalApproved);
    const consensusRationale = `Model 1 (${m1Response.modelName}): ${m1Decision.rationale} | Model 2 (${m2Response.modelName}): ${m2Decision.auditorCritique}`;

    const authEnv = getAuthEnv();

    if (approved) {
      // 1. Submit approval review with dual signatures
      try {
        execFileSync(
          "gh",
          [
            "pr", "review", String(pr.number), "--repo", repo, "--approve",
            "--body", `🤝 **ShunopsAI Dual-Model Consensus Review (Unanimously Approved)**\n\n- **Model 1 (${m1Response.modelName})**: ${m1Decision.rationale} *(Risk: ${m1Decision.riskLevel})*\n- **Model 2 (${m2Response.modelName})**: ${m2Decision.auditorCritique}`,
          ],
          { stdio: "pipe", env: authEnv }
        );
        console.log(`${colors.green}✓ Approved PR #${pr.number} with Dual-Model Consensus!${colors.reset}`);
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
        return { approved: true, merged: true, message: consensusRationale };
      } catch (mergeErr: any) {
        console.warn(`Could not direct-merge #${pr.number} (trying auto-merge): ${mergeErr.message}`);
        try {
          execFileSync(
            "gh",
            ["pr", "merge", String(pr.number), "--repo", repo, "--squash", "--auto"],
            { stdio: "pipe", env: authEnv }
          );
          return { approved: true, merged: true, message: `Auto-merge enabled: ${consensusRationale}` };
        } catch (autoErr: any) {
          return { approved: true, merged: false, message: `Approved, but merge requires status check: ${autoErr.message}` };
        }
      }
    } else {
      // Leave comment on PR with consensus rejection reasons
      try {
        execFileSync(
          "gh",
          [
            "pr", "comment", String(pr.number), "--repo", repo,
            "--body", `⚠️ **ShunopsAI Dual-Model Security Audit (Changes Required)**\n\n- **Model 1 (${m1Response.modelName})**: ${m1Decision.rationale}\n- **Model 2 (${m2Response.modelName})**: ${m2Decision.auditorCritique}`,
          ],
          { stdio: "pipe", env: authEnv }
        );
      } catch (commentErr: any) {
        console.error(`Comment error on #${pr.number}: ${commentErr.message}`);
      }
      return { approved: false, merged: false, message: consensusRationale };
    }
  } catch (err: any) {
    return { approved: false, merged: false, message: `Consensus inference failed: ${err.message}` };
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
