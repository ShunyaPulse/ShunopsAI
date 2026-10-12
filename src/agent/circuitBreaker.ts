import { getRedisClient } from "../server/redis.js";

// ==========================================
// ShunopsAI Passive Model Circuit Breaker
// Invariant: ZERO SYNTHETIC PINGS/PROBES (Zero Quota Drain)
// State is updated strictly passively from in-flight inference responses.
// Cooldown state is shared globally across runners via Redis with local TTL fallback.
// ==========================================

export interface DegradedState {
  degraded: boolean;
  degradedAt?: number | undefined;
  cooldownSeconds?: number | undefined;
  remainingSeconds?: number | undefined;
  status?: string | number | undefined;
  reason?: string | undefined;
}

export interface TierHealthStatus {
  tierId: "auto" | "gemini-flash" | "groq-120b" | "code-dev" | "research-context" | "openrouter-heavy" | string;
  name: string;
  healthy: boolean;
  degraded: boolean;
  cooldownRemainingSeconds?: number | undefined;
  reason?: string | undefined;
}

const REDIS_KEY_PREFIX = "shunops:cb:model:";

// In-memory fallback map for environments without active Redis or local offline runners
interface MemoryEntry {
  expiry: number;
  status: string | number;
  reason: string;
}
const inMemoryCooldowns = new Map<string, MemoryEntry>();

function getModelKey(provider: string, model: string): string {
  return `${provider.toLowerCase().trim()}:${model.toLowerCase().trim()}`;
}

/**
 * Record a passive failure observed during real user/task inference.
 * Strictly passive - no synthetic probes sent.
 */
export async function recordCircuitBreakerFailure(
  provider: string,
  model: string,
  statusCode: number | string = "Error",
  errorMessage?: string
): Promise<void> {
  const code = String(statusCode);
  const isRateLimit = code === "429" || code.toLowerCase().includes("rate");
  const isServerUnavailable = code === "503" || code === "502" || code === "504" || code === "500";
  const isTimeout = code.toLowerCase().includes("timeout") || code.toLowerCase().includes("econnrefused");

  // Only trip circuit breaker on transient provider capacity/availability failures (not 400 bad prompt / tool syntax)
  if (!isRateLimit && !isServerUnavailable && !isTimeout) {
    return;
  }

  // Cooldown durations: 180s for 429 rate-limits, 90s for 503/timeout
  const cooldownSeconds = isRateLimit ? 180 : 90;
  const reason = isRateLimit
    ? `Provider rate limit (429): ${errorMessage || "Quota throttled"}`
    : `Provider unavailable (${code}): ${errorMessage || "Service error"}`;

  const modelKey = getModelKey(provider, model);
  const redis = getRedisClient();

  if (redis && redis.status === "ready") {
    try {
      const payload = JSON.stringify({
        degradedAt: Date.now(),
        cooldownSeconds,
        status: code,
        reason,
      });
      await redis.set(`${REDIS_KEY_PREFIX}${modelKey}`, payload, "EX", cooldownSeconds);
    } catch {
      // Non-fatal, fallback to memory
    }
  }

  // Always update in-memory cache as well
  inMemoryCooldowns.set(modelKey, {
    expiry: Date.now() + cooldownSeconds * 1000,
    status: code,
    reason,
  });
}

/**
 * Record a successful inference completion for a model.
 * Clears degraded status immediately in both Redis and memory.
 */
