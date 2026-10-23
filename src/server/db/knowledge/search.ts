import { getSql, memStore } from "../store.js";
import {
  EMBEDDING_DIM,
  computeDeterministicEmbedding,
  cosineSimilarity,
  generateKnowledgeEmbedding,
} from "./embeddings.js";
import type { KnowledgeDoc, KnowledgeSearchResult, SearchOptions } from "./types.js";

const RRF_K = 60;
const VECTOR_MIN_SIMILARITY = 0.18;

function toDoc(row: any): KnowledgeDoc {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    category: row.category,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** In-memory BM25 lexical score + cosine similarity fused with RRF. */
function searchInMemory(
  query: string,
  limit: number,
  category: string | undefined,
  queryEmbedding: number[]
): KnowledgeSearchResult[] {
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

    if (bm25Score > 0 || vecScore > VECTOR_MIN_SIMILARITY) {
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

  const byBm25 = [...candidates]
    .filter((c) => c.bm25Score > 0)
    .sort((a, b) => b.bm25Score - a.bm25Score);
  const byVec = [...candidates]
    .filter((c) => c.vecScore > VECTOR_MIN_SIMILARITY)
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

/**
 * Postgres hybrid search: BM25 ts_rank_cd + pgvector cosine distance fused by RRF.
 * Returns null when pgvector is unavailable or nothing matched, so the caller can
 * degrade to BM25-only.
 */
async function searchPostgresHybrid(
  sql: any,
  query: string,
  limit: number,
  category: string | undefined,
  queryEmbedding: number[]
): Promise<KnowledgeSearchResult[] | null> {
  if (queryEmbedding.length !== EMBEDDING_DIM) return null;
  const vecStr = `[${queryEmbedding.join(",")}]`;

  try {
    const rows = category
      ? await sql.query(
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
      : await sql.query(
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

    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((row: any) => ({
      document: toDoc(row),
      score: Number(row.rank_score || 1.0),
      matchType: (row.match_type as KnowledgeSearchResult["matchType"]) || "hybrid",
    }));
  } catch {
    // Fall back to BM25-only when pgvector is unavailable on this instance
    return null;
  }
}

/** Postgres BM25 ranking, with an ILIKE fallback for tsquery syntax anomalies. */
async function searchPostgresBm25(
  sql: any,
  query: string,
  limit: number,
  category: string | undefined
): Promise<KnowledgeSearchResult[]> {
  try {
    const rows = category
      ? await sql.query(
          `SELECT id, title, content, category, metadata, created_at, updated_at,
                  ts_rank_cd(tsv, plainto_tsquery('english', $1)) AS rank_score
           FROM shunops_knowledge_documents
           WHERE category = $2 AND (tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%')
           ORDER BY rank_score DESC
           LIMIT $3;`,
          [query, category, limit]
        )
      : await sql.query(
          `SELECT id, title, content, category, metadata, created_at, updated_at,
                  ts_rank_cd(tsv, plainto_tsquery('english', $1)) AS rank_score
           FROM shunops_knowledge_documents
           WHERE tsv @@ plainto_tsquery('english', $1) OR title ILIKE '%' || $1 || '%'
           ORDER BY rank_score DESC
           LIMIT $2;`,
          [query, limit]
        );

    return (rows || []).map((row: any) => ({
      document: toDoc(row),
      score: Number(row.rank_score || 1.0),
      matchType: "bm25",
    }));
  } catch {
    const rows = await sql.query(
      `SELECT id, title, content, category, metadata, created_at, updated_at
       FROM shunops_knowledge_documents
       WHERE title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%'
       LIMIT $2;`,
      [query, limit]
    );

    return (rows || []).map((row: any) => ({
      document: toDoc(row),
      score: 0.5,
      matchType: "bm25",
    }));
  }
}

/**
 * Hybrid search combining BM25 full-text ranking with 768-dim vector cosine
 * similarity via Reciprocal Rank Fusion (RRF).
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
    return searchInMemory(query, limit, category, queryEmbedding);
  }

  const hybridResults = await searchPostgresHybrid(sql, query, limit, category, queryEmbedding);
  if (hybridResults) return hybridResults;

  return searchPostgresBm25(sql, query, limit, category);
}
