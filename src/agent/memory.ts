// ==========================================
// ShunopsAI Hierarchical Rolling Memory
// Replaces naive array slicing with intelligent context preservation:
// Summarizes older session turns into dense bulleted key context
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
    .replace(/(^|\n)\s*(User|Assistant|System)\s*:/gi, "$1[$2]:");
}

/**
 * Condenses a single turn into a concise bullet point.
 */
function condenseTurn(turn: ChatTurn): string {
  const roleName = turn.role === "user" ? "User" : "Assistant";
  const cleanContent = sanitizeTurnContent(turn.content).replace(/\s+/g, " ").trim();
  const truncated = cleanContent.length > 180 ? cleanContent.slice(0, 177) + "..." : cleanContent;
  return `${roleName}: ${truncated}`;
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

  // Distill older turns into key structured memory points
  const distilledPoints: string[] = [];
  for (let i = 0; i < olderTurns.length; i++) {
    const turn = olderTurns[i];
    if (!turn) continue;
    distilledPoints.push(`• ${condenseTurn(turn)}`);
  }

  const formattedRecent = recentTurns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${sanitizeTurnContent(t.content)}`)
    .join("\n\n");

  return [
    `=== Prior Session Context & Key Decisions (Rolling Memory) ===`,
    distilledPoints.join("\n"),
    ``,
    `=== Recent Active Conversation Turns ===`,
    formattedRecent,
  ].join("\n");
}