export async function recordCircuitBreakerSuccess(
  provider: string,
  model: string
): Promise<void> {
  const modelKey = getModelKey(provider, model);
  inMemoryCooldowns.delete(modelKey);

  const redis = getRedisClient();
  if (redis && redis.status === "ready") {
    try {
      await redis.del(`${REDIS_KEY_PREFIX}${modelKey}`);
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Check if a model is currently in degraded / rate-limited cooldown.
 * ZERO OUTBOUND LLM REQUESTS.
 */
export async function isModelDegraded(
  provider: string,
  model: string
): Promise<boolean> {
  const info = await getModelDegradedInfo(provider, model);
  return info.degraded;
}

/**
 * Get detailed degraded status with remaining cooldown seconds.
 * ZERO OUTBOUND LLM REQUESTS.
 */
export async function getModelDegradedInfo(
  provider: string,
  model: string
): Promise<DegradedState> {
  const modelKey = getModelKey(provider, model);
  const redis = getRedisClient();

  if (redis && redis.status === "ready") {
    try {
      const data = await redis.get(`${REDIS_KEY_PREFIX}${modelKey}`);
      if (data) {
        const parsed = JSON.parse(data);
        const ttl = await redis.ttl(`${REDIS_KEY_PREFIX}${modelKey}`);
        const remainingSeconds = ttl > 0 ? ttl : Math.max(0, Math.ceil((parsed.degradedAt + parsed.cooldownSeconds * 1000 - Date.now()) / 1000));
        return {
          degraded: true,
          degradedAt: parsed.degradedAt,
          cooldownSeconds: parsed.cooldownSeconds,
          remainingSeconds,
          status: parsed.status,
          reason: parsed.reason,
        };
      }
    } catch {
      // Fallback to in-memory check
    }
  }

  // In-memory fallback
  const mem = inMemoryCooldowns.get(modelKey);
  if (mem) {
    if (Date.now() < mem.expiry) {
      const remainingSeconds = Math.ceil((mem.expiry - Date.now()) / 1000);
      return {
        degraded: true,
        remainingSeconds,
        status: mem.status,
        reason: mem.reason,
      };
    } else {
      inMemoryCooldowns.delete(modelKey);
    }
  }

  return { degraded: false };
}

/**
 * Clean up expired memory entries periodically.
 */
export function purgeExpiredMemoryCooldowns(): void {
  const now = Date.now();
  for (const [key, val] of inMemoryCooldowns.entries()) {
    if (now >= val.expiry) {
      inMemoryCooldowns.delete(key);
    }
  }
}

/**
 * Inspect health across key model tiers for the UI dropdown and auto-router.
 * Invariant: ZERO SYNTHETIC PINGS TO LLMS. Strictly passive cached state inspection.
 */
export async function getTiersHealthStatus(): Promise<TierHealthStatus[]> {
  purgeExpiredMemoryCooldowns();

  // Tier 1: Gemini 3.8 Flash
  const flashPrimary = await getModelDegradedInfo("gemini", "gemini-3.8-flash");
  const flashPreview = await getModelDegradedInfo("gemini", "gemini-3-flash-preview");
  const isFlashDegraded = flashPrimary.degraded && flashPreview.degraded;
  const flashCooldown = Math.max(flashPrimary.remainingSeconds || 0, flashPreview.remainingSeconds || 0);

  // Tier 2: Groq GPT-OSS 120B (High Reasoning)
  const groq120b = await getModelDegradedInfo("groq", "openai/gpt-oss-120b");

  // Tier 3: Code & Dev (GitHub GPT-4o & Cohere Code)
  const githubGpt4o = await getModelDegradedInfo("github", "gpt-4o");
  const cohereCode = await getModelDegradedInfo("openrouter", "cohere/north-mini-code:free");
  const isCodeDegraded = githubGpt4o.degraded && cohereCode.degraded;
  const codeCooldown = Math.max(githubGpt4o.remainingSeconds || 0, cohereCode.remainingSeconds || 0);

  // Tier 4: Long Context & Research (Nemotron 3.5 Lightning 1M)
  const lightning1m = await getModelDegradedInfo("openrouter", "nvidia/nemotron-3.5-lightning:free");
  const isResearchDegraded = lightning1m.degraded && flashPrimary.degraded;
  const researchCooldown = Math.max(lightning1m.remainingSeconds || 0, flashPrimary.remainingSeconds || 0);

  // Tier 5: OpenRouter Heavyweights & Frontier (550B & 70B)
  const openRouter550b = await getModelDegradedInfo("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free");
  const openRouter70b = await getModelDegradedInfo("openrouter", "meta-llama/llama-3.3-70b-instruct:free");
  const isOpenRouterDegraded = openRouter550b.degraded && openRouter70b.degraded;
  const openRouterCooldown = Math.max(openRouter550b.remainingSeconds || 0, openRouter70b.remainingSeconds || 0);

  // Auto is healthy if at least one tier is available
  const anyHealthy = !isFlashDegraded || !groq120b.degraded || !isOpenRouterDegraded || !isCodeDegraded;

  return [
    {
      tierId: "auto",
      name: "⚡ Auto: Smart Adaptive (Auto-Routes & Self-Heals)",
      healthy: anyHealthy,
      degraded: !anyHealthy,
      cooldownRemainingSeconds: anyHealthy ? undefined : Math.min(flashCooldown || 60, groq120b.remainingSeconds || 60),
      reason: anyHealthy ? undefined : "All upstream model backbones are temporarily in cooldown.",
    },
    {
      tierId: "gemini-flash",
      name: "🚀 Fast & Responsive: Quick Q&A (Low Quota Usage)",
      healthy: !isFlashDegraded,
      degraded: isFlashDegraded,
      cooldownRemainingSeconds: isFlashDegraded ? flashCooldown : undefined,
      reason: isFlashDegraded ? (flashPrimary.reason || "Flash tier rate limited") : undefined,
    },
    {
      tierId: "groq-120b",
      name: "🧠 Deep Reasoning & Math: 120B AST (Heavy Quota ⚠️)",
      healthy: !groq120b.degraded,
      degraded: groq120b.degraded,
      cooldownRemainingSeconds: groq120b.degraded ? groq120b.remainingSeconds : undefined,
      reason: groq120b.degraded ? (groq120b.reason || "Groq 120B reasoning model rate limited") : undefined,
    },
    {
      tierId: "code-dev",
      name: "💻 Code Architect & Debugging: GPT-4o & AST (Balanced)",
      healthy: !isCodeDegraded,
      degraded: isCodeDegraded,
      cooldownRemainingSeconds: isCodeDegraded ? codeCooldown : undefined,
      reason: isCodeDegraded ? "Coding models rate limited" : undefined,
    },
    {
      tierId: "research-context",
      name: "📚 Long Context & Research: 1M Window (Balanced)",
      healthy: !isResearchDegraded,
      degraded: isResearchDegraded,
      cooldownRemainingSeconds: isResearchDegraded ? researchCooldown : undefined,
      reason: isResearchDegraded ? "1M context model rate limited" : undefined,
    },
    {
      tierId: "openrouter-heavy",
      name: "👑 Frontier Flagship: 550B & GPT-4o (Heavy Quota ⚠️)",
      healthy: !isOpenRouterDegraded,
      degraded: isOpenRouterDegraded,
      cooldownRemainingSeconds: isOpenRouterDegraded ? openRouterCooldown : undefined,
      reason: isOpenRouterDegraded ? (openRouter550b.reason || "Frontier heavyweights rate limited") : undefined,
    },
  ];
}
