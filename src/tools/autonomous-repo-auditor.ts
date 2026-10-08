import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as dotenv from "dotenv";
import { Redis } from "ioredis";
import {
  DEFAULT_PROPOSER,
  DEFAULT_AUDITOR,
  BACKUP_OPENROUTER_PROPOSER,
  BACKUP_GROQ_AUDITOR,
  callModel,
} from "../ai/consensus.js";
import { colors } from "../core/colors.js";
import { getGitHubAuthEnv } from "../core/github.js";
import { extractJsonObject } from "../core/json.js";
import { LOCAL_REPO_SLUG, getTargetReposList, isLocalRepo } from "../core/repos.js";
import { reviewAndResolvePR } from "./pr-auto-resolver.js";
import { isAutonomyPaused } from "./autonomy-state.js";

dotenv.config();

// ==========================================
// Types
// ==========================================

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

/** Model 1's proposed search/replace patch for a detected flaw. */
interface FlawFixProposal {
  search: string;
  replace: string;
  rationale: string;
}

/** Model 2's audit verdict on a proposed flaw fix. */
interface FlawFixAudit {
  approved: boolean;
  finalSearch?: string;
  finalReplace?: string;
  auditCritique: string;
}

/** Either a usable proposal or the reason none could be produced. */
type ProposalOutcome =
  | { ok: true; proposal: FlawFixProposal; modelName: string }
  | { ok: false; error: string };

/** Either a usable audit verdict or the reason none could be produced. */
type AuditOutcome =
  | { ok: true; decision: FlawFixAudit; modelName: string }
  | { ok: false; error: string };

/** Whether the quota guardrail allows this run, and the resulting run count. */
type QuotaDecision =
  | { skip: true; result: AuditResult }
  | { skip: false; consecutiveRuns: number };

const AUDIT_STATE_FILE = path.resolve(process.cwd(), ".auditor-state.json");
const MAX_FLAWS_PER_AUDIT = 5;
const AUDIT_STATE_TTL_SECONDS = 60 * 60 * 24 * 30;

// ==========================================
// Commit identity & self-heal detection
// ==========================================

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
    const message = execFileSync(
      "git",
      ["log", "-1", "--format=%s%n%b", commitSha],
      { cwd: rootDir, encoding: "utf-8" }
    );
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

/** Marker matcher shared by the local-git and remote-GitHub commit lookups. */
function isSelfGeneratedCommitMessage(message: string): boolean {
  return (
    /fix\(auto-heal\)/i.test(message) ||
    /Generated autonomously by ShunopsAI/i.test(message) ||
    /\[auto-heal\]/i.test(message)
  );
}

