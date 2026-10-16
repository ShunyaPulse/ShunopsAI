import { getSql, memStore } from "./store.js";

// ==========================================
// ShunopsAI SOTA Multi-Tier Hybrid Knowledge Engine
// Combines Postgres Full-Text Search (BM25 ranking via ts_rank_cd)
// with 4-Tier 768-dim Semantic Vector Embeddings + Bounded LRU Cache + RRF:
//   Tier 1: Local Quantized ONNX CPU (`@huggingface/transformers` Xenova/bge-base-en-v1.5)
//   Tier 2: Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, 768-dim)
//   Tier 3: Google Gemini (`text-embedding-004`, 768-dim)
//   Tier 4: Deterministic 768-dim L2-normalized semantic feature-hashing fallback
// ==========================================

export interface KnowledgeDoc {
  id: number;
  title: string;
  content: string;
  category: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  document: KnowledgeDoc;
  score: number;
  matchType: "bm25" | "vector" | "hybrid";
}

export interface SearchOptions {
  limit?: number | undefined;
  category?: string | undefined;
  queryEmbedding?: number[] | undefined;
}

export type EmbeddingTier =
  | "onnx-bge-base-768"
  | "cloudflare-bge-768"
  | "gemini-text-embedding-004"
  | "deterministic-hash-768";

const EMBEDDING_DIM = 768;
const RRF_K = 60;
const MAX_EMBEDDING_CACHE = 512;

// Bounded LRU Embedding Cache (0ms lookup for repeated queries / documents)
const embeddingLruCache = new Map<string, { vector: number[]; tier: EmbeddingTier }>();
let embeddingCacheHits = 0;
let embeddingCacheMisses = 0;
let lastResolvedTier: EmbeddingTier = "deterministic-hash-768";

// Lazy singleton for local quantized ONNX feature-extraction pipeline
let onnxExtractorPromise: Promise<any | null> | null = null;
let onnxAvailable = false;

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
const MAX_DETERMINISTIC_MEMO = 256;
const deterministicEmbeddingMemo = new Map<string, number[]>();

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

  // Tier 1: Local Quantized ONNX CPU Embedding Pipeline (Zero API Cost)
  if (process.env.NODE_ENV !== "test") {
    const onnxExtractor = await getLocalOnnxExtractor();
    if (onnxExtractor) {
      try {
        const output = await onnxExtractor(input, {
          pooling: "mean",
          normalize: true,
        });
        const data = output?.data ? Array.from(output.data as Iterable<number>) : null;
        if (data && data.length === EMBEDDING_DIM) {
          const vec = data.map((v) => Number(v) || 0);
          setCachedEmbedding(input, vec, "onnx-bge-base-768");
          return vec;
        }
      } catch {
        // Fall through to Tier 2
      }
    }
  }

  // Tier 2: Cloudflare Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim)
  const cfAccountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const cfToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (cfAccountId && cfToken && process.env.NODE_ENV !== "test") {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccountId)}/ai/run/@cf/baai/bge-base-en-v1.5`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfToken}`,
          },
          body: JSON.stringify({ text: [input] }),
          signal: AbortSignal.timeout(4000),
        }
      );
      if (res.ok) {
        const payload = (await res.json()) as any;
        const values = payload?.result?.data?.[0];
        if (Array.isArray(values) && values.length === EMBEDDING_DIM) {
          const vec = values.map((v: any) => Number(v) || 0);
          setCachedEmbedding(input, vec, "cloudflare-bge-768");
          return vec;
        }
      }
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: Google Gemini `text-embedding-004` (768-dim)
  const geminiKey = (
    process.env.GEMINI_API_KEY ||
    (process.env.GEMINI_KEYS || "").split(",")[0] ||
    ""
  ).trim();

  if (geminiKey && process.env.NODE_ENV !== "test") {
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
      if (res.ok) {
        const data = (await res.json()) as any;
        const values = data?.embedding?.values;
        if (Array.isArray(values) && values.length === EMBEDDING_DIM) {
          const vec = values.map((v: any) => Number(v) || 0);
          setCachedEmbedding(input, vec, "gemini-text-embedding-004");
          return vec;
        }
      }
    } catch {
      // Fall back to Tier 4 deterministic local 768-dim embedding
    }
  }

  // Tier 4: Deterministic 768-dim L2-normalized feature-hashing fallback
  const fallbackVec = computeDeterministicEmbedding(input);
  setCachedEmbedding(input, fallbackVec, "deterministic-hash-768");
  return fallbackVec;
}

