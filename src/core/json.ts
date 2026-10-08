/**
 * JSON extraction helpers for LLM responses.
 *
 * Models routinely wrap JSON in prose or markdown fences, so callers parse the
 * first `{ ... }` block instead of the raw response text.
 */

/**
 * Extract and parse the first JSON object found in `text`.
 *
 * Matches the greedy `{ ... }` span used across the tools (first opening brace
 * to the last closing brace) and returns `null` when no block is present or the
 * block is not valid JSON, so callers never have to guard a `JSON.parse`.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0] ?? "") as T;
  } catch {
    return null;
  }
}
