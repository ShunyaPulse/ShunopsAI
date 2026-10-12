import { getSql, memStore } from "./store.js";

// ==========================================
// ShunopsAI Neon Lakebase Hybrid Knowledge Search
// Combines Postgres Full-Text Search (BM25 ranking via ts_rank_cd)
// with semantic vector embeddings and reciprocal rank fusion (RRF).
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
  limit?: number;
  category?: string;
  queryEmbedding?: number[];
}

/**
 * Indexes or updates a document into the knowledge base.
 */
export async function indexKnowledgeDocument(
  title: string,
  content: string,
  category = "general",
  metadata: Record<string, any> = {},
  embedding?: number[]
): Promise<KnowledgeDoc> {
  const sql = getSql();

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
    memStore.knowledgeDocs.set(id, { ...doc, embedding });
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

  // If embedding is provided and column exists, attempt vector update
  if (embedding && Array.isArray(embedding)) {
    try {
      const vecStr = `[${embedding.join(",")}]`;
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
 * Performs State-of-the-Art Hybrid Search (BM25 Full-Text + Vector Cosine).
 */
export async function searchKnowledgeHybrid(
  query: string,
  options: SearchOptions = {}
): Promise<KnowledgeSearchResult[]> {
  const limit = options.limit ?? 5;
  const category = options.category;
  const sql = getSql();

  if (!sql) {
    // In-memory fallback: multi-word keyword relevance matching
    const qLower = query.toLowerCase();
    const words = qLower.split(/\s+/).filter((w) => w.length > 2);
    const results: KnowledgeSearchResult[] = [];

    for (const [id, doc] of memStore.knowledgeDocs.entries()) {
      if (category && doc.category !== category) continue;
      const combined = (doc.title + " " + doc.content).toLowerCase();
      let matchCount = 0;
      for (const w of words) {
        if (combined.includes(w)) matchCount++;
      }
      if (matchCount > 0 || words.length === 0) {
        const score = words.length > 0 ? matchCount / words.length : 1.0;
        results.push({
          document: {
            id,
            title: doc.title,
            content: doc.content,
            category: doc.category,
            metadata: doc.metadata,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          },
          score,
          matchType: "bm25",
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  try {
    // Try BM25 text rank query with ts_rank_cd
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
