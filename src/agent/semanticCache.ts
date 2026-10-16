import { computeDeterministicEmbedding } from "../server/db/knowledge.js";

// ==========================================
// ShunopsAI Stage 8 SOTA: Zero-Cost Semantic Prompt & Response Cache
// - Tenant-isolated (`scopeKey`: `user:<id>` vs `anon`) so cached answers NEVER cross tenants
// - 768-dimensional L2-normalized semantic vector cosine similarity lookup (<0.5ms)
// - Automatic bypass for live/mutable operational queries (scan, heal, deploy, status, etc.)
// - Bounded LRU eviction (`MAX_CACHE_ENTRIES = 256`) and 10-minute TTL
// ==========================================

export interface SemanticCacheEntry {
  id: string;
  scopeKey: string;
  preference: string;
  prompt: string;
  embedding: number[];
  reply: string;
  usedModel: string;
  routedComplexity: "simple" | "complex";
  promptTokens: number;
  completionTokens: number;
  createdAtMs: number;
  expiresAtMs: number;
  hitCount: number;
}

export interface SemanticCacheHit {
  entry: SemanticCacheEntry;
  similarity: number;
}

const MAX_CACHE_ENTRIES = 256;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_SIMILARITY_THRESHOLD = 0.94;

const cacheStore = new Map<string, SemanticCacheEntry>();

let cacheHits = 0;
let cacheMisses = 0;
let savedPromptTokens = 0;
let savedCompletionTokens = 0;

/**
 * Operational, time-sensitive, or state-mutating queries must NEVER be served from
 * semantic cache so live telemetry, database queries, and deployments always run fresh.
 */
const LIVE_OPERATIONAL_QUERY_RE =
  /\b(?:now|current|currently|today|tonight|live|latest|status|scan|sentinel|heal|ping|execute|run|deploy|delete|remove|drop|insert|update|create|write|save|read|list|append|file|files|task|tasks|todo|plan|checklist|remember|recall|forget|memory|memories|search|lookup|fetch|inspect|url|http|https|calculate|compute|solve|script|revoke|promote|demote|approve|reject|otp|password|token|secret|key|time|date|weather|stock|price|random|uuid)\b/i;

export function isCacheablePrompt(prompt: string, hasImage = false): boolean {
  if (hasImage) return false;
  const clean = String(prompt || "").trim();
  if (clean.length < 8 || clean.length > 2000) return false;
  if (LIVE_OPERATIONAL_QUERY_RE.test(clean)) return false;
  return true;
}

function dotProductNormalized(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

function resolveThreshold(): number {
  const raw = Number(process.env.SEMANTIC_CACHE_THRESHOLD);
  if (Number.isFinite(raw) && raw >= 0.75 && raw <= 0.999) {
    return raw;
  }
  return DEFAULT_SIMILARITY_THRESHOLD;
}

/**
 * Look up a semantically equivalent cached response within the caller's isolated tenant scope.
 */
export function lookupSemanticCache(
  prompt: string,
  scopeKey: string,
  preference = "auto",
  hasImage = false
): SemanticCacheHit | null {
  if (process.env.DISABLE_SEMANTIC_CACHE === "true") {
    return null;
  }
  if (!isCacheablePrompt(prompt, hasImage)) {
    cacheMisses++;
    return null;
  }

  const now = Date.now();
  const threshold = resolveThreshold();
  const queryVec = computeDeterministicEmbedding(prompt);

  let bestMatch: SemanticCacheEntry | null = null;
  let bestSim = 0;

  for (const [key, entry] of cacheStore.entries()) {
    if (now >= entry.expiresAtMs) {
      cacheStore.delete(key);
      continue;
    }
    if (entry.scopeKey !== scopeKey || entry.preference !== preference) {
      continue;
    }
    const sim = dotProductNormalized(queryVec, entry.embedding);
    if (sim >= threshold && sim > bestSim) {
      bestSim = sim;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    cacheHits++;
    bestMatch.hitCount++;
    savedPromptTokens += bestMatch.promptTokens;
    savedCompletionTokens += bestMatch.completionTokens;
    // Refresh LRU position
    cacheStore.delete(bestMatch.id);
    cacheStore.set(bestMatch.id, bestMatch);
    return {
      entry: bestMatch,
      similarity: Number(bestSim.toFixed(4)),
    };
  }

  cacheMisses++;
  return null;
}

/**
 * Store a successful response in the tenant-scoped semantic cache.
 */
export function storeSemanticCache(params: {
  prompt: string;
  scopeKey: string;
  preference?: string;
  reply: string;
  usedModel: string;
  routedComplexity: "simple" | "complex";
  promptTokens: number;
  completionTokens: number;
  ttlMs?: number;
  hasImage?: boolean;
}): void {
  if (process.env.DISABLE_SEMANTIC_CACHE === "true") return;
  if (!isCacheablePrompt(params.prompt, Boolean(params.hasImage))) return;
  if (!params.reply || params.reply.length < 10) return;

  const now = Date.now();
  const preference = params.preference || "auto";
  const embedding = computeDeterministicEmbedding(params.prompt);
  const id = `${params.scopeKey}:${preference}:${params.prompt.trim().toLowerCase().slice(0, 120)}`;

  if (cacheStore.has(id)) {
    cacheStore.delete(id);
  } else if (cacheStore.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cacheStore.keys().next().value;
    if (oldestKey !== undefined) {
      cacheStore.delete(oldestKey);
    }
  }

  cacheStore.set(id, {
    id,
    scopeKey: params.scopeKey,
    preference,
    prompt: params.prompt.trim(),
    embedding,
    reply: params.reply,
    usedModel: params.usedModel,
    routedComplexity: params.routedComplexity,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    createdAtMs: now,
    expiresAtMs: now + (params.ttlMs ?? DEFAULT_TTL_MS),
    hitCount: 0,
  });
}

/**
 * Inspect live Semantic Cache hit rate and token savings.
 */
export function getSemanticCacheStats() {
  const totalLookups = cacheHits + cacheMisses;
  const hitRatePercent =
    totalLookups > 0 ? Number(((cacheHits / totalLookups) * 100).toFixed(1)) : 0;
  return {
    enabled: process.env.DISABLE_SEMANTIC_CACHE !== "true",
    similarityThreshold: resolveThreshold(),
    size: cacheStore.size,
    maxEntries: MAX_CACHE_ENTRIES,
    hits: cacheHits,
    misses: cacheMisses,
    hitRatePercent,
    savedPromptTokens,
    savedCompletionTokens,
    savedTotalTokens: savedPromptTokens + savedCompletionTokens,
  };
}

/**
 * Clear all semantic cache entries (used in tests or admin cache flush).
 */
export function clearSemanticCache(): void {
  cacheStore.clear();
}
