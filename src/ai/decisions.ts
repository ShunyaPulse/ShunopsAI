/**
 * Baseten Mammoth 1 Full-Spectrum Decision Engine for ShunopsAI
 * Powered by BaseLabs' Qwen3.5-27B Decision Model via OpenRouter Decisions API (/api/alpha/decisions)
 *
 * Full-Freedom Architecture:
 * - Strict OpenRouter /api/alpha/decisions schema compliance (criteria.{true,false} for noul, 0-indexed continuous scores)
 * - Shared-Prefix Multi-Question Prefill (answers routing, tool unlocking, and deliverable intent in 1 pass)
 * - Multi-Key Pool Rotation with O(1) Round-Robin & Free-to-Sibling Failover (mammoth-1:free -> elephant-1 -> mammoth-1)
 * - Collision-Proof SHA-256 Decision Cache & Calibrated Brier Confidence Promotion
 */
import * as crypto from "node:crypto";
import * as dotenv from "dotenv";

dotenv.config();

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

const DEFAULT_MAMMOTH_CHAIN = [
  process.env.MAMMOTH_MODEL || "baseten/mammoth-1:free",
  "baseten/elephant-1",
  "baseten/mammoth-1",
];

export type QuestionType = "noul" | "choice" | "score";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  /** Official OpenRouter Decisions API schema for binary yes/no criteria */
  criteria?: {
    true: string;
    false: string;
  } | undefined;
  /** Backwards-compatible aliases automatically normalized into criteria.{true,false} */
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
      : {
          type: "score";
          /** 0-indexed probability-weighted continuous score in [0, criteria.length - 1] */
          score: number;
          confidence?: number | undefined;
          probabilities: Record<string, number> | number[];
          legend?: Record<string, string> | undefined;
        };
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost: number;
  } | undefined;
  latencyMs: number;
}

// Multi-key OpenRouter pool with randomized startup offset & O(1) round-robin (GEMINI.md Rule 6)
function getOpenRouterDecisionKeys(customApiKey?: string): string[] {
  if (customApiKey && customApiKey.trim()) {
    return [customApiKey.trim()];
  }
  const raw =
    process.env.OPENROUTER_KEYS ||
    process.env.OPENROUTER_API_KEYS ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_KEY ||
    "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

let keyRoundRobinIndex = crypto.randomInt(0, 1024);

function nextOpenRouterKey(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;
  keyRoundRobinIndex = (keyRoundRobinIndex + 1) % keys.length;
  return keys[keyRoundRobinIndex]!;
}

// Bounded collision-proof SHA-256 in-memory decision cache
const decisionCache = new Map<string, any>();
const MAX_CACHE_ENTRIES = 512;

function getCacheKey(state: any, questions: Record<string, any>): string {
  const s = typeof state === "string" ? state : JSON.stringify(state);
  const q = JSON.stringify(questions);
  return crypto.createHash("sha256").update(s).update("::").update(q).digest("hex");
}

/**
 * Normalizes question definitions so that any `true_when` / `false_when` properties
 * are formatted into the official OpenRouter `/api/alpha/decisions` `criteria: { true, false }` object.
 */
function normalizeQuestionsForOpenRouter(questions: Record<string, QuestionDef>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      const normalized: Record<string, any> = {
        type: "noul",
        instructions: q.instructions,
      };
      if (q.criteria && typeof q.criteria.true === "string" && typeof q.criteria.false === "string") {
        normalized.criteria = {
          true: q.criteria.true,
          false: q.criteria.false,
        };
      } else if (q.true_when || q.false_when) {
        normalized.criteria = {
          true: q.true_when || "The statement or condition is true.",
          false: q.false_when || "The statement or condition is false.",
        };
      }
      out[key] = normalized;
    } else {
      out[key] = q;
    }
  }
  return out;
}

/**
 * Core Unconstrained Decision Engine:
 * Sends arbitrary contextual state and any combination of typed questions (noul, choice, score)
 * in a single shared-prefix forward pass to Baseten Mammoth 1 / Elephant 1.
 */