/**
 * Inspect the active SOTA Hybrid Knowledge Engine configuration, embedding cache performance,
 * and document counts.
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
    rrfK: RRF_K,
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
function cosineSimilarity(a?: number[], b?: number[]): number {
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

/**
 * Indexes or updates a document into the knowledge base, automatically generating
 * a 768-dim vector embedding when none is explicitly provided.
 */
export async function indexKnowledgeDocument(
  title: string,
  content: string,
  category = "general",
  metadata: Record<string, any> = {},
  embedding?: number[]
): Promise<KnowledgeDoc> {
  const sql = getSql();
  const resolvedEmbedding =
    embedding && Array.isArray(embedding) && embedding.length > 0
      ? embedding
      : await generateKnowledgeEmbedding(`${title}\n${content}`);

  if (!sql) {
    const id = memStore.nextDocId++;
    const now = new Date().toISOString();
    const doc: KnowledgeDoc = {
      id,
      title,
      content,
      category,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    memStore.knowledgeDocs.set(id, { ...doc, embedding: resolvedEmbedding });
    return doc;
  }

  const metaJson = JSON.stringify(metadata);
  const rows = await (sql as any).query(
    `INSERT INTO shunops_knowledge_documents (title, content, category, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, title, content, category, metadata, created_at, updated_at;`,
    [title, content, category, metaJson]
  );

  const row = rows[0];
  const id = Number(row.id);

  // Persist 768-dim vector embedding when pgvector column is active
  if (resolvedEmbedding && Array.isArray(resolvedEmbedding) && resolvedEmbedding.length === EMBEDDING_DIM) {
    try {
      const vecStr = `[${resolvedEmbedding.join(",")}]`;
      await (sql as any).query(
        `UPDATE shunops_knowledge_documents SET embedding = $1::vector WHERE id = $2;`,
        [vecStr, id]
      );
    } catch {}
  }

  return {
    id,
    title: row.title,
    content: row.content,
    category: row.category,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Performs Hybrid Search combining BM25 Full-Text ranking with 768-dim Vector
 * Cosine Similarity via Reciprocal Rank Fusion (RRF).
 */
export async function searchKnowledgeHybrid(
  query: string,
  options: SearchOptions = {}
): Promise<KnowledgeSearchResult[]> {
  const limit = options.limit ?? 5;
  const category = options.category;
  const sql = getSql();
  const queryEmbedding =
    options.queryEmbedding && options.queryEmbedding.length > 0
      ? options.queryEmbedding
      : await generateKnowledgeEmbedding(query);

  if (!sql) {
    // In-memory Hybrid Search: BM25 lexical score + Vector cosine similarity fused via RRF
    const qLower = query.toLowerCase();
    const words = qLower.split(/\s+/).filter((w) => w.length > 2);

    const candidates: Array<{
      doc: KnowledgeDoc;
      bm25Score: number;
      vecScore: number;
    }> = [];

    for (const [, rawDoc] of memStore.knowledgeDocs.entries()) {
      if (category && rawDoc.category !== category) continue;
      const combined = (rawDoc.title + " " + rawDoc.content).toLowerCase();
      let matchCount = 0;
      for (const w of words) {
        if (combined.includes(w)) matchCount++;
      }
      const bm25Score = words.length > 0 ? matchCount / words.length : combined.includes(qLower) ? 1.0 : 0;
      const docEmbedding: number[] =
        rawDoc.embedding || computeDeterministicEmbedding(`${rawDoc.title}\n${rawDoc.content}`);
      const vecScore = cosineSimilarity(queryEmbedding, docEmbedding);

      if (bm25Score > 0 || vecScore > 0.18) {
        candidates.push({
          doc: {
            id: rawDoc.id,
            title: rawDoc.title,
            content: rawDoc.content,
            category: rawDoc.category,
            metadata: rawDoc.metadata,
            createdAt: rawDoc.createdAt,
            updatedAt: rawDoc.updatedAt,
          },
          bm25Score,
          vecScore,
        });
      }
    }

    if (candidates.length === 0) return [];

    // Rank by BM25 and by Vector Cosine independently, then fuse via RRF
    const byBm25 = [...candidates]
      .filter((c) => c.bm25Score > 0)
      .sort((a, b) => b.bm25Score - a.bm25Score);
    const byVec = [...candidates]
      .filter((c) => c.vecScore > 0.18)
      .sort((a, b) => b.vecScore - a.vecScore);

    const bm25Rank = new Map<number, number>();
    byBm25.forEach((c, idx) => bm25Rank.set(c.doc.id, idx + 1));

    const vecRank = new Map<number, number>();
    byVec.forEach((c, idx) => vecRank.set(c.doc.id, idx + 1));

    const fused: KnowledgeSearchResult[] = candidates.map((c) => {
      const rB = bm25Rank.get(c.doc.id);
      const rV = vecRank.get(c.doc.id);
      const rrfScore =
        (rB ? 1 / (RRF_K + rB) : 0) +
        (rV ? 1 / (RRF_K + rV) : 0) +
        c.bm25Score * 0.5 +
        Math.max(0, c.vecScore) * 0.3;

      const matchType: KnowledgeSearchResult["matchType"] =
        rB && rV ? "hybrid" : rB ? "bm25" : "vector";

      return {
        document: c.doc,
        score: Number(rrfScore.toFixed(4)),
        matchType,
      };
    });

    return fused.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // 1. Try true Postgres Hybrid Search (BM25 ts_rank_cd + pgvector cosine distance fused via RRF)
  if (queryEmbedding && queryEmbedding.length === EMBEDDING_DIM) {
    try {
      const vecStr = `[${queryEmbedding.join(",")}]`;
      const rows = category
        ? await (sql as any).query(
            `WITH bm25_ranked AS (
               SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', $1)) DESC) AS rnk
               FROM shunops_knowledge_documents
               WHERE category = $2 AND (tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%')
               LIMIT 30
             ),
             vector_ranked AS (
               SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) AS rnk
               FROM shunops_knowledge_documents
               WHERE category = $2 AND embedding IS NOT NULL AND (1 - (embedding <=> $3::vector)) > 0.15
               LIMIT 30
             ),
             fused AS (
               SELECT COALESCE(b.id, v.id) AS id,
                      (COALESCE(1.0 / (${RRF_K} + b.rnk), 0.0) + COALESCE(1.0 / (${RRF_K} + v.rnk), 0.0)) AS rrf_score,
                      CASE
                        WHEN b.id IS NOT NULL AND v.id IS NOT NULL THEN 'hybrid'
                        WHEN b.id IS NOT NULL THEN 'bm25'
                        ELSE 'vector'
                      END AS match_type
               FROM bm25_ranked b
               FULL OUTER JOIN vector_ranked v ON b.id = v.id
             )
             SELECT d.id, d.title, d.content, d.category, d.metadata, d.created_at, d.updated_at,
                    f.rrf_score AS rank_score, f.match_type
             FROM fused f
             JOIN shunops_knowledge_documents d ON d.id = f.id
             ORDER BY f.rrf_score DESC
             LIMIT $4;`,
            [query, category, vecStr, limit]
          )
        : await (sql as any).query(
            `WITH bm25_ranked AS (
               SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', $1)) DESC) AS rnk
               FROM shunops_knowledge_documents
               WHERE tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%'
               LIMIT 30
             ),
             vector_ranked AS (
               SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector ASC) AS rnk
               FROM shunops_knowledge_documents
               WHERE embedding IS NOT NULL AND (1 - (embedding <=> $2::vector)) > 0.15
               LIMIT 30
             ),
             fused AS (
               SELECT COALESCE(b.id, v.id) AS id,
                      (COALESCE(1.0 / (${RRF_K} + b.rnk), 0.0) + COALESCE(1.0 / (${RRF_K} + v.rnk), 0.0)) AS rrf_score,
                      CASE
                        WHEN b.id IS NOT NULL AND v.id IS NOT NULL THEN 'hybrid'
                        WHEN b.id IS NOT NULL THEN 'bm25'
                        ELSE 'vector'
                      END AS match_type
               FROM bm25_ranked b
               FULL OUTER JOIN vector_ranked v ON b.id = v.id
             )
             SELECT d.id, d.title, d.content, d.category, d.metadata, d.created_at, d.updated_at,
                    f.rrf_score AS rank_score, f.match_type
             FROM fused f
             JOIN shunops_knowledge_documents d ON d.id = f.id
             ORDER BY f.rrf_score DESC
             LIMIT $3;`,
            [query, vecStr, limit]
          );

      if (Array.isArray(rows) && rows.length > 0) {
        return rows.map((row: any) => ({
          document: {
            id: Number(row.id),
            title: row.title,
            content: row.content,
            category: row.category,
            metadata: row.metadata || {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          score: Number(row.rank_score || 1.0),
          matchType: (row.match_type as KnowledgeSearchResult["matchType"]) || "hybrid",
        }));
      }
    } catch {
      // Fall back to BM25-only query if pgvector extension is unavailable on this DB instance
    }
  }

  try {
    // 2. BM25 text rank query with ts_rank_cd
    const rows = category
      ? await (sql as any).query(
          `SELECT id, title, content, category, metadata, created_at, updated_at,
                  ts_rank_cd(tsv, plainto_tsquery('english', $1)) AS rank_score
           FROM shunops_knowledge_documents
           WHERE category = $2 AND (tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%')
           ORDER BY rank_score DESC
           LIMIT $3;`,
          [query, category, limit]
        )
      : await (sql as any).query(
          `SELECT id, title, content, category, metadata, created_at, updated_at,
                  ts_rank_cd(tsv, plainto_tsquery('english', $1)) AS rank_score
           FROM shunops_knowledge_documents
           WHERE tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%'
           ORDER BY rank_score DESC
           LIMIT $2;`,
          [query, limit]
        );

    return (rows || []).map((row: any) => ({
      document: {
        id: Number(row.id),
        title: row.title,
        content: row.content,
        category: row.category,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      score: Number(row.rank_score || 1.0),
      matchType: "bm25",
    }));
  } catch {
    // Fallback if tsquery encounters syntax anomaly: basic ILIKE substring search
    const rows = await (sql as any).query(
      `SELECT id, title, content, category, metadata, created_at, updated_at
       FROM shunops_knowledge_documents
       WHERE title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%'
       LIMIT $2;`,
      [query, limit]
    );

    return (rows || []).map((row: any) => ({
      document: {
        id: Number(row.id),
        title: row.title,
        content: row.content,
        category: row.category,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      score: 0.5,
      matchType: "bm25",
    }));
  }
}

/**
 * Delete a knowledge document by ID.
 */
export async function deleteKnowledgeDocument(id: number): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    return memStore.knowledgeDocs.delete(id);
  }
  const res = await (sql as any).query(
    `DELETE FROM shunops_knowledge_documents WHERE id = $1 RETURNING id;`,
    [id]
  );
  return (res || []).length > 0;
}
