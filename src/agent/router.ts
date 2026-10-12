import {
  AGENT_MODELS_CHAIN,
  createClientForTarget,
  type ModelTarget,
  type ProviderKeyOverrides,
} from "./models.js";
import { isModelDegraded } from "./circuitBreaker.js";

export type ComplexityLevel = "simple" | "complex";

// In-memory cache for prompt complexity classification (LRU-like bounded map)
const complexityCache = new Map<string, ComplexityLevel>();
const MAX_CACHE_SIZE = 256;

/**
 * Micro-Heuristic Classifier (<0.1ms, zero network calls, zero tokens consumed).
 * Evaluates clear AST, code, debugging, mathematical, and algorithmic signals.
 */
export function classifyHeuristic(prompt: string): ComplexityLevel | null {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const wordCount = p.split(/\s+/).length;

  // 1. Simple conversational greetings & basic pleasantries
  const simpleGreetingPrefix = /^(hi|hello|hey|namaste|greetings|hola|good\s+(morning|afternoon|evening)|how\s+are\s+you|who\s+are\s+you|what\s+is\s+your\s+name|thank\s+you|thanks|bye|help\s+me)\b/i;
  if (wordCount <= 8 && simpleGreetingPrefix.test(lower)) {
    return "simple";
  }

  // 2. High-complexity signals (AST, code, security, debugging, stack traces, database schema, math)
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

  // 3. Short casual inquiries (< 20 words without code/math)
  if (
    wordCount < 20 &&
    !/[{}[\];<>=$]/.test(p) &&
    /\b(what is|who is|when was|where is|tell me a|joke|quote|draft|translate|rephrase|summarize)\b/i.test(lower)
  ) {
    return "simple";
  }

  // 4. Long, detailed multi-step technical instructions (> 90 words with numbering)
  if (wordCount > 90 && /\b(1\.|step 1|first,|firstly)\b/i.test(p)) {
    return "complex";
  }

  return null; // Ambiguous: defer to lightweight classifier
}

/**
 * Classify task complexity:
 * 1. Micro-heuristics (<0.1ms, 0 tokens)
 * 2. Ultra-lightweight high-capacity LLM fallback (Groq Qwen 27B / Gemini 3.8 Flash) with 4 max tokens and 1.5s timeout.
 */
export async function analyzeTaskComplexity(
  prompt: string,
  overrides?: ProviderKeyOverrides
): Promise<ComplexityLevel> {
  const heuristic = classifyHeuristic(prompt);
  if (heuristic) {
    return heuristic;
  }

  // Check cache
  const cacheKey = prompt.trim().slice(0, 160);
  const cached = complexityCache.get(cacheKey);
  if (cached) return cached;

  // Ambiguous prompt: invoke very-lightweight high-capacity classifier (Groq Qwen 27B or Gemini Flash)
  const classifierTarget: ModelTarget = overrides?.groqApiKey || process.env.GROQ_API_KEY
    ? { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 27B Classifier" }
    : { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash Classifier" };

  try {
    const client = createClientForTarget(classifierTarget, overrides);

    // Bounded timeout (1500ms max) so classification never introduces noticeable latency
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
    // Fail-fast fallback to 'simple' with zero disruption
    return "simple";
  }
}

/**
 * Build candidate chain prioritized according to task complexity and user preference.
 */
function buildCandidateChain(
  preference: string,
  complexity: ComplexityLevel
): ModelTarget[] {
  const geminiFlash = AGENT_MODELS_CHAIN.filter((m) => m.provider === "gemini");
  const groq120b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "groq" && m.model.includes("120b"));
  const groq27b = AGENT_MODELS_CHAIN.filter((m) => m.provider === "groq" && !m.model.includes("120b"));
  const openRouterHeavy = AGENT_MODELS_CHAIN.filter((m) => m.provider === "openrouter");

  if (preference === "gemini-flash") {
    return [...geminiFlash, ...groq27b, ...groq120b, ...openRouterHeavy];
  }

  if (preference === "groq-120b") {
    return [...groq120b, ...groq27b, ...openRouterHeavy, ...geminiFlash];
  }

  if (preference === "openrouter-heavy") {
    return [...openRouterHeavy, ...groq120b, ...geminiFlash, ...groq27b];
  }

  // 'auto' mode: Smart Complexity-Based Priority
  if (complexity === "complex") {
    // GEMINI.md Rule 1: Heavyweight Reasoning & AST Debugging Backbones:
    // Groq 120B reasoning -> OpenRouter Heavyweights -> Gemini Flash -> Groq 27B
    return [...groq120b, ...openRouterHeavy, ...geminiFlash, ...groq27b];
  }

  // Simple tasks: Fast zero-latency models first:
  // Gemini 3.8 Flash -> Groq 27B -> Groq 120B -> OpenRouter Heavyweights
  return [...geminiFlash, ...groq27b, ...groq120b, ...openRouterHeavy];
}

/**
 * Resolve execution targets with Circuit Breaker Awareness:
 * Automatically skips or deprioritizes models currently in rate-limit/error cooldown.
 */
export async function getRoutingTargets(
  preference: string = "auto",
  message: string,
  overrides?: ProviderKeyOverrides
): Promise<{ targets: ModelTarget[]; routedComplexity: ComplexityLevel; preference: string }> {
  const complexity = await analyzeTaskComplexity(message, overrides);
  const candidates = buildCandidateChain(preference, complexity);

  // Partition candidates based on passive circuit breaker status
  const healthy: ModelTarget[] = [];
  const degraded: ModelTarget[] = [];

  for (const target of candidates) {
    const isDegraded = await isModelDegraded(target.provider, target.model);
    if (isDegraded) {
      degraded.push(target);
    } else {
      healthy.push(target);
    }
  }

  // Put healthy models first; keep degraded models at the end only as absolute last resort
  const targets = healthy.length > 0 ? [...healthy, ...degraded] : degraded;

  return {
    targets: targets.length > 0 ? targets : AGENT_MODELS_CHAIN,
    routedComplexity: complexity,
    preference,
  };
}
