import { getSql, memStore } from "./store.js";

// ==========================================
// CONVERSATION PERSISTENCE (CHAT MESSAGES)
// ==========================================

export async function saveChatMessage(userId: number, role: "user" | "assistant", message: string): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memStore.chatMessages.push({
      id: memStore.nextMsgId++,
      userId,
      role,
      message,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  await (sql as any).query(
    `INSERT INTO shunops_chat_messages (user_id, role, message) VALUES ($1, $2, $3);`,
    [userId, role, message]
  );
}

export async function getChatHistory(userId: number, limit = 50): Promise<Array<{ id: number; role: string; message: string; created_at: string }>> {
  const sql = getSql();
  if (!sql) {
    return memStore.chatMessages
      .filter((m) => m.userId === userId)
      .slice(-limit)
      .map((m) => ({ id: m.id, role: m.role, message: m.message, created_at: m.createdAt }));
  }

  const rows = await (sql as any).query(
    `SELECT id, role, message, created_at FROM shunops_chat_messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT $2;`,
    [userId, limit]
  );
  return rows || [];
}

export async function clearChatHistory(userId: number): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memStore.chatMessages = memStore.chatMessages.filter((m) => m.userId !== userId);
    return;
  }
  await (sql as any).query(`DELETE FROM shunops_chat_messages WHERE user_id = $1;`, [userId]);
}
