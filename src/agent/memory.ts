// ==========================================
// ShunopsAI Hierarchical Rolling Memory
// Replaces naive array slicing with intelligent context preservation:
// Summarizes older session turns into dense bulleted key context
// (preserving technical entities, file paths, identifiers, and error codes)
// while keeping the most recent turns verbatim.
// ==========================================

export interface ChatTurn {
  role: string;
  content: string;
}

export interface MemorySummaryOptions {
  maxRecentTurns?: number;
  maxSummaryTokens?: number;
}

/**
 * Neutralize embedded role/section headers inside message content so a user turn
 * cannot spoof `Assistant:` or `System:` turns in rolling memory.
 */
function sanitizeTurnContent(content: string): string {
  return String(content || "")
    .replace(/={3,}/g, "---")
    .replace(/(^|\n)[ \t]*(user|assistant|system)[ \t]*:/gi, "$1[$2]:");
}

/**
 * Extract salient technical tokens (file paths, code identifiers, URLs, SQL tables, error codes)
 * from the tail of a long message so they are not lost when summarizing older turns.
 */
function extractSalientEntities(tailText: string): string[] {
  const entities = new Set<string>();
  const matches = [
    ...(tailText.match(/`[^`\n]{2,48}`/g) || []),
    ...(tailText.match(/\b(?:src|tests|public|jobs)\/[A-Za-z0-9_./-]+/g) || []),
    ...(tailText.match(/\b(?:https?:\/\/[^\s)>]{4,60})/g) || []),
    ...(tailText.match(/\b(?:CVE-\d{4}-\d+|HTTP\s+\d{3}|error\s+\d{3}|shunops_[a-z_]+)\b/gi) || []),
  ];
  for (const m of matches) {
    const clean = m.trim();
    if (clean && entities.size < 6) {
      entities.add(clean);
    }
  }
  return Array.from(entities);
}

/**
 * Condenses a single turn into a concise bullet point while preserving key entities
 * that appear past the opening sentence.
 */
function condenseTurn(turn: ChatTurn): string {
  const roleName = turn.role === "user" ? "User" : "Assistant";
  const cleanContent = sanitizeTurnContent(turn.content).replace(/\s+/g, " ").trim();
  if (cleanContent.length <= 200) {
    return `${roleName}: ${cleanContent}`;
  }
  const head = cleanContent.slice(0, 177);
  const tail = cleanContent.slice(177);
  const entities = extractSalientEntities(tail);
  const entitySuffix = entities.length > 0 ? ` [Key refs: ${entities.join(", ")}]` : "";
  return `${roleName}: ${head}...${entitySuffix}`;
}

/**
 * Builds a hierarchical rolling memory representation of conversation history.
 * Retains infinite session depth without overflowing LLM context limits.
 */
export function buildRollingMemory(
  turns: ChatTurn[],
  options: MemorySummaryOptions = {}
): string {
  const maxRecent = options.maxRecentTurns ?? 6;
  const maxSummaryTokens = options.maxSummaryTokens ?? 1200;
  const maxSummaryChars = maxSummaryTokens * 4;

  if (!turns || turns.length === 0) {
    return "";
  }

  // If conversation is short, keep all turns verbatim
  if (turns.length <= maxRecent) {
    const formatted = turns
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${sanitizeTurnContent(t.content)}`)
      .join("\n\n");
    return `Recent Conversation Turns:\n${formatted}`;
  }

  // Split into older background and recent immediate turns
  const olderTurns = turns.slice(0, -maxRecent);
  const recentTurns = turns.slice(-maxRecent);

  // Distill older turns into key structured memory points (with deduplication & token budget)
  const distilledPoints: string[] = [];
  const seenBullets = new Set<string>();
  for (let i = 0; i < olderTurns.length; i++) {
    const turn = olderTurns[i];
    if (!turn) continue;
    const bullet = `• ${condenseTurn(turn)}`;
    if (!seenBullets.has(bullet)) {
      seenBullets.add(bullet);
      distilledPoints.push(bullet);
    }
  }

  let summaryBlock = distilledPoints.join("\n");
  if (summaryBlock.length > maxSummaryChars) {
    summaryBlock = summaryBlock.slice(-maxSummaryChars);
    const firstNewline = summaryBlock.indexOf("\n");
    if (firstNewline !== -1) {
      summaryBlock = summaryBlock.slice(firstNewline + 1);
    }
  }

  const formattedRecent = recentTurns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${sanitizeTurnContent(t.content)}`)
    .join("\n\n");

  return [
    `=== Prior Session Context & Key Decisions (Rolling Memory) ===`,
    summaryBlock,
    ``,
    `=== Recent Active Conversation Turns ===`,
    formattedRecent,
  ].join("\n");
}