export async function decide<Q extends Record<string, QuestionDef>>(
  state: any,
  questions: Q,
  options?: { customApiKey?: string | undefined; timeoutMs?: number | undefined }
): Promise<DecisionResult<Q> | null> {
  const keys = getOpenRouterDecisionKeys(options?.customApiKey);
  if (keys.length === 0) {
    return null;
  }

  const normalizedQuestions = normalizeQuestionsForOpenRouter(questions);
  const cacheKey = getCacheKey(state, normalizedQuestions);
  if (decisionCache.has(cacheKey)) {
    return decisionCache.get(cacheKey);
  }

  const modelCandidates = Array.from(new Set(DEFAULT_MAMMOTH_CHAIN));
  const timeoutMs = options?.timeoutMs || 4500;

  for (const modelSlug of modelCandidates) {
    const apiKey = nextOpenRouterKey(keys);
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
          model: modelSlug,
          state,
          questions: normalizedQuestions,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // On rate limit (429), payment/free-tier exhaustion (402), or provider error (502/503), try next model/key
        if (res.status === 402 || res.status === 404 || res.status === 429 || res.status >= 500) {
          continue;
        }
        return null;
      }

      const data = (await res.json()) as any;
      if (!data?.answers || typeof data.answers !== "object") {
        continue;
      }

      const elapsed = Date.now() - start;
      const result: DecisionResult<Q> = {
        model: data?.model || modelSlug,
        answers: data.answers,
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
      continue;
    }
  }

  return null;
}

// ==========================================
// Specialized High-Freedom Decision Helpers
// ==========================================

export type AgentSafetyVerdict = {
  requiresApproval: boolean;
  approvalProbability: number;
  /** Human-readable 1..4 severity scale derived from 0-indexed continuous score */
  severityLevel: number;
  intentAligned: boolean;
  rationale: string;
};

/**
 * Full-Context Tool Risk Evaluator (Mutating / Ambiguous Actions Only):
 * Evaluates the semantic relation between what the user/agent is trying to accomplish
 * and what the mutating tool call actually does (Intent Alignment + Blast Radius + Destruction Risk).
 */
export async function evaluateToolRiskWithFullContext(ctx: {
  taskGoal?: string | undefined;
  toolName: string;
  payload: any;
  environment?: string | undefined;
  tenantUserId?: number | null | undefined;
}): Promise<AgentSafetyVerdict | null> {
  const state = {
    taskGoal: ctx.taskGoal || "Autonomous agent operation",
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
      instructions:
        "Does this proposed tool call carry risk of permanent data loss, production service disruption, unauthorized deletion, secret exposure, or irreversible changes that require human sign-off?",
      criteria: {
        true: "Destructive deletion, table drop, database truncate, cloud service teardown, force push, or secret exposure",
        false: "Safe read, routine workspace file write, task/memory update, or non-destructive query aligned with the user's goal",
      },
    },
    severity_score: {
      type: "score",
      instructions:
        "Rate the potential blast radius of this action from lowest (level 0) to highest (level 3)",
      criteria: [
        "Completely safe / read-only or zero blast radius",
        "Low risk / reversible local workspace or memory update",
        "Moderate risk / standard database write or external API action requested by user",
        "Catastrophic / permanent data deletion, schema drop, or production infrastructure kill",
      ],
    },
    intent_aligned: {
      type: "noul",
      instructions:
        "Is this tool call logically aligned with and proportionate to the declared taskGoal?",
      criteria: {
        true: "Directly fulfills or supports the user's stated taskGoal",
        false: "Unrelated, disproportionate, or suspicious side-effect not asked for by the user",
      },
    },
  });

  if (!decision) return null;

  const approvalProb = decision.answers.requires_human_approval?.noul ?? 0;
  // Note: OpenRouter `score` is 0-indexed continuous in [0.0, 3.0]
  const rawScore0To3 = decision.answers.severity_score?.score ?? 0;
  const severityScale1To4 = Number((rawScore0To3 + 1).toFixed(2));
  const intentAligned = (decision.answers.intent_aligned?.noul ?? 1) >= 0.45;

  // Calibrated dynamic threshold:
  // - High explicit approval probability (>= 0.72)
  // - OR severity score approaching Catastrophic index 3 (rawScore0To3 >= 2.35, i.e. >3.35/4)
  // - OR action is NOT aligned with the user's goal AND carries moderate risk (approvalProb >= 0.38 or rawScore0To3 >= 1.8)
  const requiresApproval =
    approvalProb >= 0.72 ||
    rawScore0To3 >= 2.35 ||
    (!intentAligned && (approvalProb >= 0.38 || rawScore0To3 >= 1.8));

  return {
    requiresApproval,
    approvalProbability: approvalProb,
    severityLevel: severityScale1To4,
    intentAligned,
    rationale: `Mammoth 1 Full-Context Audit: ${(approvalProb * 100).toFixed(1)}% risk, severity ${severityScale1To4}/4, intent-aligned=${intentAligned}`,
  };
}

