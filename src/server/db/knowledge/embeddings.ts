import { memStore } from "../store.js";
import type { EmbeddingTier } from "./types.js";

export const EMBEDDING_DIM = 768;

const MAX_EMBEDDING_CACHE = 512;
const MAX_DETERMINISTIC_MEMO = 256;

// Bounded LRU Embedding Cache (0ms lookup for repeated queries / documents)
const embeddingLruCache = new Map<string, { vector: number[]; tier: EmbeddingTier }>();
let embeddingCacheHits = 0;
let embeddingCacheMisses = 0;
let lastResolvedTier: EmbeddingTier = "deterministic-hash-768";

// Lazy singleton for local quantized ONNX feature-extraction pipeline
let onnxExtractorPromise: Promise<any | null> | null = null;
let onnxAvailable = false;

const deterministicEmbeddingMemo = new Map<string, number[]>();

async function getLocalOnnxExtractor(): Promise<any | null> {
  if (
    process.env.ENABLE_LOCAL_ONNX_EMBEDDINGS === "false" ||
    process.env.NODE_ENV === "test"
  ) {
    return null;
  }
  if (!onnxExtractorPromise) {
    onnxExtractorPromise = (async () => {
      try {
        const spec = "@huggingface/transformers";
        const mod: any = await import(/* @vite-ignore */ spec);
        const pipelineFn = mod?.pipeline || mod?.default?.pipeline;
        if (typeof pipelineFn !== "function") return null;
        const modelId =
          process.env.LOCAL_EMBEDDING_MODEL || "Xenova/bge-base-en-v1.5";
        const extractor = await pipelineFn("feature-extraction", modelId, {
          quantized: true,
        });
        onnxAvailable = true;
        return extractor;
      } catch {
        onnxAvailable = false;
        return null;
      }
    })();
  }
  return onnxExtractorPromise;
}

function getCachedEmbedding(key: string): number[] | null {
  const entry = embeddingLruCache.get(key);
  if (!entry) {
    embeddingCacheMisses++;
    return null;
  }
  embeddingCacheHits++;
  // Refresh LRU order
  embeddingLruCache.delete(key);
  embeddingLruCache.set(key, entry);
  return entry.vector;
}

function setCachedEmbedding(key: string, vector: number[], tier: EmbeddingTier): void {
  if (embeddingLruCache.has(key)) {
    embeddingLruCache.delete(key);
  } else if (embeddingLruCache.size >= MAX_EMBEDDING_CACHE) {
    const oldestKey = embeddingLruCache.keys().next().value;
    if (oldestKey !== undefined) {
      embeddingLruCache.delete(oldestKey);
    }
  }
  embeddingLruCache.set(key, { vector, tier });
  lastResolvedTier = tier;
}

/**
 * Deterministic 768-dimensional L2-normalized semantic feature-hashing embedding.
 * Combines normalized word stems, bigrams, and character 3-grams using signed FNV-1a
 * projections so hybrid vector + BM25 RRF works offline and in-memory with zero latency,
 * while remaining compatible with 768-dim BGE / Gemini vectors in pgvector.
 */
export function computeDeterministicEmbedding(text: string): number[] {
  const clean = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return new Array<number>(EMBEDDING_DIM).fill(0);
  }

  const memoKey = clean.slice(0, 500);
  const memoHit = deterministicEmbeddingMemo.get(memoKey);
  if (memoHit) {
    deterministicEmbeddingMemo.delete(memoKey);
    deterministicEmbeddingMemo.set(memoKey, memoHit);
    return memoHit;
  }

  const vec = new Float64Array(EMBEDDING_DIM);

  const tokens = clean.split(" ").filter((t) => t.length > 1);
  const features: Array<{ term: string; weight: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    features.push({ term: `w:${tok}`, weight: 2.0 });
    // Simple suffix stemming for morphological recall (e.g. autoscaling <-> autoscale)
    const stem = tok.replace(/(?:ing|ed|es|s|tion|ment|ly)$/, "");
    if (stem.length >= 3 && stem !== tok) {
      features.push({ term: `s:${stem}`, weight: 1.5 });
    }
    if (i + 1 < tokens.length) {
      features.push({ term: `b:${tok}_${tokens[i + 1]}`, weight: 1.2 });
    }
    // Character 3-grams for subword/typo resilience
    for (let c = 0; c <= tok.length - 3; c++) {
      features.push({ term: `g:${tok.slice(c, c + 3)}`, weight: 0.5 });
    }
  }

  for (const { term, weight } of features) {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < term.length; i++) {
      const code = term.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 ^= code * 31;
      h2 = Math.imul(h2, 1099511627) >>> 0;
    }
    const idx = h1 % EMBEDDING_DIM;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
  }

  let normSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const v = vec[i]!;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq) || 1;
  const out = new Array<number>(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    out[i] = Number((vec[i]! / norm).toFixed(6));
  }
  if (deterministicEmbeddingMemo.size >= MAX_DETERMINISTIC_MEMO) {
    const oldest = deterministicEmbeddingMemo.keys().next().value;
    if (oldest !== undefined) deterministicEmbeddingMemo.delete(oldest);
  }
  deterministicEmbeddingMemo.set(memoKey, out);
  return out;
}

