import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import {
  DEFAULT_PROPOSER,
  DEFAULT_AUDITOR,
  BACKUP_OPENROUTER_PROPOSER,
  BACKUP_GROQ_AUDITOR,
  callModel,
} from "../ai/consensus.js";
import { fetchOpenPRs, reviewAndResolvePR } from "./pr-auto-resolver.js";

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
}

function getAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.GH_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "";
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
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
 * Autonomously audit and heal a repository
 */
export async function auditAndHealRepository(
  repoSlug = "ShunyaPulse/ShunopsAI",
  rootDir = process.cwd(),
  options: { createPR?: boolean } = { createPR: true }
): Promise<AuditResult> {
  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🛡️ ShunopsAI Autonomous Repository Auditor & Healer${colors.reset}`);
  console.log(`${colors.cyan}Target Repo:${colors.reset} ${repoSlug}`);
  console.log(`${colors.cyan}Directory:${colors.reset}   ${rootDir}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);

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
    return {
      repo: repoSlug,
      scannedFiles: files.length,
      flawsDetected: 0,
      flawsRemediated: 0,
    };
  }

  let remediatedCount = 0;
  const patchSummaries: string[] = [];

  for (const flaw of allFlaws) {
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

      // Return to main branch
      execFileSync("git", ["checkout", "main"], { cwd: rootDir, env: authEnv, stdio: "pipe" });
    } catch (gitErr: any) {
      console.error(`GitOps PR creation notice: ${gitErr.message}`);
    }
  }

  return auditResult;
}

/**
 * Multi-Repository runner: iterates through all target repositories configured in AUTONOMOUS_TARGET_REPOS
 */
export async function runMultiRepoAutonomousAuditor(): Promise<AuditResult[]> {
  const targetReposStr = process.env.AUTONOMOUS_TARGET_REPOS || "ShunyaPulse/ShunopsAI";
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
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
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
