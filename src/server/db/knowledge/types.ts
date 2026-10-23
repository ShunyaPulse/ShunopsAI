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