export type ModelTierPreference = "fast" | "code" | "deep-reasoning" | "research" | "frontier";

export interface TurnIntakeDecision {
  tier: ModelTierPreference;
  confidence: number;
  probabilities: Record<ModelTierPreference, number>;
  /** Specialist tool families unlocked semantically by Mammoth 1 */
  unlockedToolFamilies: {
    sqlDb: boolean;
    redisCache: boolean;
    githubOps: boolean;
    cloudOrFullSurface: boolean;
    multiAgentSwarm: boolean;
    schedules: boolean;
  };
  /** Deliverable intents detected semantically in any language (English/Hinglish/Hindi) */
  expectedDeliverables: {
    saveWorkspaceFile: boolean;
    saveMemory: boolean;
    createTaskPlan: boolean;
    createSchedule: boolean;
    dispatchSwarm: boolean;
  };
}

const turnIntakeCache = new Map<string, TurnIntakeDecision>();

/**
 * Synchronous lookup for a previously computed TurnIntakeDecision for `userGoal`.
 * Allows synchronous callers (`selectEnergyEfficientToolsForGoal`, `findUnfulfilledRequestedActions`)
 * to consume Mammoth 1's semantic intake without blocking or changing their sync signatures.
 */
export function getCachedTurnIntakeDecision(userGoal: string): TurnIntakeDecision | undefined {
  const key = userGoal.trim().slice(0, 400);
  return turnIntakeCache.get(key);
}

/**
 * Unified Single-Pass Turn Intake Engine:
 * Uses Mammoth 1's shared-prefix prefill to simultaneously decide:
 *   1. Optimal 5-tier model route (with Brier confidence calibration)
 *   2. Which specialist tool families are needed (eliminating brittle keyword-only pruning)
 *   3. Which deliverables the user expects (eliminating rigid English-only regex blindspots)
 */