/** Resolve the commit under audit: local HEAD, else the remote HEAD SHA. */
function resolveCurrentCommitSha(rootDir: string, repoSlug: string): string {
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

// ==========================================
// Audit state persistence (Redis + local file)
// ==========================================

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

/** Read a repo's audit state from Redis, or `null` when unavailable. */
async function readAuditorStateFromRedis(repoSlug: string): Promise<RepoAuditState | null> {
  const redis = getAuditorRedis();
  if (!redis) return null;
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
  return null;
}

/** Persist a repo's audit state to Redis; best-effort only. */
async function writeAuditorStateToRedis(repoSlug: string, state: RepoAuditState): Promise<void> {
  const redis = getAuditorRedis();
  if (!redis) return;
  try {
    await redis.connect();
    await redis.set(
      `shunops:auditor:state:${repoSlug}`,
      JSON.stringify(state),
      "EX",
      AUDIT_STATE_TTL_SECONDS
    );
    await redis.quit();
  } catch {
    try {
      redis.disconnect();
    } catch {}
  }
}

/** Read the local audit-state file; an unreadable file yields an empty map. */
async function readAuditorStateFile(): Promise<Record<string, RepoAuditState>> {
  try {
    const raw = await fs.readFile(AUDIT_STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getAuditorState(repoSlug: string): Promise<RepoAuditState | null> {
  const fromRedis = await readAuditorStateFromRedis(repoSlug);
  if (fromRedis) return fromRedis;

  const data = await readAuditorStateFile();
  return data[repoSlug] || null;
}

export async function saveAuditorState(repoSlug: string, state: RepoAuditState): Promise<void> {
  await writeAuditorStateToRedis(repoSlug, state);

  try {
    const data = await readAuditorStateFile();
    data[repoSlug] = state;
    await fs.writeFile(AUDIT_STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

// ==========================================
// Heuristic flaw scanning
// ==========================================

/** A ±4-line window around a flagged line, used as model context. */
function surroundingSnippet(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 5)).join("\n");
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
          snippet: surroundingSnippet(lines, i),
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
        snippet: surroundingSnippet(lines, i),
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
        snippet: surroundingSnippet(lines, i),
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
        snippet: surroundingSnippet(lines, i),
        category: "reliability",
        ruleId: "hardcoded-user-path",
        description: "Hardcoded local user filesystem path. Replace with configurable env var or relative path.",
      });
    }
  }

  return flaws;
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

/** Read every source file under `rootDir` and collect heuristic flaw candidates. */
async function collectFlawCandidates(
  rootDir: string
): Promise<{ files: string[]; flaws: CodeFlawCandidate[] }> {
  const files = await getSourceFiles(rootDir);
  console.log(`Auditing ${files.length} source code files for vulnerabilities and flaws...`);

  const flaws: CodeFlawCandidate[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(path.resolve(rootDir, file), "utf-8");
      flaws.push(...scanFileForHeuristicFlaws(file, content));
    } catch {}
  }

  return { files, flaws };
}

// ==========================================
// Consensus-based remediation
// ==========================================

/** Ask the proposer model for a targeted fix to one flaw. */
async function proposeFlawFix(flaw: CodeFlawCandidate): Promise<ProposalOutcome> {
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

  const proposal = extractJsonObject<FlawFixProposal>(m1Response.text);
  if (!proposal) {
    return { ok: false, error: "Model 1 failed to return valid JSON" };
  }
  return { ok: true, proposal, modelName: m1Response.modelName };
}

/** Ask the auditor model to verify the proposed fix. */
async function auditFlawFix(
  flaw: CodeFlawCandidate,
  proposal: FlawFixProposal
): Promise<AuditOutcome> {
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
${JSON.stringify(proposal, null, 2)}

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

  const decision = extractJsonObject<FlawFixAudit>(m2Response.text);
  if (!decision) {
    return { ok: false, error: "Model 2 failed to return valid JSON" };
  }
  return { ok: true, decision, modelName: m2Response.modelName };
}

/** Run the project typecheck inside `rootDir`. */
function runTypecheck(rootDir: string): { ok: true } | { ok: false; error: string } {
  try {
    execSync("npm run typecheck", { cwd: rootDir, stdio: "pipe" });
    return { ok: true };
  } catch (compileErr: any) {
    return { ok: false, error: compileErr.message };
  }
}

/**
 * Autonomously remediate a detected flaw using Dual-Model Consensus
 */
export async function remediateFlawWithConsensus(
  flaw: CodeFlawCandidate,
  rootDir: string
): Promise<{ success: boolean; patchSummary?: string }> {
  const fullPath = path.resolve(rootDir, flaw.filePath);
  let fileContent: string;
  try {
    fileContent = await fs.readFile(fullPath, "utf-8");
  } catch (err: any) {
    return { success: false, patchSummary: `Could not read file: ${err.message}` };
  }

  console.log(`\n${colors.cyan}🔧 [Consensus Healer] Remediating ${flaw.ruleId} at ${flaw.filePath}:${flaw.lineNo}...${colors.reset}`);

  try {
    // Round 1: Model 1 (Gemini 2.5 Flash) proposes a fix
    const proposal = await proposeFlawFix(flaw);
    if (!proposal.ok) {
      return { success: false, patchSummary: proposal.error };
    }

    // Round 2: Model 2 (Groq GPT-OSS 120B) audits the fix
    const audit = await auditFlawFix(flaw, proposal.proposal);
    if (!audit.ok) {
      return { success: false, patchSummary: audit.error };
    }
    if (!audit.decision.approved) {
      console.warn(`${colors.yellow}⚠️ Model 2 rejected fix: ${audit.decision.auditCritique}${colors.reset}`);
      return { success: false, patchSummary: `Rejected by auditor: ${audit.decision.auditCritique}` };
    }

    const searchTarget = audit.decision.finalSearch || proposal.proposal.search;
    const replaceTarget = audit.decision.finalReplace || proposal.proposal.replace;

    if (!fileContent.includes(searchTarget)) {
      return { success: false, patchSummary: `Search target not matched in ${flaw.filePath}` };
    }

    await fs.writeFile(fullPath, fileContent.replace(searchTarget, replaceTarget), "utf-8");

    // Verify typecheck
    const typecheck = runTypecheck(rootDir);
    if (typecheck.ok) {
      console.log(`${colors.green}✓ Fixed ${flaw.ruleId} in ${flaw.filePath} via Dual-Model Consensus (${proposal.modelName} + ${audit.modelName})!${colors.reset}`);
      return {
        success: true,
        patchSummary: `${flaw.ruleId} in ${flaw.filePath}: ${proposal.proposal.rationale}`,
      };
    }

    console.warn(`${colors.yellow}⚠️ Typecheck failed after patch. Rolling back ${flaw.filePath}...${colors.reset}`);
    await fs.writeFile(fullPath, fileContent, "utf-8");
    return { success: false, patchSummary: `Typecheck rollback: ${typecheck.error}` };
  } catch (err: any) {
    return { success: false, patchSummary: `Consensus execution error: ${err.message}` };
  }
}

// ==========================================
// Repository audit orchestration
// ==========================================

/** Print the auditor's run header. */
function logAuditorBanner(repoSlug: string, rootDir: string): void {
  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🛡️ ShunopsAI Autonomous Repository Auditor & Healer${colors.reset}`);
  console.log(`${colors.cyan}Target Repo:${colors.reset} ${repoSlug}`);
  console.log(`${colors.cyan}Directory:${colors.reset}   ${rootDir}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);
}