/** Tier 1: local quantized ONNX CPU embedding pipeline (zero API cost). */
async function embedWithOnnx(input: string): Promise<number[] | null> {
  const onnxExtractor = await getLocalOnnxExtractor();
  if (!onnxExtractor) return null;
  try {
    const output = await onnxExtractor(input, { pooling: "mean", normalize: true });
    const data = output?.data ? Array.from(output.data as Iterable<number>) : null;
    if (data && data.length === EMBEDDING_DIM) {
      return data.map((v) => Number(v) || 0);
    }
  } catch {
    // Fall through to the next tier
  }
  return null;
}

/** Tier 2: Cloudflare Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim). */
async function embedWithCloudflare(input: string): Promise<number[] | null> {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !token || process.env.NODE_ENV === "test") return null;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/baai/bge-base-en-v1.5`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: [input] }),
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as any;
    const values = payload?.result?.data?.[0];
    if (Array.isArray(values) && values.length === EMBEDDING_DIM) {
      return values.map((v: any) => Number(v) || 0);
    }
  } catch {
    // Fall through to the next tier
  }
  return null;
}

/** Tier 3: Google Gemini `text-embedding-004` (768-dim). */
async function embedWithGemini(input: string): Promise<number[] | null> {
  const geminiKey = (
    process.env.GEMINI_API_KEY ||
    (process.env.GEMINI_KEYS || "").split(",")[0] ||
    ""
  ).trim();
  if (!geminiKey || process.env.NODE_ENV === "test") return null;

  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: input }] },
        }),
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const values = data?.embedding?.values;
    if (Array.isArray(values) && values.length === EMBEDDING_DIM) {
      return values.map((v: any) => Number(v) || 0);
    }
  } catch {
    // Fall back to the deterministic local embedding
  }
  return null;
}

/**
 * Generates a 768-dimensional embedding vector for a knowledge document or search query.
 * Cascades through:
 *   1. Bounded LRU Cache (0ms)
 *   2. Tier 1: Local Quantized ONNX (`@huggingface/transformers` `Xenova/bge-base-en-v1.5`)
 *   3. Tier 2: Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, 768-dim)
 *   4. Tier 3: Google Gemini (`text-embedding-004`, 768-dim)
 *   5. Tier 4: Deterministic 768-dim L2-normalized feature-hashing vector
 */
export async function generateKnowledgeEmbedding(text: string): Promise<number[]> {
  const input = String(text || "").trim().slice(0, 8000);
  if (!input) return computeDeterministicEmbedding("");

  const cached = getCachedEmbedding(input);
  if (cached) return cached;

  if (process.env.NODE_ENV !== "test") {
    const onnx = await embedWithOnnx(input);
    if (onnx) {
      setCachedEmbedding(input, onnx, "onnx-bge-base-768");
      return onnx;
    }
  }

  const cloudflare = await embedWithCloudflare(input);
  if (cloudflare) {
    setCachedEmbedding(input, cloudflare, "cloudflare-bge-768");
    return cloudflare;
  }

  const gemini = await embedWithGemini(input);
  if (gemini) {
    setCachedEmbedding(input, gemini, "gemini-text-embedding-004");
    return gemini;
  }

  const fallbackVec = computeDeterministicEmbedding(input);
  setCachedEmbedding(input, fallbackVec, "deterministic-hash-768");
  return fallbackVec;
}

/**
 * Inspect the active Hybrid Knowledge Engine configuration, embedding cache
 * performance, and document counts.
 */
export function getKnowledgeStats() {
  const totalLookups = embeddingCacheHits + embeddingCacheMisses;
  const hitRate =
    totalLookups > 0 ? Number(((embeddingCacheHits / totalLookups) * 100).toFixed(1)) : 0;

  const configuredTiers: EmbeddingTier[] = [];
  if (onnxAvailable) configuredTiers.push("onnx-bge-base-768");
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    configuredTiers.push("cloudflare-bge-768");
  }
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_KEYS) {
    configuredTiers.push("gemini-text-embedding-004");
  }
  configuredTiers.push("deterministic-hash-768");

  return {
    activeTier: lastResolvedTier,
    configuredTiers,
    embeddingDimension: EMBEDDING_DIM,
    rrfK: 60,
    cache: {
      size: embeddingLruCache.size,
      maxEntries: MAX_EMBEDDING_CACHE,
      hits: embeddingCacheHits,
      misses: embeddingCacheMisses,
      hitRatePercent: hitRate,
    },
    inMemoryDocumentsCount: memStore.knowledgeDocs.size,
  };
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a?: number[], b?: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
