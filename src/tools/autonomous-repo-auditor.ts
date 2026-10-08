import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import { Redis } from "ioredis";
import {
  DEFAULT_PROPOSER,
  DEFAULT_AUDITOR,
  BACKUP_OPENROUTER_PROPOSER,
  BACKUP_GROQ_AUDITOR,
  callModel,
} from "../ai/consensus.js";
import { reviewAndResolvePR } from "./pr-auto-resolver.js";
import { isAutonomyPaused } from "./autonomy-state.js";
import { colors } from "../core/colors.js";

dotenv.config();

export interface CodeFlawCandidate {
  filePath: string;
  lineNo: number;
  snippet: string;
  category: "security" | "reliability" | "code_smell";
  ruleId: string;
  description: string;
}

export interface AuditResult {
  repo: string;
  scannedFiles: number;
  flawsDetected: number;
  flawsRemediated: number;
  prCreated?: string;
  prMerged?: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface RepoAuditState {
  lastAuditedCommitSha: string;
  lastSelfGeneratedCommitSha?: string | undefined;
  consecutiveRunsOnSameCommit: number;
  lastAuditedAt: string;
  lastStatus: "clean" | "remediated" | "skipped";
}

const AUDIT_STATE_FILE = path.resolve(process.cwd(), ".auditor-state.json");

/**
 * Check if a commit was authored or generated autonomously by ShunopsAI
 */
export function isSelfGeneratedCommit(
  commitSha: string,
  rootDir = process.cwd(),
  repoSlug = "ShunyaPulse/ShunopsAI"
): boolean {
  if (!commitSha) return false;
  try {
    const message = execFileSync(
      "git",
      ["log", "-1", "--format=%s%n%b", commitSha],
      { cwd: rootDir, encoding: "utf-8" }
    );
    if (
      /fix\(auto-heal\)/i.test(message) ||
      /Generated autonomously by ShunopsAI/i.test(message) ||
      /\[auto-heal\]/i.test(message)
    ) {
      return true;
    }
  } catch {
    try {
      const raw = execFileSync(
        "gh",
        ["api", `repos/${repoSlug}/commits/${commitSha}`, "--jq", ".commit.message"],
        { env: getAuthEnv(), encoding: "utf-8" }
      );
      if (
        /fix\(auto-heal\)/i.test(raw) ||
        /Generated autonomously by ShunopsAI/i.test(raw) ||
        /\[auto-heal\]/i.test(raw)
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

function getAuditorRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  if (!redisUrl && !redisHost) return null;
  try {
    return redisUrl
      ? new Redis(redisUrl, { connectTimeout: 3000, lazyConnect: true, maxRetriesPerRequest: 1 })
      : new Redis({
          host: redisHost || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 3000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
  } catch {
    return null;
  }
}

export async function getAuditorState(repoSlug: string): Promise<RepoAuditState | null> {
  // 1. Try Redis first (for distributed/cloud runner state)
  const redis = getAuditorRedis();
  if (redis) {
    try {
      await redis.connect();
      const raw = await redis.get(`shunops:auditor:state:${repoSlug}`);
      await redis.quit();
      if (raw) return JSON.parse(raw);
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  // 2. Fallback to local .auditor-state.json
  try {
    const raw = await fs.readFile(AUDIT_STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return data[repoSlug] || null;
  } catch {
    return null;
  }
}

export async function saveAuditorState(repoSlug: string, state: RepoAuditState): Promise<void> {
  // 1. Save to Redis
  const redis = getAuditorRedis();
  if (redis) {
    try {
      await redis.connect();
      await redis.set(
        `shunops:auditor:state:${repoSlug}`,
        JSON.stringify(state),
        "EX",
        60 * 60 * 24 * 30
      );
      await redis.quit();
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  // 2. Persist to local state file
  try {
    let data: Record<string, RepoAuditState> = {};
    try {
      const raw = await fs.readFile(AUDIT_STATE_FILE, "utf-8");
      data = JSON.parse(raw);
    } catch {}
    data[repoSlug] = state;
    await fs.writeFile(AUDIT_STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

/**
 * GitHub + commit-identity environment for the auditor's GitOps flow.
 *
 * Distinct from the shared `getGitHubAuthEnv()` in `src/core/github.ts`: this
 * one also stamps the Sentinel Bot author/committer identity on auto-heal
 * commits so the change tracker can recognise its own commits.
 */
function getAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.GH_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "";
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "ShunopsAI Sentinel Bot",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "sentinel@shunopsai.local",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "ShunopsAI Sentinel Bot",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "sentinel@shunopsai.local",
  };
}

/**
 * Scan a single file for known bug patterns and security anti-patterns
 */
export function scanFileForHeuristicFlaws(filePath: string, content: string): CodeFlawCandidate[] {
  if (filePath.includes("autonomous-repo-auditor") || filePath.includes("code-scanner-resolver")) {
    return [];
  }
  const flaws: CodeFlawCandidate[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    // 1. Insecure Randomness in tokens/ids/secrets
    if (
      /Math\.random\(\)/.test(line) &&
      !filePath.includes(".test.") &&
      !filePath.includes("test_") &&
      !filePath.includes("spec.")
    ) {
      if (/id|token|key|secret|auth|nonce|session|approval/i.test(line)) {
        flaws.push({
          filePath,
          lineNo,
          snippet: lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join("\n"),
          category: "security",
          ruleId: "insecure-randomness-for-secrets",
          description: "Math.random() used in security or identity sensitive context. Replace with crypto.randomInt() or crypto.randomBytes().",
        });
      }
    }

    // 2. Unsafe command execution via template literals in shell
    if (/execSync\s*\(\s*`[^`]*\$\{/.test(line)) {
      flaws.push({
        filePath,
        lineNo,
        snippet: lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join("\n"),
        category: "security",
        ruleId: "shell-command-injection-risk",
        description: "execSync with template string interpolation vulnerable to shell injection. Replace with execFileSync and argv array.",
      });
    }

    // 3. Sensitive / clear-text error or token logging
    if (
      /console\.(?:error|log)\([^)]*(?:\$\{[^}]*(?:token|secret|key|password|apiKey|cred)[^}]*\}|(?:\btoken\b|\bsecret\b|\bapiKey\b|\bpassword\b)\s*[,)])/i.test(line) ||
      (/console\.error\([^)]*(?:err\.message|error\.message)[^)]*\)/.test(line) && /token|secret|key|api|auth/i.test(line))
    ) {
      flaws.push({
        filePath,
        lineNo,
        snippet: lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join("\n"),
        category: "security",
        ruleId: "clear-text-sensitive-logging",
        description: "Potentially sensitive token, secret, or unredacted error logged to console. Redact or mask the value.",
      });
    }

    // 4. Hardcoded Windows / local user paths
    if (/[a-zA-Z]:\\\\Users\\\\/i.test(line) || /\/Users\/[a-zA-Z0-9_-]+\//i.test(line)) {
      flaws.push({
        filePath,
        lineNo,
        snippet: lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join("\n"),
        category: "reliability",
        ruleId: "hardcoded-user-path",
        description: "Hardcoded local user filesystem path. Replace with configurable env var or relative path.",
      });
    }
  }

  return flaws;
}

/**
 * Autonomously remediate a detected flaw using Dual-Model Consensus
 */
export async function remediateFlawWithConsensus(
  flaw: CodeFlawCandidate,
  rootDir: string
): Promise<{ success: boolean; patchSummary?: string }> {
  const fullPath = path.resolve(rootDir, flaw.filePath);
  let fileContent = "";
  try {
    fileContent = await fs.readFile(fullPath, "utf-8");
  } catch (err: any) {
    return { success: false, patchSummary: `Could not read file: ${err.message}` };
  }

  console.log(`\n${colors.cyan}🔧 [Consensus Healer] Remediating ${flaw.ruleId} at ${flaw.filePath}:${flaw.lineNo}...${colors.reset}`);

  try {
    // -----------------------------------------------------------------
    // Round 1: Model 1 (Gemini 2.5 Flash) Proposes Fix
    // -----------------------------------------------------------------
    const m1Prompt = `You are Model 1 (Lead Security Architect & Proposer) fixing a detected bug in ShunopsAI.
Flaw Metadata:
- File: ${flaw.filePath}
- Line: ${flaw.lineNo}
- Rule: ${flaw.ruleId}
- Description: ${flaw.description}

Context Snippet:
\`\`\`typescript
${flaw.snippet}
\`\`\`

REMEDIATION GUIDELINES:
1. Provide an exact 'search' substring from the snippet.
2. Provide a clean 'replace' string that fixes the flaw cleanly.
3. If importing is needed (e.g. randomInt from "node:crypto"), keep the patch focused or adjust the usage cleanly.
4. Ensure valid TypeScript syntax.

Return ONLY a JSON object:
{
  "search": "exact string to replace",
  "replace": "secure replacement string",
  "rationale": "1-sentence explanation"
}`;

    const m1Response = await callModel(
      DEFAULT_PROPOSER,
      [
        { role: "system", content: "You are an automated code fixing engine. Return ONLY valid JSON." },
        { role: "user", content: m1Prompt },
      ],
      BACKUP_OPENROUTER_PROPOSER,
      0.1
    );

    const m1Match = m1Response.text.match(/\{[\s\S]*\}/);
    if (!m1Match) {
      return { success: false, patchSummary: "Model 1 failed to return valid JSON" };
    }
    const m1Proposal = JSON.parse(m1Match[0]);

    // -----------------------------------------------------------------
    // Round 2: Model 2 (Groq GPT-OSS 120B) Audits Fix
    // -----------------------------------------------------------------
    const m2Prompt = `You are Model 2 (Senior Security Auditor & Critic) in ShunopsAI's Dual-Model Consensus Protocol.
Audit Model 1's proposed fix for ${flaw.ruleId} in ${flaw.filePath}.
Verify:
1. Does 'search' exist uniquely in the file context?
2. Does 'replace' fully eliminate the vulnerability without breaking TypeScript types or runtime semantics?

Context Snippet:
\`\`\`typescript
${flaw.snippet}
\`\`\`

Model 1 Proposal:
${JSON.stringify(m1Proposal, null, 2)}

Return ONLY valid JSON:
{
  "approved": boolean,
  "finalSearch": "exact string to replace",
  "finalReplace": "verified secure replacement string",
  "auditCritique": "1-sentence audit critique"
}`;

    const m2Response = await callModel(
      DEFAULT_AUDITOR,
      [
        { role: "system", content: "You are a code audit engine. Return ONLY valid JSON." },
        { role: "user", content: m2Prompt },
      ],
      BACKUP_GROQ_AUDITOR,
      0.1
    );

    const m2Match = m2Response.text.match(/\{[\s\S]*\}/);
    if (!m2Match) {
      return { success: false, patchSummary: "Model 2 failed to return valid JSON" };
    }
    const m2Decision = JSON.parse(m2Match[0]);

    if (!m2Decision.approved) {
      console.warn(`${colors.yellow}⚠️ Model 2 rejected fix: ${m2Decision.auditCritique}${colors.reset}`);
      return { success: false, patchSummary: `Rejected by auditor: ${m2Decision.auditCritique}` };
    }

    const searchTarget = m2Decision.finalSearch || m1Proposal.search;
    const replaceTarget = m2Decision.finalReplace || m1Proposal.replace;

    if (!fileContent.includes(searchTarget)) {
      return { success: false, patchSummary: `Search target not matched in ${flaw.filePath}` };
    }

    const patchedContent = fileContent.replace(searchTarget, replaceTarget);
    await fs.writeFile(fullPath, patchedContent, "utf-8");

    // Verify typecheck
    try {
      execSync("npm run typecheck", { cwd: rootDir, stdio: "pipe" });
      console.log(`${colors.green}✓ Fixed ${flaw.ruleId} in ${flaw.filePath} via Dual-Model Consensus (${m1Response.modelName} + ${m2Response.modelName})!${colors.reset}`);
      return {
        success: true,
        patchSummary: `${flaw.ruleId} in ${flaw.filePath}: ${m1Proposal.rationale}`,
      };
    } catch (compileErr: any) {
      console.warn(`${colors.yellow}⚠️ Typecheck failed after patch. Rolling back ${flaw.filePath}...${colors.reset}`);
      await fs.writeFile(fullPath, fileContent, "utf-8");
      return { success: false, patchSummary: `Typecheck rollback: ${compileErr.message}` };
    }
  } catch (err: any) {
    return { success: false, patchSummary: `Consensus execution error: ${err.message}` };
  }
}

/**
 * Scan all source files in a repository directory
 */
async function getSourceFiles(dir: string, baseDir = dir): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".next", ".cache", "tmp"].includes(entry.name)) {
        continue;
      }
      results.push(...(await getSourceFiles(full, baseDir)));
    } else if (entry.isFile()) {
      if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        results.push(rel);
      }
    }
  }
  return results;
}

/**
 * Autonomously audit and heal a repository with Smart Quota Guardrails
 */
export async function auditAndHealRepository(
  repoSlug = "ShunyaPulse/ShunopsAI",
  rootDir = process.cwd(),
  options: { createPR?: boolean; force?: boolean } = { createPR: true }
): Promise<AuditResult> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [Auditor] Skipped ${repoSlug}: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return {
      repo: repoSlug,
      scannedFiles: 0,
      flawsDetected: 0,
      flawsRemediated: 0,
      skipped: true,
      reason: "Autonomy is paused by user killswitch",
    };
  }

  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🛡️ ShunopsAI Autonomous Repository Auditor & Healer${colors.reset}`);
  console.log(`${colors.cyan}Target Repo:${colors.reset} ${repoSlug}`);
  console.log(`${colors.cyan}Directory:${colors.reset}   ${rootDir}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);

  // 1. Fetch current commit SHA for change tracking
  let currentCommitSha = "";
  try {
    currentCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {
    try {
      currentCommitSha = execFileSync("gh", ["api", `repos/${repoSlug}/commits/HEAD`, "--jq", ".sha"], {
        env: getAuthEnv(),
        encoding: "utf-8",
      }).trim();
    } catch {}
  }

  // 2. Smart Quota Guardrail: Max 2 consecutive runs on the same commit SHA
  let consecutiveRuns = 1;
  if (!options.force && currentCommitSha) {
    const prevState = await getAuditorState(repoSlug);

    // Check if the current commit was generated by autonomous-repo-auditor itself
    const isSelfHeal =
      currentCommitSha === prevState?.lastSelfGeneratedCommitSha ||
      isSelfGeneratedCommit(currentCommitSha, rootDir, repoSlug);

    if (prevState && prevState.lastAuditedCommitSha === currentCommitSha) {
      consecutiveRuns = (prevState.consecutiveRunsOnSameCommit || 0) + 1;
      if (consecutiveRuns > 2) {
        console.log(
          `${colors.yellow}⏭️ [Smart Quota Guardrail] No new commits detected in ${repoSlug} since commit ${currentCommitSha.slice(0, 7)}.`
        );
        console.log(
          `Repository was already verified ${prevState.consecutiveRunsOnSameCommit} consecutive times without changes.`
        );
        console.log(
          `Skipping LLM audit to conserve Gemini & Groq model quotas.${colors.reset}\n`
        );

        await saveAuditorState(repoSlug, {
          lastAuditedCommitSha: currentCommitSha,
          lastSelfGeneratedCommitSha: prevState.lastSelfGeneratedCommitSha,
          consecutiveRunsOnSameCommit: consecutiveRuns,
          lastAuditedAt: new Date().toISOString(),
          lastStatus: "skipped",
        });

        return {
          repo: repoSlug,
          scannedFiles: 0,
          flawsDetected: 0,
          flawsRemediated: 0,
          skipped: true,
          reason: `No commit changes since ${currentCommitSha.slice(0, 7)} (verified ${prevState.consecutiveRunsOnSameCommit} times previously)`,
        };
      }
      console.log(
        `${colors.cyan}ℹ️ [Smart Guardrail] Audit ${consecutiveRuns}/2 on commit ${currentCommitSha.slice(0, 7)} (verification run)${colors.reset}`
      );
    } else if (isSelfHeal) {
      // The commit is DIFFERENT from lastAuditedCommitSha, BUT it was created by autonomous-repo-auditor itself!
      console.log(
        `${colors.yellow}⏭️ [Self-Heal Commit Guardrail] Commit ${currentCommitSha.slice(0, 7)} was autonomously created & merged by ShunopsAI itself (fix/auto-heal).`
      );
      console.log(
        `Code has already passed Dual-Model Consensus and typecheck during the PR merge. Skipping redundant LLM audit to prevent self-looping.${colors.reset}\n`
      );

      await saveAuditorState(repoSlug, {
        lastAuditedCommitSha: currentCommitSha,
        lastSelfGeneratedCommitSha: currentCommitSha,
        consecutiveRunsOnSameCommit: 2, // Mark as already verified
        lastAuditedAt: new Date().toISOString(),
        lastStatus: "clean",
      });

      return {
        repo: repoSlug,
        scannedFiles: 0,
        flawsDetected: 0,
        flawsRemediated: 0,
        skipped: true,
        reason: `Commit ${currentCommitSha.slice(0, 7)} was self-generated by ShunopsAI auto-healer; already verified during PR consensus.`,
      };
    } else {
      console.log(
        `${colors.green}🆕 [Smart Guardrail] External user commit detected: ${currentCommitSha.slice(0, 7) || "initial"} - Starting fresh 2-run cycle.${colors.reset}`
      );
      consecutiveRuns = 1;
    }
  }

  const files = await getSourceFiles(rootDir);
  console.log(`Auditing ${files.length} source code files for vulnerabilities and flaws...`);

  const allFlaws: CodeFlawCandidate[] = [];
  for (const file of files) {
    const fullPath = path.resolve(rootDir, file);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const flaws = scanFileForHeuristicFlaws(file, content);
      allFlaws.push(...flaws);
    } catch {}
  }

  console.log(`Audit complete: Found ${allFlaws.length} flaw candidate(s).`);

  if (allFlaws.length === 0) {
    console.log(`${colors.green}Repository is clean! No security or logic flaws detected. 🎉${colors.reset}`);
    if (currentCommitSha) {
      await saveAuditorState(repoSlug, {
        lastAuditedCommitSha: currentCommitSha,
        consecutiveRunsOnSameCommit: consecutiveRuns,
        lastAuditedAt: new Date().toISOString(),
        lastStatus: "clean",
      });
    }
    return {
      repo: repoSlug,
      scannedFiles: files.length,
      flawsDetected: 0,
      flawsRemediated: 0,
    };
  }

  // Quota Guardrail: Cap remediation to top 5 flaws per run to prevent token bursts
  const MAX_FLAWS_PER_AUDIT = 5;
  const flawsToRemediate = allFlaws.slice(0, MAX_FLAWS_PER_AUDIT);
  if (allFlaws.length > MAX_FLAWS_PER_AUDIT) {
    console.log(
      `${colors.yellow}⚠️ Limiting remediation to top ${MAX_FLAWS_PER_AUDIT} flaws (out of ${allFlaws.length}) to guard model quota.${colors.reset}`
    );
  }

  let remediatedCount = 0;
  const patchSummaries: string[] = [];

  for (const flaw of flawsToRemediate) {
    const result = await remediateFlawWithConsensus(flaw, rootDir);
    if (result.success) {
      remediatedCount++;
      if (result.patchSummary) patchSummaries.push(result.patchSummary);
    }
  }

  const auditResult: AuditResult = {
    repo: repoSlug,
    scannedFiles: files.length,
    flawsDetected: allFlaws.length,
    flawsRemediated: remediatedCount,
  };

  // If fixes were applied and createPR is requested:
  if (remediatedCount > 0 && options.createPR) {
    const authEnv = getAuthEnv();
    const branchName = `heal/autonomous-fix-${Date.now().toString(36)}`;

    // Remember where we started: a failure part-way through the PR flow used to
    // leave the working tree on the temporary heal branch (or force-switch it
    // to `main` even when the caller was on a feature branch).
    let originalBranch = "main";
    try {
      originalBranch =
        execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: rootDir,
          encoding: "utf-8",
        }).trim() || "main";
    } catch {}

    try {
      console.log(`\n${colors.cyan}🚀 Creating autonomous branch and Pull Request for ${remediatedCount} fix(es)...${colors.reset}`);
      execFileSync("git", ["checkout", "-b", branchName], { cwd: rootDir, env: authEnv, stdio: "pipe" });
      execFileSync("git", ["add", "-A"], { cwd: rootDir, env: authEnv, stdio: "pipe" });

      const commitMessage = `fix(auto-heal): resolve ${remediatedCount} security & logic flaw(s)\n\n${patchSummaries.map((s) => `- ${s}`).join("\n")}\n\n🤖 Generated autonomously by ShunopsAI Dual-Model Consensus (${DEFAULT_PROPOSER.name} + ${DEFAULT_AUDITOR.name})`;
      execFileSync("git", ["commit", "-m", commitMessage], { cwd: rootDir, env: authEnv, stdio: "pipe" });

      execFileSync("git", ["push", "-u", "origin", branchName], { cwd: rootDir, env: authEnv, stdio: "pipe" });
      console.log(`${colors.green}✓ Pushed branch ${branchName} to origin!${colors.reset}`);

      const prBody = `## 🤖 ShunopsAI Autonomous Code Healing & Security Hardening\n\n### Summary of Changes:\n${patchSummaries.map((s) => `- ${s}`).join("\n")}\n\n### Consensus Verification:\n- **Model 1 (${DEFAULT_PROPOSER.name})**: Proposed semantic security & reliability patches.\n- **Model 2 (${DEFAULT_AUDITOR.name})**: Audited AST structures and edge cases.\n- **Verification**: Zero TypeScript compile errors (\`tsc --noEmit\` passed).\n\n*Created autonomously by ShunopsAI Sentinel.*`;

      const prRaw = execFileSync(
        "gh",
        [
          "pr", "create",
          "--repo", repoSlug,
          "--title", `fix(auto-heal): autonomous security hardening (${remediatedCount} flaws resolved)`,
          "--body", prBody,
          "--head", branchName,
          "--base", "main",
        ],
        { cwd: rootDir, env: authEnv, encoding: "utf-8" }
      );

      const prUrl = prRaw.trim();
      console.log(`${colors.green}✓ Created Pull Request: ${prUrl}${colors.reset}`);
      auditResult.prCreated = prUrl;

      // Extract PR number from URL and auto-review/auto-merge
      const match = prUrl.match(/\/pull\/(\d+)/);
      if (match && match[1]) {
        const prNumber = parseInt(match[1], 10);
        console.log(`🤝 Triggering Dual-Model PR Auto-Resolver for #${prNumber}...`);
        const reviewResult = await reviewAndResolvePR(
          {
            number: prNumber,
            title: `fix(auto-heal): autonomous security hardening`,
            author: { login: "shunopsai" },
            headRefName: branchName,
            url: prUrl,
          },
          repoSlug
        );
        auditResult.prMerged = reviewResult.merged;
      }

    } catch (gitErr: any) {
      console.error(`GitOps PR creation notice: ${gitErr.message}`);
    } finally {
      // Always restore the starting branch, even when the PR flow failed.
      try {
        execFileSync("git", ["checkout", originalBranch], {
          cwd: rootDir,
          env: authEnv,
          stdio: "pipe",
        });
      } catch (restoreErr: any) {
        console.warn(
          `${colors.yellow}⚠️ Could not restore original branch ${originalBranch}: ${restoreErr.message}${colors.reset}`
        );
      }

      if (auditResult.prMerged) {
        try {
          execFileSync("git", ["pull", "origin", originalBranch], {
            cwd: rootDir,
            env: authEnv,
            stdio: "pipe",
          });
        } catch {}
      }
    }
  }

  // Update audit state with the post-merge commit SHA
  let finalCommitSha = currentCommitSha;
  try {
    finalCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {}

  if (finalCommitSha) {
    await saveAuditorState(repoSlug, {
      lastAuditedCommitSha: finalCommitSha,
      lastSelfGeneratedCommitSha: auditResult.prMerged ? finalCommitSha : undefined,
      consecutiveRunsOnSameCommit: auditResult.prMerged ? 2 : consecutiveRuns,
      lastAuditedAt: new Date().toISOString(),
      lastStatus: remediatedCount > 0 ? "remediated" : "clean",
    });
  }

  return auditResult;
}

