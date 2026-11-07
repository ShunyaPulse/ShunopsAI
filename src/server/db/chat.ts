import { getSql, memStore } from "./store.js";

// ==========================================
// CONVERSATION PERSISTENCE (CHAT MESSAGES & THREADS)
// ==========================================

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

/**
 * Scope the `'default'` conversation key per user in `shunops_conversations`
 * and `memStore.conversations` (`default:<userId>`) so multiple users' default
 * threads never collide on primary key `'default'`.
 */
function toScopedConversationKey(userId: number, conversationId?: string): string {
  const clean = (conversationId || "default").trim() || "default";
  return clean === "default" ? `default:${userId}` : clean;
}

function toPublicConversationId(userId: number, scopedKey: string): string {
  return scopedKey === `default:${userId}` ? "default" : scopedKey;
}

export async function createConversation(
  userId: number,
  id: string,
  title = "New Conversation"
): Promise<ConversationSummary> {
  const sql = getSql();
  const now = new Date().toISOString();
  const safeTitle = (title || "New Conversation").slice(0, 100).trim();
  const scopedId = toScopedConversationKey(userId, id);
  const publicId = toPublicConversationId(userId, scopedId);

  if (!sql) {
    const existing = memStore.conversations.get(scopedId);
    if (existing && existing.userId !== userId) {
      throw new Error("Conversation ID belongs to another user.");
    }
    const record = { id: scopedId, userId, title: safeTitle, createdAt: existing?.createdAt || now, updatedAt: now };
    memStore.conversations.set(scopedId, record);
    return { id: publicId, title: safeTitle, created_at: record.createdAt, updated_at: now, message_count: 0 };
  }

  await (sql as any).query(
    `INSERT INTO shunops_conversations (id, user_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE
     SET updated_at = CURRENT_TIMESTAMP
     WHERE shunops_conversations.user_id = EXCLUDED.user_id;`,
    [scopedId, userId, safeTitle]
  );

  return { id: publicId, title: safeTitle, created_at: now, updated_at: now };
}

