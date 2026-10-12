import { getSql, memStore } from "./store.js";

// ==========================================
// ACCOUNT LIFECYCLE MANAGEMENT
// ==========================================

export async function updateUserPassword(userId: number, newPasswordHash: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (!u) return false;
    u.password_hash = newPasswordHash;
    return true;
  }
  const result = await (sql as any).query(
    `UPDATE shunops_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id;`,
    [newPasswordHash, userId]
  );
  return result.length > 0;
}

export async function deleteUserAccount(userId: number): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (!u) return false;
    memStore.users.delete(userId);
    memStore.usersByUsername.delete(u.username.toLowerCase());
    if (u.email) memStore.usersByEmail.delete(u.email.toLowerCase());
    for (const [t, s] of memStore.sessions.entries()) {
      if (s.userId === userId) memStore.sessions.delete(t);
    }
    return true;
  }
  const result = await (sql as any).query(`DELETE FROM shunops_users WHERE id = $1 RETURNING id;`, [userId]);
  return result.length > 0;
}

/** Full per-user data export (GDPR-style portability). */
export async function exportUserData(userId: number): Promise<any> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (!u) return null;
    const tasks = Array.from(memStore.tasks.values()).filter((t) => t.user_id === userId);
    const messages = memStore.chatMessages.filter((m) => m.userId === userId);
    return {
      profile: { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at },
      tasks,
      chatMessages: messages,
      exportedAt: new Date().toISOString(),
    };
  }

  const userRows = await (sql as any).query(
    `SELECT id, username, email, email_verified, role, plan, created_at FROM shunops_users WHERE id = $1;`,
    [userId]
  );
  if (!userRows[0]) return null;

  const tasks = await (sql as any).query(
    `SELECT id, goal, status, steps_taken, final_answer, created_at, completed_at FROM shunops_tasks WHERE user_id = $1 ORDER BY created_at DESC;`,
    [userId]
  );

  const messages = await (sql as any).query(
    `SELECT id, role, message, created_at FROM shunops_chat_messages WHERE user_id = $1 ORDER BY created_at ASC;`,
    [userId]
  );

  return {
    profile: userRows[0],
    tasks: tasks || [],
    chatMessages: messages || [],
    exportedAt: new Date().toISOString(),
  };
}