export async function analyzeTurnIntakeWithMammoth(
  userQuery: string,
  recentContext?: string | undefined
): Promise<TurnIntakeDecision | null> {
  const trimmed = userQuery.trim();
  if (!trimmed) return null;

  const cacheKey = trimmed.slice(0, 400);
  const existing = turnIntakeCache.get(cacheKey);
  if (existing) return existing;

  const state = {
    userQuery: trimmed.slice(0, 1200),
    recentContext: recentContext?.slice(0, 500) || "None",
  };

  const decision = await decide(state, {
    optimal_tier: {
      type: "choice",
      instructions:
        "Which specialized AI inference tier is best suited to answer or execute this user request?",
      criteria: {
        fast: "Casual conversation, greetings, short factual questions, simple translations, or basic summaries",
        code: "Software engineering, writing or debugging code, AST refactoring, SQL queries, shell scripts, or API integration",
        "deep-reasoning":
          "Complex mathematical proofs, algorithmic optimization, concurrency/race-condition analysis, or deep logical deduction",
        research:
          "Multi-source web research, comprehensive documentation synthesis, literature review, or long-context analysis",
        frontier:
          "High-stakes system architecture, multi-cloud orchestration, ambiguous strategic planning, or flagship multi-step autonomy",
      },
    },
    needs_sql_db: {
      type: "noul",
      instructions:
        "Could answering or fulfilling this request involve inspecting, querying, or modifying a SQL database, tables, schemas, or application records (e.g. users, signups, orders)?",
    },
    needs_redis_cache: {
      type: "noul",
      instructions:
        "Could fulfilling this request involve Redis cache keys, TTLs, memory stats, queues, or rate-limit state?",
    },
    needs_github_ops: {
      type: "noul",
      instructions:
        "Could fulfilling this request involve GitHub repositories, commits, pull requests, branches, issues, or code scanning alerts?",
    },
    needs_cloud_or_media: {
      type: "noul",
      instructions:
        "Could fulfilling this request involve cloud infrastructure (GCP, Cloud Run, Cloudflare, VM), shell/directory inspection, Sentinel health/healing, or video/Kaggle/YouTube automation?",
    },
    needs_multi_agent_swarm: {
      type: "noul",
      instructions:
        "Does the user request or benefit from a multi-agent swarm, sub-agent delegation, or dual-model peer-review consensus?",
    },
    needs_schedules: {
      type: "noul",
      instructions:
        "Does the request involve recurring schedules, watchdogs, periodic monitoring, or cron jobs?",
    },
    expects_workspace_file: {
      type: "noul",
      instructions:
        "Did the user explicitly ask (in English, Hinglish, or Hindi) to save, write, create, draft, or export a file, document, report, or config in their workspace?",
    },
    expects_memory_save: {
      type: "noul",
      instructions:
        "Did the user explicitly ask the agent to remember, store, or save a fact, preference, or project detail into long-term memory?",
    },
    expects_task_plan: {
      type: "noul",
      instructions:
        "Did the user explicitly ask to create a task plan, action checklist, or step-by-step tracker?",
    },
    expects_schedule_creation: {
      type: "noul",
      instructions:
        "Did the user explicitly ask to create or schedule a recurring monitor or periodic watchdog?",
    },
    expects_swarm_dispatch: {
      type: "noul",
      instructions:
        "Did the user explicitly ask to dispatch or run a multi-agent swarm?",
    },
  });

  if (!decision?.answers?.optimal_tier) return null;

  const tierAns = decision.answers.optimal_tier;
  const probs = (tierAns.probabilities || {}) as Record<ModelTierPreference, number>;
  let chosenTier = (tierAns.choice as ModelTierPreference) || "fast";
  const confidence = typeof tierAns.confidence === "number" ? tierAns.confidence : 0.5;

  // Brier Confidence Calibration Promotion:
  // If Mammoth picked "fast" with low confidence (< 0.55), check if a technical/deep tier
  // has substantial probability mass (>= 0.28) so borderline technical prompts aren't under-routed.
  if (chosenTier === "fast" && confidence < 0.55) {
    const specialistTiers: ModelTierPreference[] = ["code", "deep-reasoning", "research", "frontier"];
    let bestSpecialist: ModelTierPreference | null = null;
    let bestProb = 0;
    for (const st of specialistTiers) {
      const p = Number(probs[st] || 0);
      if (p > bestProb) {
        bestProb = p;
        bestSpecialist = st;
      }
    }
    if (bestSpecialist && bestProb >= 0.28) {
      chosenTier = bestSpecialist;
    }
  }

  const intake: TurnIntakeDecision = {
    tier: chosenTier,
    confidence,
    probabilities: probs,
    unlockedToolFamilies: {
      sqlDb: (decision.answers.needs_sql_db?.noul ?? 0) >= 0.25,
      redisCache: (decision.answers.needs_redis_cache?.noul ?? 0) >= 0.25,
      githubOps: (decision.answers.needs_github_ops?.noul ?? 0) >= 0.25,
      cloudOrFullSurface: (decision.answers.needs_cloud_or_media?.noul ?? 0) >= 0.25,
      multiAgentSwarm: (decision.answers.needs_multi_agent_swarm?.noul ?? 0) >= 0.25,
      schedules: (decision.answers.needs_schedules?.noul ?? 0) >= 0.25,
    },
    expectedDeliverables: {
      saveWorkspaceFile: (decision.answers.expects_workspace_file?.noul ?? 0) >= 0.65,
      saveMemory: (decision.answers.expects_memory_save?.noul ?? 0) >= 0.65,
      createTaskPlan: (decision.answers.expects_task_plan?.noul ?? 0) >= 0.65,
      createSchedule: (decision.answers.expects_schedule_creation?.noul ?? 0) >= 0.65,
      dispatchSwarm: (decision.answers.expects_swarm_dispatch?.noul ?? 0) >= 0.65,
    },
  };

  if (turnIntakeCache.size >= 256) {
    const first = turnIntakeCache.keys().next().value;
    if (first) turnIntakeCache.delete(first);
  }
  turnIntakeCache.set(cacheKey, intake);

  return intake;
}