export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const sql = getSql();
  if (!sql) {
    const list: ConversationSummary[] = [];
    for (const c of memStore.conversations.values()) {
      if (c.userId === userId) {
        const publicId = toPublicConversationId(userId, c.id);
        const count = memStore.chatMessages.filter(
          (m) =>
            m.userId === userId &&
            ((m as any).conversationId === publicId ||
              (m as any).conversationId === c.id ||
              (!m.conversationId && publicId === "default"))
        ).length;
        list.push({
          id: publicId,
          title: c.title,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
          message_count: count,
        });
      }
    }
    return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  try {
    const rows = await (sql as any).query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              COUNT(m.id)::int as message_count
       FROM shunops_conversations c
       LEFT JOIN shunops_chat_messages m
         ON m.user_id = c.user_id
        AND (m.conversation_id = c.id OR (c.id = $2 AND (m.conversation_id = 'default' OR m.conversation_id IS NULL)))
       WHERE c.user_id = $1
       GROUP BY c.id, c.title, c.created_at, c.updated_at
       ORDER BY c.updated_at DESC
       LIMIT 50;`,
      [userId, `default:${userId}`]
    );
    if (rows && rows.length > 0) {
      return rows.map((r: any) => ({
        ...r,
        id: toPublicConversationId(userId, String(r.id)),
      }));
    }
  } catch {}

  // Fallback if shunops_conversations table has not been populated yet
  try {
    const fallbackRows = await (sql as any).query(
      `SELECT DISTINCT COALESCE(conversation_id, 'default') as id,
              'Chat ' || SUBSTRING(COALESCE(conversation_id, 'default') FROM 1 FOR 8) as title,
              MAX(created_at) as updated_at, MIN(created_at) as created_at,
              COUNT(id)::int as message_count
       FROM shunops_chat_messages
       WHERE user_id = $1
       GROUP BY COALESCE(conversation_id, 'default')
       ORDER BY updated_at DESC;`,
      [userId]
    );
    if (fallbackRows && fallbackRows.length > 0) {
      return fallbackRows.map((r: any) => ({
        ...r,
        id: toPublicConversationId(userId, String(r.id)),
      }));
    }
  } catch {}

  return [];
}

export async function deleteConversation(userId: number, conversationId: string): Promise<void> {
  const sql = getSql();
  const scopedId = toScopedConversationKey(userId, conversationId);
  const publicId = toPublicConversationId(userId, scopedId);

  if (!sql) {
    const existing = memStore.conversations.get(scopedId);
    if (!existing || existing.userId === userId) {
      memStore.conversations.delete(scopedId);
    }
    const legacyExisting = memStore.conversations.get(publicId);
    if (legacyExisting && legacyExisting.userId === userId) {
      memStore.conversations.delete(publicId);
    }
    memStore.chatMessages = memStore.chatMessages.filter(
      (m) =>
        !(
          m.userId === userId &&
          ((m as any).conversationId === publicId ||
            (m as any).conversationId === scopedId ||
            (!m.conversationId && publicId === "default"))
        )
    );
    return;
  }

  try {
    await (sql as any).query(
      `DELETE FROM shunops_chat_messages
       WHERE user_id = $1
         AND (conversation_id = $2 OR conversation_id = $3 OR ($2 = 'default' AND conversation_id IS NULL));`,
      [userId, publicId, scopedId]
    );
  } catch {}

  try {
    await (sql as any).query(
      `DELETE FROM shunops_conversations WHERE user_id = $1 AND (id = $2 OR id = $3);`,
      [userId, scopedId, publicId]
    );
  } catch {}
}

export async function saveChatMessage(
  userId: number,
  role: "user" | "assistant",
  message: string,
  conversationId = "default"
): Promise<void> {
  const sql = getSql();
  const scopedId = toScopedConversationKey(userId, conversationId);
  const convId = toPublicConversationId(userId, scopedId);

  if (!sql) {
    memStore.chatMessages.push({
      id: memStore.nextMsgId++,
      userId,
      role,
      message,
      createdAt: new Date().toISOString(),
      conversationId: convId,
    });
    if (!memStore.conversations.has(scopedId)) {
      const title = message.slice(0, 45).replace(/\n/g, " ").trim() || "New Chat";
      memStore.conversations.set(scopedId, {
        id: scopedId,
        userId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const conv = memStore.conversations.get(scopedId)!;
      if (conv.userId === userId) {
        conv.updatedAt = new Date().toISOString();
      }
    }
    return;
  }

  // Ensure conversation row exists and update its timestamp strictly for this owner
  try {
    const titleSnippet = message.slice(0, 50).replace(/\n/g, " ").trim() || "New Chat";
    await (sql as any).query(
      `INSERT INTO shunops_conversations (id, user_id, title, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP
       WHERE shunops_conversations.user_id = EXCLUDED.user_id;`,
      [scopedId, userId, titleSnippet]
    );
  } catch {}

  // Insert message with conversation_id
  try {
    await (sql as any).query(
      `INSERT INTO shunops_chat_messages (user_id, role, message, conversation_id) VALUES ($1, $2, $3, $4);`,
      [userId, role, message, convId]
    );
  } catch {
    await (sql as any).query(
      `INSERT INTO shunops_chat_messages (user_id, role, message) VALUES ($1, $2, $3);`,
      [userId, role, message]
    );
  }
}

/**
 * Retrieves the most recent `limit` chat messages for a user, ordered chronologically
 * from oldest to newest so rolling memory and UI threads always reflect recent turns.
 */
export async function getChatHistory(
  userId: number,
  limit = 100,
  conversationId?: string
): Promise<Array<{ id: number; role: string; message: string; created_at: string; conversation_id?: string }>> {
  const sql = getSql();
  const targetConvId = conversationId ? toPublicConversationId(userId, toScopedConversationKey(userId, conversationId)) : null;
  const scopedConvId = conversationId ? toScopedConversationKey(userId, conversationId) : null;

  if (!sql) {
    return memStore.chatMessages
      .filter(
        (m) =>
          m.userId === userId &&
          (!targetConvId ||
            (m as any).conversationId === targetConvId ||
            (m as any).conversationId === scopedConvId ||
            (!m.conversationId && targetConvId === "default"))
      )
      .slice(-limit)
      .map((m) => ({
        id: m.id,
        role: m.role,
        message: m.message,
        created_at: m.createdAt,
        conversation_id: (m as any).conversationId,
      }));
  }

  if (targetConvId) {
    try {
      const rows = await (sql as any).query(
        `SELECT id, role, message, created_at, conversation_id
         FROM (
           SELECT id, role, message, created_at, conversation_id
           FROM shunops_chat_messages
           WHERE user_id = $1
             AND (conversation_id = $2 OR conversation_id = $3 OR ($2 = 'default' AND conversation_id IS NULL))
           ORDER BY created_at DESC, id DESC
           LIMIT $4
         ) recent
         ORDER BY created_at ASC, id ASC;`,
        [userId, targetConvId, scopedConvId, limit]
      );
      return rows || [];
    } catch {}
  }

  const rows = await (sql as any).query(
    `SELECT id, role, message, created_at, conversation_id
     FROM (
       SELECT id, role, message, created_at, conversation_id
       FROM shunops_chat_messages
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC;`,
    [userId, limit]
  );
  return rows || [];
}

export async function clearChatHistory(userId: number, conversationId?: string): Promise<void> {
  if (conversationId) {
    await deleteConversation(userId, conversationId);
    return;
  }

  const sql = getSql();
  if (!sql) {
    memStore.chatMessages = memStore.chatMessages.filter((m) => m.userId !== userId);
    for (const [id, c] of memStore.conversations.entries()) {
      if (c.userId === userId) memStore.conversations.delete(id);
    }
    return;
  }

  try {
    await (sql as any).query(`DELETE FROM shunops_chat_messages WHERE user_id = $1;`, [userId]);
    await (sql as any).query(`DELETE FROM shunops_conversations WHERE user_id = $1;`, [userId]);
  } catch {
    await (sql as any).query(`DELETE FROM shunops_chat_messages WHERE user_id = $1;`, [userId]);
  }
}
