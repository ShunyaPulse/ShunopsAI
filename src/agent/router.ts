import {
  analyzeTurnIntakeWithMammoth,
  routeOptimalTierWithMammoth,
  type ModelTierPreference,
} from "../ai/decisions.js";
import {
  AGENT_MODELS_CHAIN,
  createClientForTarget,
  type ModelTarget,
  type ProviderKeyOverrides,
} from "./models.js";
import {
  isModelDegraded,
  getModelDegradedInfo,
  getModelBanditTelemetry,
} from "./circuitBreaker.js";

export type ComplexityLevel = "simple" | "complex";

// In-memory cache for prompt complexity classification (LRU-like bounded map)
const complexityCache = new Map<string, ComplexityLevel>();
const MAX_CACHE_SIZE = 256;

/**
 * Fast check for unmistakable trivial greetings/acks (< 8 words) so we never
 * waste a network round-trip to Mammoth-1 on "Hi", "Thanks", or "Ok".
 */
export function isTrivialConversationalTurn(prompt: string): boolean {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const wordCount = p.split(/\s+/).length;
  if (wordCount > 8 || /[{}[\];<>=$`]/.test(p)) return false;

  const trivialPattern =
    /^(hi|hello|hey|namaste|greetings|hola|good\s+(morning|afternoon|evening)|how\s+are\s+you|who\s+are\s+you|what\s+is\s+your\s+name|thank\s+you|thanks|bye|ok|okay|yes|no|haan|nahi|done|great|nice)\b/i;
  return trivialPattern.test(lower);
}

/**
 * Micro-Heuristic Classifier (<0.1ms, zero network calls, zero tokens consumed).
 * Evaluates clear AST, code, debugging, mathematical, and algorithmic signals.
 */
export function classifyHeuristic(prompt: string): ComplexityLevel | null {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const wordCount = p.split(/\s+/).length;

  // 1. Simple conversational greetings & basic pleasantries
  if (isTrivialConversationalTurn(p)) {
    return "simple";
  }

  const complexMarkers = [
    /```[\s\S]*```/, // Code blocks
    /\b(stack trace|uncaught exception|typeerror|referenceerror|syntaxerror|nullpointerexception|traceback|panic:)\b/i,
    /\b(ast|abstract syntax tree|refactor|memory leak|deadlock|race condition|concurrency|mutex)\b/i,
    /\b(vulnerability|cve-\d+|sql injection|xss|csrf|buffer overflow|timing attack|constant-time)\b/i,
    /\b(algorithm|dijkstra|dynamic programming|time complexity|big o|o\(n|np-hard|quicksort)\b/i,
    /\b(create table|foreign key|database migration|schema migration|prisma schema|knex migration)\b/i,
    /\b(regex|regular expression)\b.*\b(pattern|match|group|lookahead|lookbehind)\b/i,
    /\b(dockerfile|docker-compose|kubernetes|k8s manifest|helm chart|github actions workflow)\b/i,
    /\b(write a (typescript|javascript|python|rust|go|c\+\+|java) (function|script|class|module|program))\b/i,
  ];

  for (const marker of complexMarkers) {
    if (marker.test(p)) {
      return "complex";
    }
  }

  // 3. Short casual inquiries (< 18 words without code/math/system keywords)
  if (
    wordCount < 18 &&
    !/[{}[\];<>=$]/.test(p) &&
    /\b(what is|who is|when was|where is|tell me a|joke|quote|translate|rephrase)\b/i.test(lower)
  ) {
    return "simple";
  }

  // 4. Long, detailed multi-step technical instructions (> 90 words with numbering)
  if (wordCount > 90 && /\b(1\.|step 1|first,|firstly)\b/i.test(p)) {
    return "complex";
  }

  return null;
}

/**
 * Classify task complexity:
 * 1. Micro-heuristics (<0.1ms, 0 tokens)
 * 2. Unified Baseten Mammoth 1 intake (if not already attempted)
 * 3. Ultra-lightweight high-capacity LLM fallback (Groq Qwen 27B / Gemini 3.8 Flash) with 4 max tokens and 1.5s timeout.
 */
export async function analyzeTaskComplexity(
  prompt: string,
  overrides?: ProviderKeyOverrides,
  skipMammoth = false
): Promise<ComplexityLevel> {
  const heuristic = classifyHeuristic(prompt);
  if (heuristic) {
    return heuristic;
  }

  const cacheKey = prompt.trim().slice(0, 160);
  const cached = complexityCache.get(cacheKey);
  if (cached) return cached;

  // 1. Try Baseten Mammoth 1 unified intake (only if caller hasn't already invoked it)
  if (!skipMammoth) {
    try {
      const intake = await analyzeTurnIntakeWithMammoth(prompt);
      if (intake) {
        const level: ComplexityLevel = intake.tier === "fast" ? "simple" : "complex";
        if (complexityCache.size >= MAX_CACHE_SIZE) {
          const firstKey = complexityCache.keys().next().value;
          if (firstKey) complexityCache.delete(firstKey);
        }
        complexityCache.set(cacheKey, level);
        return level;
      }
    } catch {}
  }

  const classifierTarget: ModelTarget = overrides?.groqApiKey || process.env.GROQ_API_KEY
    ? { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 27B Classifier" }
    : { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash Classifier" };

  try {
    const client = createClientForTarget(classifierTarget, overrides);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 1500);

    const completion = await client.chat.completions.create(
      {
        model: classifierTarget.model,
        messages: [
          {
            role: "system",
            content:
              "You are a fast complexity classifier. Output exactly one word: 'FAST' for simple, casual, or creative questions, or 'DEEP' for coding, debugging, logic, math, or complex analysis.",
          },
          {
            role: "user",
            content: prompt.slice(0, 500),
          },
        ],
        max_tokens: 4,
        temperature: 0.1,
      },
      { signal: abortController.signal }
    );

    clearTimeout(timeout);

    const answer = completion.choices[0]?.message?.content?.trim().toUpperCase() || "FAST";
    const level: ComplexityLevel = answer.includes("DEEP") ? "complex" : "simple";

    if (complexityCache.size >= MAX_CACHE_SIZE) {
      const firstKey = complexityCache.keys().next().value;
      if (firstKey) complexityCache.delete(firstKey);
    }
    complexityCache.set(cacheKey, level);

    return level;
  } catch {
    return "simple";
  }
}

function dedupeTargets(targets: ModelTarget[]): ModelTarget[] {
  const seen = new Set<string>();
  const out: ModelTarget[] = [];
  for (const t of targets) {
    const key = `${t.provider}:${t.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  for (const m of AGENT_MODELS_CHAIN) {
    const key = `${m.provider}:${m.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

function buildCandidateChain(
  preference: string,
  complexity: ComplexityLevel
): ModelTarget[] {
  const geminiFlash = AGENT_MODELS_CHAIN.filter((m) => m.provider === "gemini");
  const groq120b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "groq" && m.model.includes("120b"));
  const groq27b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "groq" && !m.model.includes("120b"));
  const githubGpt4o = AGENT_MODELS_CHAIN.filter((m) => m.provider === "github" && m.model === "gpt-4o");
  const githubO1 = AGENT_MODELS_CHAIN.filter((m) => m.provider === "github" && m.model === "o1-mini");
  const githubMini = AGENT_MODELS_CHAIN.filter((m) => m.provider === "github" && m.model === "gpt-4o-mini");
  const githubLlama = AGENT_MODELS_CHAIN.filter((m) => m.provider === "github" && m.model.includes("llama"));
  const cloudflareModels = AGENT_MODELS_CHAIN.filter((m) => m.provider === "cloudflare");
  const openRouter550b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter" && m.model.includes("550b"));
  const openRouterLightning = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter" && m.model.includes("lightning"));
  const openRouterCode = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter" && m.model.includes("code"));
  const openRouter70b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter" && m.model.includes("llama-3.3-70b"));
  const openRouterGemma = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter" && m.model.includes("gemma"));
  const openRouterRemaining = AGENT_MODELS_CHAIN.filter(
    (m) =>
      m.provider === "openrouter" &&
      !m.model.includes("550b") &&
      !m.model.includes("lightning") &&
      !m.model.includes("code") &&
      !m.model.includes("llama-3.3-70b") &&
      !m.model.includes("gemma")
  );

  if (preference === "fast" || preference === "gemini-flash") {
    return dedupeTargets([
      ...geminiFlash,
      ...groq27b,
      ...cloudflareModels,
      ...githubMini,
      ...groq120b,
      ...githubGpt4o,
      ...openRouterLightning,
      ...openRouterRemaining,
    ]);
  }

  if (preference === "deep-reasoning" || preference === "groq-120b") {
    return dedupeTargets([
      ...groq120b,
      ...githubO1,
      ...openRouter550b,
      ...openRouter70b,
      ...githubLlama,
      ...geminiFlash,
      ...groq27b,
      ...cloudflareModels,
    ]);
  }

  if (preference === "code" || preference === "code-dev") {
    return dedupeTargets([
      ...githubGpt4o,
      ...openRouterCode,
      ...groq120b,
      ...geminiFlash,
      ...cloudflareModels,
      ...groq27b,
      ...openRouterRemaining,
    ]);
  }

  if (preference === "research" || preference === "research-context") {
    return dedupeTargets([
      ...openRouterLightning,
      ...geminiFlash,
      ...openRouterGemma,
      ...githubLlama,
      ...openRouter550b,
      ...groq120b,
      ...openRouterRemaining,
    ]);
  }

  if (preference === "frontier" || preference === "frontier-master") {
    return dedupeTargets([
      ...githubGpt4o,
      ...openRouter550b,
      ...githubLlama,
      ...groq120b,
      ...geminiFlash,
      ...openRouterRemaining,
    ]);
  }

  if (preference === "openrouter-heavy") {
    return dedupeTargets([
      ...openRouter550b,
      ...openRouter70b,
      ...groq120b,
      ...geminiFlash,
      ...groq27b,
    ]);
  }

  if (preference.includes(":")) {
    const colonIndex = preference.indexOf(":");
    const prefProvider = preference.slice(0, colonIndex);
    const prefModel = preference.slice(colonIndex + 1);
    const chosen = AGENT_MODELS_CHAIN.find(
      (m) => m.provider === prefProvider && m.model === prefModel
    );
    if (chosen) {
      return dedupeTargets([chosen, ...AGENT_MODELS_CHAIN]);
    }
  }

  if (complexity === "complex") {
    return dedupeTargets([
      ...groq120b,
      ...githubO1,
      ...openRouter550b,
      ...githubGpt4o,
      ...openRouterCode,
      ...geminiFlash,
      ...groq27b,
      ...cloudflareModels,
    ]);
  }

  return dedupeTargets([
    ...geminiFlash,
    ...groq27b,
    ...cloudflareModels,
    ...githubMini,
    ...groq120b,
    ...openRouterRemaining,
  ]);
}

export interface IndividualModelStatus {
  id: string;
  provider: "groq" | "gemini" | "openrouter" | "github" | "cloudflare";
  model: string;
  name: string;
  healthy: boolean;
  degraded: boolean;
  cooldownRemainingSeconds?: number | undefined;
  reason?: string | undefined;
  ewmaLatencyMs?: number | undefined;
  successRatePercent?: number | undefined;
  totalCalls?: number | undefined;
  banditScore?: number | undefined;
}

export async function getModelsHealthStatus(): Promise<IndividualModelStatus[]> {
  const list: IndividualModelStatus[] = [];
  for (const m of AGENT_MODELS_CHAIN) {
    const info = await getModelDegradedInfo(m.provider, m.model);
    const bandit = getModelBanditTelemetry(m.provider, m.model);
    list.push({
      id: `${m.provider}:${m.model}`,
      provider: m.provider,
      model: m.model,
      name: m.name,
      healthy: !info.degraded,
      degraded: Boolean(info.degraded),
      cooldownRemainingSeconds: info.remainingSeconds,
      reason: info.reason,
      ewmaLatencyMs: bandit.ewmaLatencyMs,
      successRatePercent: bandit.successRatePercent,
      totalCalls: bandit.totalCalls,
      banditScore: bandit.banditScore,
    });
  }
  return list;
}

/**
 * Green Energy Efficiency Bonus:
 * For simple queries, rewards ultra-low-wattage SRAM LPUs (Groq 27B), Flash/MoE models (Gemini Flash),
 * and Serverless Edge models without altering complex reasoning priority.
 */
function computeGreenEfficiencyBonus(target: ModelTarget, complexity: ComplexityLevel): number {
  if (complexity === "complex") return 0;
  if (target.provider === "groq" && target.model.includes("27b")) return 6;
  if (target.provider === "gemini" && target.model.includes("flash")) return 6;
  if (target.provider === "cloudflare" && target.model.includes("8b")) return 5;
  if (target.provider === "github" && target.model.includes("mini")) return 4;
  return 0;
}

export async function getRoutingTargets(
  preference: string = "auto",
  message: string,
  overrides?: ProviderKeyOverrides
): Promise<{ targets: ModelTarget[]; routedComplexity: ComplexityLevel; preference: string }> {
  let effectivePreference = preference;
  let complexity: ComplexityLevel = "simple";
  let mammothAttempted = false;

  if (preference === "auto") {
    // 1. Zero-latency bypass for unmistakable trivial greetings ("Hi", "Thanks", "Ok")
    if (isTrivialConversationalTurn(message)) {
      effectivePreference = "fast";
      complexity = "simple";
    } else {
      // 2. Single-pass 5-tier classification + tool/deliverable intake via Baseten Mammoth 1
      mammothAttempted = true;
      try {
        const mammothTier = await determineOptimalPreferenceWithMammoth(message);
        if (mammothTier) {
          effectivePreference = mammothTier;
          complexity = mammothTier === "fast" ? "simple" : "complex";
        }
      } catch {}
    }
  }

  if (effectivePreference === "auto") {
    // Pass skipMammoth = mammothAttempted so we NEVER call Mammoth twice on the same message
    complexity = await analyzeTaskComplexity(message, overrides, mammothAttempted);
  }

  const candidates = buildCandidateChain(effectivePreference, complexity);

  const healthy: Array<{ target: ModelTarget; idx: number; banditScore: number }> = [];
  const degraded: ModelTarget[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const target = candidates[i]!;
    const isDegraded = await isModelDegraded(target.provider, target.model);
    if (isDegraded) {
      degraded.push(target);
    } else {
      const bandit = getModelBanditTelemetry(target.provider, target.model);
      const greenBonus = computeGreenEfficiencyBonus(target, complexity);
      healthy.push({ target, idx: i, banditScore: bandit.banditScore + greenBonus });
    }
  }

  // Stage 8 Adaptive Bandit Re-ranking within same-provider adjacent candidates:
  for (let i = 0; i < healthy.length - 1; i++) {
    const curr = healthy[i]!;
    const next = healthy[i + 1]!;
    if (
      curr.target.provider === next.target.provider &&
      next.banditScore - curr.banditScore >= 8
    ) {
      healthy[i] = next;
      healthy[i + 1] = curr;
    }
  }

  const orderedHealthy = healthy.map((h) => h.target);
  const targets = orderedHealthy.length > 0 ? [...orderedHealthy, ...degraded] : degraded;

  return {
    targets: targets.length > 0 ? targets : AGENT_MODELS_CHAIN,
    routedComplexity: complexity,
    preference,
  };
}

/**
 * Unconstrained Full-Taxonomy Router using Baseten Mammoth 1:
 * Classifies queries directly across all 5 specialized tiers (fast, code, deep-reasoning, research, frontier)
 * returning calibrated probabilities and confidence.
 */
export async function determineOptimalPreferenceWithMammoth(
  userQuery: string,
  recentContext?: string
): Promise<ModelTierPreference | null> {
  const result = await routeOptimalTierWithMammoth(userQuery, recentContext);
  return result ? result.tier : null;
}