/**
 * Smart quota guardrail: skip the LLM audit when the commit is unchanged
 * (already verified twice) or was generated by the healer itself.
 */
async function evaluateAuditQuota(
  repoSlug: string,
  currentCommitSha: string,
  rootDir: string
): Promise<QuotaDecision> {
  const prevState = await getAuditorState(repoSlug);

  // Check if the current commit was generated by autonomous-repo-auditor itself
  const isSelfHeal =
    currentCommitSha === prevState?.lastSelfGeneratedCommitSha ||
    isSelfGeneratedCommit(currentCommitSha, rootDir, repoSlug);

  if (prevState && prevState.lastAuditedCommitSha === currentCommitSha) {
    const consecutiveRuns = (prevState.consecutiveRunsOnSameCommit || 0) + 1;
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
        skip: true,
        result: {
          repo: repoSlug,
          scannedFiles: 0,
          flawsDetected: 0,
          flawsRemediated: 0,
          skipped: true,
          reason: `No commit changes since ${currentCommitSha.slice(0, 7)} (verified ${prevState.consecutiveRunsOnSameCommit} times previously)`,
        },
      };
    }

    console.log(
      `${colors.cyan}ℹ️ [Smart Guardrail] Audit ${consecutiveRuns}/2 on commit ${currentCommitSha.slice(0, 7)} (verification run)${colors.reset}`
    );
    return { skip: false, consecutiveRuns };
  }

  if (isSelfHeal) {
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
      skip: true,
      result: {
        repo: repoSlug,
        scannedFiles: 0,
        flawsDetected: 0,
        flawsRemediated: 0,
        skipped: true,
        reason: `Commit ${currentCommitSha.slice(0, 7)} was self-generated by ShunopsAI auto-healer; already verified during PR consensus.`,
      },
    };
  }

  console.log(
    `${colors.green}🆕 [Smart Guardrail] External user commit detected: ${currentCommitSha.slice(0, 7) || "initial"} - Starting fresh 2-run cycle.${colors.reset}`
  );
  return { skip: false, consecutiveRuns: 1 };
}

/** Remediate the highest-priority flaws, capped to guard model quota. */
async function remediateTopFlaws(
  allFlaws: CodeFlawCandidate[],
  rootDir: string
): Promise<{ remediatedCount: number; patchSummaries: string[] }> {
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

  return { remediatedCount, patchSummaries };
}

/**
 * Open a healing branch and PR for applied fixes, then hand it to the
 * dual-model reviewer. Always restores the starting branch.
 */
