/**
 * Normalized-vector similarity, shared by the agentic memory store and the
 * semantic response cache. Both embed with `computeDeterministicEmbedding`,
 * which L2-normalizes, so the dot product is the cosine similarity.
 */
export function dotProductNormalized(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}
