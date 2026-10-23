import { dotProductNormalized } from "../../core/vectors.js";
import { computeDeterministicEmbedding } from "../../server/db/knowledge.js";
import { hydrateTenantAgenticState, persistTenantAgenticState } from "./persistence.js";
import { getOrCreateMemoryMap } from "./store.js";
import type { AgentMemoryFact } from "./types.js";
import { MAX_MEMORIES_PER_TENANT } from "./types.js";

/**
 * 3. Long-Term Semantic & Episodic Agent Memory (`manage_agent_memory`)
 *
 * Facts are stored per tenant with a deterministic embedding, so recall can
 * blend lexical hits with vector similarity without a paid embeddings API.
 */

const RECALL_LIMIT = 8;
const RECALL_MIN_SCORE = 0.15;
const LEXICAL_HIT_BONUS = 0.4;

function normalizeMemoryKey(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .slice(0, 80);
}

function normalizeTags(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
}

function remember(
  memMap: Map<string, AgentMemoryFact>,
  args: { key?: string | undefined; fact?: string | undefined; tags?: string[] | undefined }
): string {
  const key = normalizeMemoryKey(args.key);
  const fact = String(args.fact || "").trim().slice(0, 2000);
  if (!key || !fact) {
    return "Error: Both 'key' (short identifier) and 'fact' (information to remember) are required for operation='remember'.";
  }
  if (!memMap.has(key) && memMap.size >= MAX_MEMORIES_PER_TENANT) {
    const oldestKey = memMap.keys().next().value;
    if (oldestKey !== undefined) memMap.delete(oldestKey);
  }
  const tags = normalizeTags(args.tags);
  memMap.set(key, {
    key,
    fact,
    tags,
    embedding: computeDeterministicEmbedding(`${key} ${tags.join(" ")} ${fact}`),
    updatedAt: new Date().toISOString(),
  });
  return `Remembered fact under key "${key}": "${fact}"${tags.length > 0 ? ` [tags: ${tags.join(", ")}]` : ""}.`;
}

function recall(
  memMap: Map<string, AgentMemoryFact>,
  args: { query?: string | undefined; key?: string | undefined }
): string {
  const query = String(args.query || args.key || "").trim();
  if (!query) return "Error: 'query' is required for operation='recall'.";
  if (memMap.size === 0) return "No memories stored yet.";

  const qLower = query.toLowerCase();
  const qVec = computeDeterministicEmbedding(query);
  const scored = Array.from(memMap.values())
    .map((m) => {
      const lexicalHit =
        m.key.includes(qLower) ||
        m.fact.toLowerCase().includes(qLower) ||
        m.tags.some((t) => t.includes(qLower))
          ? LEXICAL_HIT_BONUS
          : 0;
      return { m, score: lexicalHit + dotProductNormalized(qVec, m.embedding) };
    })
    .filter((x) => x.score > RECALL_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, RECALL_LIMIT);

  if (scored.length === 0) {
    return `No stored memories matched query "${query}".`;
  }
  return (
    `Recalled Memories for "${query}":\n` +
    scored
      .map(
        ({ m, score }) =>
          `• [${m.key}] (relevance ${score.toFixed(2)}): ${m.fact}${
            m.tags.length > 0 ? ` [tags: ${m.tags.join(", ")}]` : ""
          }`
      )
      .join("\n")
  );
}

export async function executeManageAgentMemory(
  args: {
    operation: "remember" | "recall" | "list" | "forget";
    key?: string | undefined;
    fact?: string | undefined;
    query?: string | undefined;
    tags?: string[] | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  const memMap = getOrCreateMemoryMap(tenantKey);
  const op = args.operation;

  if (op === "remember") {
    const out = remember(memMap, args);
    if (out.startsWith("Remembered")) await persistTenantAgenticState(tenantKey);
    return out;
  }

  if (op === "forget") {
    const key = String(args.key || "").trim().toLowerCase();
    if (!key) return "Error: 'key' is required for operation='forget'.";
    const removed = memMap.delete(key);
    if (removed) await persistTenantAgenticState(tenantKey);
    return removed ? `Forgot memory "${key}".` : `Memory key "${key}" was not found.`;
  }

  if (op === "list") {
    if (memMap.size === 0) {
      return "No long-term memories stored yet. Use operation='remember' to store user preferences, project architecture facts, or decisions.";
    }
    const items = Array.from(memMap.values()).map(
      (m) => `• [${m.key}]: ${m.fact}${m.tags.length > 0 ? ` (${m.tags.join(", ")})` : ""}`
    );
    return `Stored Long-Term Memories (${memMap.size}):\n${items.join("\n")}`;
  }

  if (op === "recall") {
    return recall(memMap, args);
  }

  return `Unsupported memory operation: "${op}".`;
}
