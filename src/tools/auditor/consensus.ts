import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_PROPOSER,
  DEFAULT_AUDITOR,
  BACKUP_OPENROUTER_PROPOSER,
  BACKUP_GROQ_AUDITOR,
  callModel,
} from "../../ai/consensus.js";
import { colors } from "../../core/colors.js";
import { extractJsonObject } from "../../core/json.js";
import type { CodeFlawCandidate } from "./types.js";

// ==========================================
// Consensus-based remediation
// ==========================================

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
async function auditFlawFix(flaw: CodeFlawCandidate, proposal: FlawFixProposal): Promise<AuditOutcome> {
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