async function openHealingPullRequest(
  repoSlug: string,
  rootDir: string,
  remediatedCount: number,
  patchSummaries: string[],
  auditResult: AuditResult
): Promise<void> {
  const authEnv = getGitHubAuthEnv();
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

/** Persist the outcome of an audit run against its (possibly post-merge) commit. */
async function recordAuditState(
  repoSlug: string,
  rootDir: string,
  currentCommitSha: string,
  consecutiveRuns: number,
  auditResult: AuditResult,
  remediatedCount: number
): Promise<void> {
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
}

/**
 * Autonomously audit and heal a repository with Smart Quota Guardrails
 */
export async function auditAndHealRepository(
  repoSlug = LOCAL_REPO_SLUG,
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

  logAuditorBanner(repoSlug, rootDir);

  // 1. Fetch current commit SHA for change tracking
  const currentCommitSha = resolveCurrentCommitSha(rootDir, repoSlug);

  // 2. Smart Quota Guardrail: Max 2 consecutive runs on the same commit SHA
  let consecutiveRuns = 1;
  if (!options.force && currentCommitSha) {
    const quota = await evaluateAuditQuota(repoSlug, currentCommitSha, rootDir);
    if (quota.skip) {
      return quota.result;
    }
    consecutiveRuns = quota.consecutiveRuns;
  }

  // 3. Scan every source file for heuristic flaws
  const { files, flaws: allFlaws } = await collectFlawCandidates(rootDir);
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
  const { remediatedCount, patchSummaries } = await remediateTopFlaws(allFlaws, rootDir);

  const auditResult: AuditResult = {
    repo: repoSlug,
    scannedFiles: files.length,
    flawsDetected: allFlaws.length,
    flawsRemediated: remediatedCount,
  };

  // If fixes were applied and createPR is requested:
  if (remediatedCount > 0 && options.createPR) {
    await openHealingPullRequest(repoSlug, rootDir, remediatedCount, patchSummaries, auditResult);
  }

  // Update audit state with the post-merge commit SHA
  await recordAuditState(repoSlug, rootDir, currentCommitSha, consecutiveRuns, auditResult, remediatedCount);

  return auditResult;
}

// ==========================================
// Multi-repository runner
// ==========================================

/**
 * Whether a remote repo's HEAD can be skipped because it is unchanged
 * (already verified twice) or was authored by the healer itself.
 */
async function evaluateRemoteSkip(
  repo: string,
  remoteSha: string
): Promise<{ skip: false } | { skip: true; reason: string }> {
  const prevState = await getAuditorState(repo);
  const isSelfHeal =
    remoteSha === prevState?.lastSelfGeneratedCommitSha ||
    isSelfGeneratedCommit(remoteSha, process.cwd(), repo);

  const unchanged = Boolean(
    prevState &&
      prevState.lastAuditedCommitSha === remoteSha &&
      (prevState.consecutiveRunsOnSameCommit || 0) >= 2
  );

  if (!unchanged && !isSelfHeal) {
    return { skip: false };
  }

  console.log(
    `\n${colors.yellow}⏭️ [Remote Repo Skipped] ${repo} (commit ${remoteSha.slice(0, 7)}) is ${isSelfHeal ? "an autonomous self-heal commit" : "unchanged"}. Skipping clone & LLM calls.${colors.reset}`
  );
  return {
    skip: true,
    reason: isSelfHeal
      ? `Commit ${remoteSha.slice(0, 7)} was self-generated by ShunopsAI auto-healer`
      : `No new commits since ${remoteSha.slice(0, 7)} (verified ${prevState?.consecutiveRunsOnSameCommit} times)`,
  };
}

/**
 * Audit a remote repository, cloning it into an isolated temp directory.
 * Returns `null` when the clone or audit itself failed.
 */
async function auditRemoteRepository(repo: string): Promise<AuditResult | null> {
  let remoteSha = "";
  try {
    remoteSha = execFileSync(
      "gh",
      ["api", `repos/${repo}/commits/HEAD`, "--jq", ".sha"],
      { env: getGitHubAuthEnv(), encoding: "utf-8" }
    ).trim();
  } catch {}

  if (remoteSha) {
    const skip = await evaluateRemoteSkip(repo, remoteSha);
    if (skip.skip) {
      return {
        repo,
        scannedFiles: 0,
        flawsDetected: 0,
        flawsRemediated: 0,
        skipped: true,
        reason: skip.reason,
      };
    }
  }

  const tmpDir = path.join(os.tmpdir(), `shunopsai-audit-${repo.replace("/", "-")}-${Date.now()}`);
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
 * Multi-Repository runner: iterates through all target repositories configured in AUTONOMOUS_TARGET_REPOS
 */
export async function runMultiRepoAutonomousAuditor(): Promise<AuditResult[]> {
  if (await isAutonomyPaused()) {
    console.log(`${colors.yellow}⏸️ [Multi-Repo Auditor] Skipped: Autonomy & AI operations are currently PAUSED by user killswitch.${colors.reset}`);
    return [];
  }

  const results: AuditResult[] = [];

  for (const repo of getTargetReposList()) {
    if (isLocalRepo(repo)) {
      // Local repo
      results.push(await auditAndHealRepository(repo, process.cwd(), { createPR: true }));
      continue;
    }

    const remoteResult = await auditRemoteRepository(repo);
    if (remoteResult) {
      results.push(remoteResult);
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
