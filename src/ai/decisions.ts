/**
 * Baseten Mammoth 1 Full-Spectrum Decision Engine for ShunopsAI
 * Powered by BaseLabs' Qwen2.5-27B Decision Model via OpenRouter Decisions API
 *
 * Full-Freedom Architecture:
 * - Unconstrained Multi-Dimensional Decisions (evaluates state across multiple typed questions simultaneously)
 * - Rich Contextual State (task goal, environment, arguments, intent, rather than blind string snippets)
 * - Full Taxonomy Selection (direct 5-tier model routing, granular blast-radius scoring)
 * - Calibrated probability distributions over predefined options in a single forward pass.
 */
import * as dotenv from "dotenv";

dotenv.config();

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MAMMOTH_MODEL = process.env.MAMMOTH_MODEL || "baseten/mammoth-1";

export type QuestionType = "noul" | "choice" | "score";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  true_when?: string | undefined;
  false_when?: string | undefined;
}

export interface ChoiceQuestion<T extends string = string> {
  type: "choice";
  instructions: string;
  criteria: Record<T, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type QuestionDef = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface DecisionResult<Q extends Record<string, QuestionDef>> {
  model: string;
  answers: {
    [K in keyof Q]: Q[K] extends NoulQuestion
      ? { type: "noul"; noul: number }
      : Q[K] extends ChoiceQuestion<infer T>
      ? { type: "choice"; choice: T; probabilities: Record<T, number>; confidence: number }
      : { type: "score"; score: number; probabilities: number[] };
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost: number;
  } | undefined;
  latencyMs: number;
}

// Bounded in-memory decision cache
const decisionCache = new Map<string, any>();
const MAX_CACHE_ENTRIES = 256;

function getCacheKey(state: any, questions: Record<string, any>): string {
  const s = typeof state === "string" ? state : JSON.stringify(state);
  const q = JSON.stringify(questions);
  return `${s.slice(0, 140)}::${q.slice(0, 140)}`;
}

/**
 * Core Unconstrained Decision Engine:
 * Sends arbitrary contextual state and any combination of typed questions (noul, choice, score)
 * in a single forward pass to Baseten Mammoth 1.
 */
export async function decide<Q extends Record<string, QuestionDef>>(
  state: any,
  questions: Q,
  options?: { customApiKey?: string | undefined; timeoutMs?: number | undefined }
): Promise<DecisionResult<Q> | null> {
  const apiKey =
    options?.customApiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_KEY;

  if (!apiKey) {
    return null;
  }

  const cacheKey = getCacheKey(state, questions);
  if (decisionCache.has(cacheKey)) {
    return decisionCache.get(cacheKey);
  }

  const start = Date.now();
  try {
    const res = await fetch(OPENROUTER_DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ShunyaPulse/ShunopsAI",
        "X-Title": "ShunopsAI-Mammoth-Full-Decision-Engine",
      },
      body: JSON.stringify({
        model: MAMMOTH_MODEL,
        state,
        questions,
      }),
      signal: AbortSignal.timeout(options?.timeoutMs || 9000),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as any;
    const elapsed = Date.now() - start;

    const result: DecisionResult<Q> = {
      model: data?.model || MAMMOTH_MODEL,
      answers: data?.answers || {},
      usage: data?.usage,
      latencyMs: elapsed,
    };

    if (decisionCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = decisionCache.keys().next().value;
      if (firstKey) decisionCache.delete(firstKey);
    }
    decisionCache.set(cacheKey, result);

    return result;
  } catch {
    return null;
  }
}

// ==========================================
// Specialized High-Freedom Decision Helpers
// ==========================================

export type AgentSafetyVerdict = {
  requiresApproval: boolean;
  approvalProbability: number;
  severityLevel: number;
  intentAligned: boolean;
  rationale: string;
};

/**
 * Full-Context Tool Risk Evaluator:
 * Evaluates the full semantic relation between what the user/agent is trying to accomplish
 * and what the tool call actually does (Intent Alignment + Blast Radius + Destruction Risk).
 */
export async function evaluateToolRiskWithFullContext(ctx: {
  taskGoal?: string | undefined;
  toolName: string;
  payload: any;
  environment?: string | undefined;
  tenantUserId?: number | null | undefined;
}): Promise<AgentSafetyVerdict | null> {
  const state = {
    taskGoal: ctx.taskGoal || "Autonomous agent general operation",
    proposedAction: {
      tool: ctx.toolName,
      argumentsOrPayload: ctx.payload,
    },
    environment: ctx.environment || "production",
    scope: ctx.tenantUserId ? `Tenant user_${ctx.tenantUserId}` : "Operator System Scope",
  };

  const decision = await decide(state, {
    requires_human_approval: {
      type: "noul",
      instructions: "Does this proposed tool call carry risk of permanent data loss, cloud infrastructure mutation, unauthorized deletion, or irreversible changes that require human sign-off?",
      true_when: "Destructive deletion, table drop, database truncate, cloud resource kill, or secret exposure",
      false_when: "Harmless read, temporary cache write, query execution, or sandbox inspection matching task goal",
    },
    severity_score: {
      type: "score",
      instructions: "Rate the severity and potential blast radius of this action if misconfigured or executed with malformed parameters",
      criteria: [
        "1: Completely safe / zero blast radius",
        "2: Low risk / easily reversible local mutation",
        "3: Moderate risk / workspace or database mutation",
        "4: Catastrophic / permanent data loss or cloud deletion",
      ],
    },
    intent_aligned: {
      type: "noul",
      instructions: "Is this action logically aligned and proportionate to the declared taskGoal, or is it an unexpected anomalous behavior?",
    },
  });

  if (!decision) return null;

  const approvalProb = decision.answers.requires_human_approval?.noul ?? 0;
  const severity = decision.answers.severity_score?.score ?? 0;
  const intentAligned = (decision.answers.intent_aligned?.noul ?? 1) >= 0.40;

  // Unconstrained dynamic threshold:
  // Requires approval if Mammoth flags high approval probability (>0.75),
  // OR if blast radius is severe (severity >= 2),
  // OR if the action is NOT aligned with the declared task goal.
  const requiresApproval =
    approvalProb >= 0.75 ||
    severity >= 2 ||
    (!intentAligned && approvalProb >= 0.40);

  return {
    requiresApproval,
    approvalProbability: approvalProb,
    severityLevel: severity + 1,
    intentAligned,
    rationale: `Mammoth 1 Full-Context Audit: ${(approvalProb * 100).toFixed(1)}% risk, severity scale ${severity + 1}/4, intent-aligned=${intentAligned}`,
  };
}

export type ModelTierPreference = "fast" | "code" | "deep-reasoning" | "research" | "frontier";

/**
 * Full-Taxonomy Model Router:
 * Rather than clamping into binary "simple" vs "complex", Mammoth 1 directly chooses
 * among our 5 specialized architectural inference tiers.
 */
export async function routeOptimalTierWithMammoth(
  userQuery: string,
  recentContext?: string | undefined
): Promise<{
  tier: ModelTierPreference;
  confidence: number;
  probabilities: Record<ModelTierPreference, number>;
} | null> {
  const state = {
    userQuery: userQuery.trim().slice(0, 1000),
    recentContext: recentContext?.slice(0, 500) || "None",
  };

  const decision = await decide(state, {
    optimal_tier: {
      type: "choice",
      instructions: "Which specialized AI inference tier is mathematically best suited to answer this query with maximum quality and efficiency?",
      criteria: {
        "fast": "Quick casual chats, greetings, basic questions, simple translations, text rephrasing, or low-latency requests",
        "code": "Software engineering, AST analysis, debugging, refactoring, algorithms, unit tests, SQL schemas, or script generation",
        "deep-reasoning": "Complex logic puzzles, multi-step deduction, mathematical proofs, architectural trade-offs, and critical debugging",
        "research": "Long-form documentation analysis, deep search synthesis, multi-source literature reviews, and extensive contextual reasoning",
        "frontier": "State-of-the-art flagship reasoning, high-stakes system design, highly ambiguous strategic planning, and master intelligence",
      },
    },
  });

  if (!decision?.answers?.optimal_tier) return null;

  const ans = decision.answers.optimal_tier;
  return {
    tier: ans.choice as ModelTierPreference,
    confidence: ans.confidence,
    probabilities: ans.probabilities as Record<ModelTierPreference, number>,
  };
}

/**
 * Backwards-compatible single-question helpers with unconstrained options
 */
export async function askMammothBool(
  state: any,
  question: string,
  options?: {
    instructions?: string | undefined;
    true_when?: string | undefined;
    false_when?: string | undefined;
    threshold?: number | undefined;
    customApiKey?: string | undefined;
  }
): Promise<{ isTrue: boolean; probability: number; latencyMs: number }> {
  const threshold = options?.threshold ?? 0.5;
  const qObj: NoulQuestion = {
    type: "noul",
    instructions: options?.instructions || question,
  };
  if (options?.true_when) qObj.true_when = options.true_when;
  if (options?.false_when) qObj.false_when = options.false_when;

  const decision = await decide(
    state,
    { q1: qObj },
    options?.customApiKey ? { customApiKey: options.customApiKey } : undefined
  );

  const rawProb = (decision?.answers as any)?.q1?.noul;
  if (typeof rawProb === "number") {
    return {
      isTrue: rawProb >= threshold,
      probability: rawProb,
      latencyMs: decision?.latencyMs || 0,
    };
  }

  return { isTrue: false, probability: 0.5, latencyMs: 0 };
}

export async function askMammothChoice<T extends string>(
  state: any,
  question: string,
  criteria: Record<T, string>,
  options?: { customApiKey?: string | undefined }
): Promise<{ choice: T; probabilities: Record<T, number>; confidence: number; latencyMs: number }> {
  const decision = await decide(
    state,
    {
      q1: {
        type: "choice",
        instructions: question,
        criteria,
      },
    },
    options?.customApiKey ? { customApiKey: options.customApiKey } : undefined
  );

  const ans = (decision?.answers as any)?.q1;
  if (ans && typeof ans.choice === "string") {
    return {
      choice: ans.choice as T,
      probabilities: ans.probabilities as Record<T, number>,
      confidence: ans.confidence,
      latencyMs: decision?.latencyMs || 0,
    };
  }

  const fallbackKey = Object.keys(criteria)[0] as T;
  return {
    choice: fallbackKey,
    probabilities: {} as Record<T, number>,
    confidence: 0.5,
    latencyMs: 0,
  };
}

/**
 * Multi-Dimensional Autonomous Code Patch Auditor:
 * Evaluates code remediation without binary thresholds, inspecting safety,
 * technical efficacy score, and precise risk categorization in one forward pass.
 */
export async function auditCodePatchWithMammoth(ctx: {
  filePath: string;
  ruleId: string;
  search: string;
  replace: string;
}): Promise<{
  isSafe: boolean;
  confidence: number;
  riskChoice: "safe" | "breaking-change" | "syntax-error" | "injection-vector";
  efficacyScore: number;
  rationale: string;
} | null> {
  const state = {
    targetFile: ctx.filePath,
    securityRule: ctx.ruleId,
    diff: {
      original: ctx.search,
      proposedPatch: ctx.replace,
    },
  };

  const decision = await decide(state, {
    is_safe: {
      type: "noul",
      instructions: "Does this code patch safely remediate the security rule violation without introducing regressions, breaking syntax, or new vulnerabilities?",
      true_when: "Clean, idiomatic TypeScript/Node.js fix addressing the root cause",
      false_when: "Broken syntax, unexpected side effects, or security regression",
    },
    risk_choice: {
      type: "choice",
      instructions: "Categorize the primary risk classification of this proposed patch.",
      criteria: {
        "safe": "Clean, syntactically sound, verified safe remediation",
        "breaking-change": "Alters public API contract or function signature incompatibly",
        "syntax-error": "Incomplete replacement, unmatched brackets, or malformed syntax",
        "injection-vector": "Introduces unsanitized inputs, shell execution, or security hole",
      },
    },
    efficacy_score: {
      type: "score",
      instructions: "Rate the technical efficacy of this remediation from 1 (ineffective) to 4 (production hardened)",
      criteria: [
        "1: Ineffective or placebo change",
        "2: Superficial workaround",
        "3: Solid standard remediation",
        "4: Optimal, type-safe, production-hardened remediation",
      ],
    },
  });

  if (!decision) return null;

  const isSafeProb = decision.answers.is_safe?.noul ?? 0.5;
  const riskChoice = (decision.answers.risk_choice?.choice as "safe" | "breaking-change" | "syntax-error" | "injection-vector") ?? "safe";
  const efficacy = (decision.answers.efficacy_score?.score ?? 2) + 1;

  const isSafe = riskChoice === "safe" && efficacy >= 2 && isSafeProb >= 0.45;

  return {
    isSafe,
    confidence: isSafeProb,
    riskChoice,
    efficacyScore: efficacy,
    rationale: `Mammoth 1 Multi-Dimensional Audit: risk=${riskChoice}, efficacy=${efficacy}/4, safety confidence=${(isSafeProb * 100).toFixed(1)}%`,
  };
}

/**
 * Multi-Dimensional Video Editorial Auditor:
 * Evaluates documentary scripts for non-partisan constructive tone (GEMINI.md Rule 11),
 * journalistic quality score, and narrative framing simultaneously.
 */
export async function auditScriptEditorialWithMammoth(ctx: {
  title: string;
  narrationExcerpt: string;
  domain: string;
}): Promise<{
  isCompliant: boolean;
  editorialCategory: "inspiring-documentary" | "academic-educational" | "partisan-critique" | "sensationalist";
  qualityScore: number;
  confidence: number;
  rationale: string;
} | null> {
  const state = {
    title: ctx.title,
    domain: ctx.domain,
    narrationSample: ctx.narrationExcerpt,
  };

  const decision = await decide(state, {
    is_compliant: {
      type: "noul",
      instructions: "Does this educational or documentary script adhere to non-partisan, constructive governance standards (GEMINI.md Rule 11), strictly avoiding aggressive condemnation, fault-finding, or attacks against any politician or party?",
      true_when: "Objective, fact-based documentary, educational milestone, or scientific narrative",
      false_when: "Partisan attack, condemnation ('ninda'), political fault-finding ('kamiyan'), or roasts",
    },
    editorial_category: {
      type: "choice",
      instructions: "What is the primary editorial tone of this script?",
      criteria: {
        "inspiring-documentary": "High-fidelity, fact-based inspiring storytelling",
        "academic-educational": "Structured, educational, historical, or scientific analysis",
        "sensationalist": "Clickbait or exaggerated framing",
        "partisan-critique": "Partisan politics, accusations, or attacking political opponents",
      },
    },
    quality_score: {
      type: "score",
      instructions: "Rate the overall editorial quality and journalistic integrity of the script",
      criteria: [
        "1: Low quality, biased, or partisan",
        "2: Acceptable but generic",
        "3: High quality, informative, and engaging",
        "4: Masterclass documentary journalism",
      ],
    },
  });

  if (!decision) return null;

  const complianceProb = decision.answers.is_compliant?.noul ?? 1.0;
  const category = (decision.answers.editorial_category?.choice as "inspiring-documentary" | "academic-educational" | "partisan-critique" | "sensationalist") ?? "inspiring-documentary";
  const quality = (decision.answers.quality_score?.score ?? 2) + 1;

  const isCompliant = category !== "partisan-critique" && complianceProb >= 0.50;

  return {
    isCompliant,
    editorialCategory: category,
    qualityScore: quality,
    confidence: complianceProb,
    rationale: `Mammoth 1 Editorial Audit: tone=${category}, quality=${quality}/4, compliance=${(complianceProb * 100).toFixed(1)}%`,
  };
}

/**
 * Multi-Dimensional Visual Prompt Auditor (GEMINI.md Rule 12 & Rule 17):
 * Categorizes diffusion prompts to eliminate gibberish text without binary blocking.
 */
export async function auditDiffusionPromptWithMammoth(prompt: string): Promise<{
  hasTextAnomaly: boolean;
  confidence: number;
  suggestedAction: "keep" | "replace-with-metaphor" | "blur-background";
} | null> {
  const state = { prompt };

  const decision = await decide(state, {
    contains_readable_text_prompt: {
      type: "noul",
      instructions: "Does this image prompt explicitly request the diffusion model to render readable letters, scoreboards, typographic banners, or exact numbers in the image latents?",
      true_when: "Explicit words, written text, readable signage, scoreboard numbers, or typographic titles",
      false_when: "Visual photography, atmosphere, lighting, stadium scenery, textures, or cinematic characters",
    },
    action: {
      type: "choice",
      instructions: "What is the optimal action to maintain zero-diffusion-text compliance?",
      criteria: {
        "keep": "Prompt is purely visual and contains zero readable text requirements",
        "replace-with-metaphor": "Replace text-heavy items with tactile visual metaphors",
        "blur-background": "Diffuse background elements to prevent garbled letters",
      },
    },
  });

  if (!decision) return null;

  const prob = decision.answers.contains_readable_text_prompt?.noul ?? 0;
  const action = (decision.answers.action?.choice as "keep" | "replace-with-metaphor" | "blur-background") ?? "keep";

  return {
    hasTextAnomaly: action !== "keep" || prob >= 0.55,
    confidence: prob,
    suggestedAction: action,
  };
}