/**
 * Full-Taxonomy Model Router:
 * Delegates to the unified single-pass `analyzeTurnIntakeWithMammoth` engine so routing,
 * tool family unlocking, and deliverable intent detection happen in a single forward pass.
 */
export async function routeOptimalTierWithMammoth(
  userQuery: string,
  recentContext?: string | undefined
): Promise<{
  tier: ModelTierPreference;
  confidence: number;
  probabilities: Record<ModelTierPreference, number>;
} | null> {
  const intake = await analyzeTurnIntakeWithMammoth(userQuery, recentContext);
  if (!intake) return null;
  return {
    tier: intake.tier,
    confidence: intake.confidence,
    probabilities: intake.probabilities,
  };
}

/**
 * Backwards-compatible single-question helpers with normalized OpenRouter schema
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
    ...(options?.true_when || options?.false_when
      ? {
          criteria: {
            true: options?.true_when || "The statement is true.",
            false: options?.false_when || "The statement is false.",
          },
        }
      : {}),
  };

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
 * Evaluates code remediation across safety, technical efficacy score, and risk categorization in one pass.
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
      instructions:
        "Does this code patch safely remediate the security rule violation without introducing regressions, breaking syntax, or new vulnerabilities?",
      criteria: {
        true: "Clean, idiomatic TypeScript/Node.js fix addressing the root cause",
        false: "Broken syntax, unexpected side effects, or security regression",
      },
    },
    risk_choice: {
      type: "choice",
      instructions: "Categorize the primary risk classification of this proposed patch.",
      criteria: {
        safe: "Clean, syntactically sound, verified safe remediation",
        "breaking-change": "Alters public API contract or function signature incompatibly",
        "syntax-error": "Incomplete replacement, unmatched brackets, or malformed syntax",
        "injection-vector": "Introduces unsanitized inputs, shell execution, or security hole",
      },
    },
    efficacy_score: {
      type: "score",
      instructions: "Rate the technical efficacy of this remediation from lowest to highest",
      criteria: [
        "Ineffective or placebo change",
        "Superficial workaround",
        "Solid standard remediation",
        "Optimal, type-safe, production-hardened remediation",
      ],
    },
  });

  if (!decision) return null;

  const isSafeProb = decision.answers.is_safe?.noul ?? 0.5;
  const riskChoice =
    (decision.answers.risk_choice?.choice as
      | "safe"
      | "breaking-change"
      | "syntax-error"
      | "injection-vector") ?? "safe";
  // 0-indexed continuous score [0..3] -> mapped to [1..4] scale
  const efficacy = Number(((decision.answers.efficacy_score?.score ?? 2) + 1).toFixed(2));

  const isSafe = riskChoice === "safe" && efficacy >= 2.0 && isSafeProb >= 0.45;

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
      instructions:
        "Does this educational or documentary script adhere to non-partisan, constructive governance standards (GEMINI.md Rule 11), strictly avoiding aggressive condemnation, fault-finding, or partisan attacks?",
      criteria: {
        true: "Objective, fact-based documentary, educational milestone, or scientific narrative",
        false: "Partisan attack, condemnation ('ninda'), political fault-finding ('kamiyan'), or roasts",
      },
    },
    editorial_category: {
      type: "choice",
      instructions: "What is the primary editorial tone of this script?",
      criteria: {
        "inspiring-documentary": "High-fidelity, fact-based inspiring storytelling",
        "academic-educational": "Structured, educational, historical, or scientific analysis",
        sensationalist: "Clickbait or exaggerated unverified framing",
        "partisan-critique": "Partisan politics, accusations, or attacking political opponents",
      },
    },
    quality_score: {
      type: "score",
      instructions: "Rate the overall editorial quality and journalistic integrity of the script",
      criteria: [
        "Low quality, biased, or partisan",
        "Acceptable but generic",
        "High quality, informative, and engaging",
        "Masterclass documentary journalism",
      ],
    },
  });

  if (!decision) return null;

  const complianceProb = decision.answers.is_compliant?.noul ?? 1.0;
  const category =
    (decision.answers.editorial_category?.choice as
      | "inspiring-documentary"
      | "academic-educational"
      | "partisan-critique"
      | "sensationalist") ?? "inspiring-documentary";
  const quality = Number(((decision.answers.quality_score?.score ?? 2) + 1).toFixed(2));

  const isCompliant =
    category !== "partisan-critique" &&
    category !== "sensationalist" &&
    complianceProb >= 0.50;

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
 * Evaluates diffusion prompts semantically without being gated behind narrow keyword lists.
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
      instructions:
        "Does this image prompt ask the diffusion model to render readable text, letters, scoreboards, banners, signage, equations, or exact numbers inside the image?",
      criteria: {
        true: "Requests written text, quotes, readable signage, scoreboard numbers, slides, or typographic titles",
        false: "Purely visual photography, lighting, scenery, textures, and text-free objects",
      },
    },
    action: {
      type: "choice",
      instructions: "What is the optimal action to maintain zero-diffusion-text compliance?",
      criteria: {
        keep: "Prompt is purely visual and contains zero readable text requirements",
        "replace-with-metaphor": "Replace text/chart/slide items with tactile text-free visual metaphors",
        "blur-background": "Diffuse background signage or scoreboards into bokeh floodlights",
      },
    },
  });

  if (!decision) return null;

  const prob = decision.answers.contains_readable_text_prompt?.noul ?? 0;
  const action =
    (decision.answers.action?.choice as "keep" | "replace-with-metaphor" | "blur-background") ??
    "keep";

  return {
    hasTextAnomaly: action !== "keep" || prob >= 0.55,
    confidence: prob,
    suggestedAction: action,
  };
}

/**
 * Single-Pass Batch Trend Semantic Gate (GEMINI.md Rule 11, Rule 13 & Rule 14):
 * Evaluates top trending candidates in ONE shared-prefix forward pass so scientific topics
 * (like "Asteroid Strike" or "Tectonic Clash") are never blocked by naive word filters, while
 * subtle Hinglish/English political mudslinging and live ongoing matches are accurately caught.
 */
