// [DISABLED - KAGGLE BENCHMARKS / MODEL PROXY]
// import { extractJsonObject } from "../../core/json.js";
// import { runKaggleAiTask, isKaggleConfigured } from "../kaggle-ai.js";
// import { colors } from "../../core/colors.js";
// import type { CodeFlawCandidate } from "./types.js";
// 
// export interface FlawFixProposal {
//   search: string;
//   replace: string;
//   rationale: string;
// }
// 
// export interface FlawFixAudit {
//   approved: boolean;
//   finalSearch?: string;
//   finalReplace?: string;
//   auditCritique: string;
// }
// 
// /** Either a usable audit verdict or the reason none could be produced. */
// export type AuditOutcome =
//   | { ok: true; decision: FlawFixAudit; modelName: string }
//   | { ok: false; error: string };
// 
// /**
//  * Audit Model 1's proposed fix using Kaggle's hosted frontier models ($10 AI Quota),
//  * preventing quota drain on Groq 120B and Gemini key pools.
//  */
// export async function auditFlawWithKaggle(
//   flaw: CodeFlawCandidate,
//   proposal: FlawFixProposal
// ): Promise<AuditOutcome> {
//   const prompt = `You are Model 2 (Senior Security Auditor & Critic) in ShunopsAI's Dual-Model Consensus Protocol.
// Audit Model 1's proposed fix for ${flaw.ruleId} in ${flaw.filePath}.
// 
// Verify:
// 1. Does 'search' exist uniquely in the file context?
// 2. Does 'replace' fully eliminate the vulnerability without breaking TypeScript types or runtime semantics?
// 
// Context Snippet:
// \`\`\`typescript
// ${flaw.snippet}
// \`\`\`
// 
// Model 1 Proposal:
// ${JSON.stringify(proposal, null, 2)}
// 
// Return ONLY valid JSON:
// {
//   "approved": boolean,
//   "finalSearch": "exact string to replace",
//   "finalReplace": "verified secure replacement string",
//   "auditCritique": "1-sentence audit critique"
// }`;
// 
//   console.log(
//     `${colors.cyan}🛡️ [Kaggle Auditor] Verifying patch via Kaggle Hosted AI Quota for ${flaw.ruleId}...${colors.reset}`
//   );
// 
//   const res = await runKaggleAiTask({
//     taskName: `audit_${flaw.ruleId}`,
//     systemPrompt: "You are an expert security code auditor. Return ONLY a valid JSON object.",
//     prompt,
//     model: "claude-3-5-sonnet",
//     temperature: 0.1,
//   });
// 
//   if (!res.success || !res.output) {
//     return { ok: false, error: res.error || "Kaggle AI auditor returned empty output" };
//   }
// 
//   const decision = extractJsonObject<FlawFixAudit>(res.output);
//   if (!decision) {
//     return { ok: false, error: "Kaggle AI auditor failed to return valid JSON" };
//   }
// 
//   return { ok: true, decision, modelName: res.modelUsed };
// }
// 
// 
