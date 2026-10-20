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

export async function createConversation(
  userId: number,
  id: string,
  title = "New Conversation"
): Promise<ConversationSummary> {
  const sql = getSql();
  const now = new Date().toISOString();
  const safeTitle = (title || "New Conversation").slice(0, 100).trim();

  if (!sql) {
    const record = { id, userId, title: safeTitle, createdAt: now, updatedAt: now };
    memStore.conversations.set(id, record);
    return { id, title: safeTitle, created_at: now, updated_at: now, message_count: 0 };
  }

  await (sql as any).query(
    `INSERT INTO shunops_conversations (id, user_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;`,
    [id, userId, safeTitle]
  );

  return { id, title: safeTitle, created_at: now, updated_at: now };
}

export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const sql = getSql();
  if (!sql) {
    const list: ConversationSummary[] = [];
    for (const c of memStore.conversations.values()) {
      if (c.userId === userId) {
        const count = memStore.chatMessages.filter(
          (m) => m.userId === userId && ((m as any).conversationId === c.id || (!m.conversationId && c.id === "default"))
        ).length;
        list.push({
          id: c.id,
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
       LEFT JOIN shunops_chat_messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id, c.title, c.created_at, c.updated_at
       ORDER BY c.updated_at DESC
       LIMIT 50;`,
      [userId]
    );
    if (rows && rows.length > 0) return rows;
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
    if (fallbackRows && fallbackRows.length > 0) return fallbackRows;
  } catch {}

  return [];
}

export async function deleteConversation(userId: number, conversationId: string): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memStore.conversations.delete(conversationId);
    memStore.chatMessages = memStore.chatMessages.filter(
      (m) => !(m.userId === userId && ((m as any).conversationId === conversationId || (!m.conversationId && conversationId === "default")))
    );
    return;
  }

  try {
    await (sql as any).query(
      `DELETE FROM shunops_chat_messages WHERE user_id = $1 AND (conversation_id = $2 OR ($2 = 'default' AND conversation_id IS NULL));`,
      [userId, conversationId]
    );
    await (sql as any).query(
      `DELETE FROM shunops_conversations WHERE user_id = $1 AND id = $2;`,
      [userId, conversationId]
    );
  } catch {
    await (sql as any).query(`DELETE FROM shunops_chat_messages WHERE user_id = $1;`, [userId]);
  }
}

export async function saveChatMessage(
  userId: number,
  role: "user" | "assistant",
  message: string,
  conversationId = "default"
): Promise<void> {
  const sql = getSql();
  const convId = conversationId || "default";

  if (!sql) {
    memStore.chatMessages.push({
      id: memStore.nextMsgId++,
      userId,
      role,
      message,
      createdAt: new Date().toISOString(),
      conversationId: convId,
    });
    if (!memStore.conversations.has(convId)) {
      const title = message.slice(0, 45).replace(/\n/g, " ").trim() || "New Chat";
      memStore.conversations.set(convId, {
        id: convId,
        userId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const conv = memStore.conversations.get(convId)!;
      conv.updatedAt = new Date().toISOString();
    }
    return;
  }

  // Ensure conversation row exists and update its timestamp
  try {
    const titleSnippet = message.slice(0, 50).replace(/\n/g, " ").trim() || "New Chat";
    await (sql as any).query(
      `INSERT INTO shunops_conversations (id, user_id, title, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;`,
      [convId, userId, titleSnippet]
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
  const targetConvId = conversationId || null;

  if (!sql) {
    return memStore.chatMessages
      .filter((m) => m.userId === userId && (!targetConvId || (m as any).conversationId === targetConvId || (!m.conversationId && targetConvId === "default")))
      .slice(-limit)
      .map((m) => ({ id: m.id, role: m.role, message: m.message, created_at: m.createdAt, conversation_id: (m as any).conversationId }));
  }

  if (targetConvId) {
    try {
      const rows = await (sql as any).query(
        `SELECT id, role, message, created_at, conversation_id
         FROM (
           SELECT id, role, message, created_at, conversation_id
           FROM shunops_chat_messages
           WHERE user_id = $1 AND (conversation_id = $2 OR ($2 = 'default' AND conversation_id IS NULL))
           ORDER BY created_at DESC, id DESC
           LIMIT $3
         ) recent
         ORDER BY created_at ASC, id ASC;`,
        [userId, targetConvId, limit]
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
  const sql = getSql();
  const targetConvId = conversationId || null;

  if (!sql) {
    if (targetConvId) {
      memStore.chatMessages = memStore.chatMessages.filter(
        (m) => !(m.userId === userId && ((m as any).conversationId === targetConvId || (!m.conversationId && targetConvId === "default")))
      );
      memStore.conversations.delete(targetConvId);
    } else {
      memStore.chatMessages = memStore.chatMessages.filter((m) => m.userId !== userId);
      for (const [id, c] of memStore.conversations.entries()) {
        if (c.userId === userId) memStore.conversations.delete(id);
      }
    }
    return;
  }

  if (targetConvId) {
    try {
      await (sql as any).query(
        `DELETE FROM shunops_chat_messages WHERE user_id = $1 AND (conversation_id = $2 OR ($2 = 'default' AND conversation_id IS NULL));`,
        [userId, targetConvId]
      );
      await (sql as any).query(
        `DELETE FROM shunops_conversations WHERE user_id = $1 AND id = $2;`,
        [userId, targetConvId]
      );
    } catch {
      await (sql as any).query(`DELETE FROM shunops_chat_messages WHERE user_id = $1;`, [userId]);
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