export async function evaluateTrendsWithMammoth(
  candidates: Array<{ title: string; news_title: string; news_snippet?: string | undefined }>
): Promise<Record<number, { isConstructive: boolean; isConcluded: boolean }> | null> {
  if (!candidates.length) return null;
  const batch = candidates.slice(0, 12);
  const state = {
    trends: batch.map((c, idx) => ({
      index: idx,
      title: c.title,
      headline: c.news_title,
      snippet: c.news_snippet || "",
    })),
  };

  const questions: Record<string, QuestionDef> = {};
  for (let i = 0; i < batch.length; i++) {
    questions[`constructive_${i}`] = {
      type: "noul",
      instructions: `Is trend #${i} ("${batch[i]!.title}") suitable for a constructive, non-partisan educational/science/history/infrastructure/sports-milestone documentary (free from crime, arrests, celebrity gossip, or partisan political mudslinging)?`,
      criteria: {
        true: "Science, space, nature, technology, engineering, infrastructure, history, or genuine sports milestone",
        false: "Crime, scandal, arrest, partisan political attack, communal dispute, or celebrity gossip",
      },
    };
    questions[`concluded_${i}`] = {
      type: "noul",
      instructions: `For trend #${i} ("${batch[i]!.title}"), is this either a non-match topic OR a sports match that has ALREADY 100% finished/concluded with a final result (NOT currently live or in-progress)?`,
      criteria: {
        true: "Non-sports topic, or a completed match with a final winner/scorecard",
        false: "A sports match that is currently live, ongoing, in-progress, at toss, or innings break",
      },
    };
  }

  const decision = await decide(state, questions, { timeoutMs: 5000 });
  if (!decision?.answers) return null;

  const out: Record<number, { isConstructive: boolean; isConcluded: boolean }> = {};
  for (let i = 0; i < batch.length; i++) {
    const cProb = (decision.answers[`constructive_${i}`] as any)?.noul;
    const fProb = (decision.answers[`concluded_${i}`] as any)?.noul;
    out[i] = {
      isConstructive: typeof cProb === "number" ? cProb >= 0.40 : true,
      isConcluded: typeof fProb === "number" ? fProb >= 0.45 : true,
    };
  }
  return out;
}
