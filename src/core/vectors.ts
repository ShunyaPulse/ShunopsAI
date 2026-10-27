/**
 * Normalized-vector similarity, shared by the agentic memory store and the
 * semantic response cache. Both embed with `computeDeterministicEmbedding`,
 * which L2-normalizes, so the dot product is the cosine similarity.
 */
export function dotProductNormalized(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  const len = a.length;
  if (len !== b.length || len === 0) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}
