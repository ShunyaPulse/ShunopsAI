import { getSql, memStore } from "../store.js";
import { EMBEDDING_DIM, generateKnowledgeEmbedding } from "./embeddings.js";
import type { KnowledgeDoc } from "./types.js";

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
  if (Array.isArray(resolvedEmbedding) && resolvedEmbedding.length === EMBEDDING_DIM) {
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

/** Delete a knowledge document by ID. */
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
