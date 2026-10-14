/**
 * JSON extraction helpers for LLM responses.
 *
 * Models routinely wrap JSON in prose or markdown fences, so callers parse the
 * first valid balanced `{ ... }` block instead of using an unbounded greedy
 * regex that can be poisoned by trailing braces, and strip prototype-pollution
 * keys (`__proto__`, `constructor`, `prototype`) during `JSON.parse`.
 */

const DANGEROUS_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeJsonReviver(key: string, value: unknown): unknown {
  if (DANGEROUS_PROTO_KEYS.has(key)) {
    return undefined;
  }
  return value;
}

/**
 * Extract and parse the first valid JSON object found in `text`.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (typeof text !== "string" || !text) return null;
  const bounded = text.slice(0, 65536);

  // 1. Scan for balanced `{ ... }` spans so trailing prose braces cannot break or hijack parsing
  let startIdx = bounded.indexOf("{");
  while (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < bounded.length; i++) {
      const ch = bounded[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = bounded.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(candidate, safeJsonReviver);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as T;
            }
          } catch {
            // Continue searching if this brace span was a code snippet before the JSON block
          }
          break;
        }
      }
    }
    startIdx = bounded.indexOf("{", startIdx + 1);
  }

  return null;
}
