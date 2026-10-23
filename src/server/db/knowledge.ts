/**
 * Hybrid Knowledge Engine barrel.
 *
 * Implementation lives in `./knowledge/`:
 * - `types`      — document, result and option types
 * - `embeddings` — 4-tier 768-dim embedding cascade, LRU cache and stats
 * - `indexing`   — document indexing and deletion
 * - `search`     — in-memory RRF, Postgres hybrid SQL and BM25 fallback
 */
export type {
  EmbeddingTier,
  KnowledgeDoc,
  KnowledgeSearchResult,
  SearchOptions,
} from "./knowledge/types.js";
export {
  computeDeterministicEmbedding,
  generateKnowledgeEmbedding,
  getKnowledgeStats,
  EMBEDDING_DIM,
} from "./knowledge/embeddings.js";
export { indexKnowledgeDocument, deleteKnowledgeDocument } from "./knowledge/indexing.js";
export { searchKnowledgeHybrid } from "./knowledge/search.js";