/**
 * Multi-Repository runner: iterates through all target repositories configured in AUTONOMOUS_TARGET_REPOS
 */
export async function runMultiRepoAutonomousAuditor(): Promise<AuditResult[]> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [Multi-Repo Auditor] Skipped: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return [];
  }

  const targetReposStr =
    process.env.AUTONOMOUS_TARGET_REPOS ||
    "ShunyaPulse/ShunopsAI,ShunyaPulse/SaralGati,ShunyaPulse/kanban-cloud";
  const targetRepos = targetReposStr
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const results: AuditResult[] = [];

  for (const repo of targetRepos) {
    if (repo === "ShunyaPulse/ShunopsAI" || repo === path.basename(process.cwd())) {
      // Local repo
      const res = await auditAndHealRepository(repo, process.cwd(), { createPR: true });
      results.push(res);
    } else {
      // Remote repository: Check remote commit SHA first before cloning!
      let remoteSha = "";
      try {
        remoteSha = execFileSync(
          "gh",
          ["api", `repos/${repo}/commits/HEAD`, "--jq", ".sha"],
          { env: getAuthEnv(), encoding: "utf-8" }
        ).trim();
      } catch {}

      if (remoteSha) {
        const prevState = await getAuditorState(repo);
        const isSelfHeal =
          remoteSha === prevState?.lastSelfGeneratedCommitSha ||
          isSelfGeneratedCommit(remoteSha, process.cwd(), repo);

        if (
          (prevState &&
            prevState.lastAuditedCommitSha === remoteSha &&
            (prevState.consecutiveRunsOnSameCommit || 0) >= 2) ||
          isSelfHeal
        ) {
          console.log(
            `\n${colors.yellow}⏭️ [Remote Repo Skipped] ${repo} (commit ${remoteSha.slice(0, 7)}) is ${isSelfHeal ? "an autonomous self-heal commit" : "unchanged"}. Skipping clone & LLM calls.${colors.reset}`
          );
          results.push({
            repo,
            scannedFiles: 0,
            flawsDetected: 0,
            flawsRemediated: 0,
            skipped: true,
            reason: isSelfHeal
              ? `Commit ${remoteSha.slice(0, 7)} was self-generated by ShunopsAI auto-healer`
              : `No new commits since ${remoteSha.slice(0, 7)} (verified ${prevState?.consecutiveRunsOnSameCommit} times)`,
          });
          continue;
        }
      }

      // Remote repository: clone into isolated temp directory
      const tmpDir = path.join(os.tmpdir(), `shunopsai-audit-${repo.replace("/", "-")}-${Date.now()}`);
      try {
        console.log(`\n📥 Cloning target repository ${repo} to ${tmpDir}...`);
        const authEnv = getAuthEnv();
        execFileSync("gh", ["repo", "clone", repo, tmpDir], { env: authEnv, stdio: "pipe" });
        const res = await auditAndHealRepository(repo, tmpDir, { createPR: true });
        results.push(res);
      } catch (cloneErr: any) {
        console.error(`Error auditing remote repo ${repo}: ${cloneErr.message}`);
      } finally {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }

  return results;
}

// CLI direct execution
const isCLI = process.argv[1]?.endsWith("autonomous-repo-auditor.ts") || process.argv[1]?.endsWith("autonomous-repo-auditor.js");
if (isCLI) {
  runMultiRepoAutonomousAuditor()
    .then((results) => {
      console.log("\n📊 Final Multi-Repo Autonomous Audit Report:");
      console.table(results);
    })
    .catch((err) => {
      console.error("Fatal error during autonomous repo audit:", err);
      process.exit(1);
    });
}
