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
    if (u.google_id) memStore.usersByGoogleId.delete(u.google_id);
    if (u.github_id) memStore.usersByGithubId.delete(u.github_id);
    for (const [t, s] of memStore.sessions.entries()) {
      if (s.userId === userId) memStore.sessions.delete(t);
    }
    for (const [k, rec] of memStore.apiKeys.entries()) {
      if (rec.userId === userId) memStore.apiKeys.delete(k);
    }
    for (const [k, cred] of memStore.platformCredentials.entries()) {
      if (cred.userId === userId) memStore.platformCredentials.delete(k);
    }
    for (const [id, task] of memStore.tasks.entries()) {
      if (task.user_id === userId || task.userId === userId) memStore.tasks.delete(id);
    }
    memStore.chatMessages = memStore.chatMessages.filter((m) => m.userId !== userId);
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
    const tasks = Array.from(memStore.tasks.values()).filter(
      (t) => t.user_id === userId || t.userId === userId
    );
    const messages = memStore.chatMessages.filter((m) => m.userId === userId);
    const connectedPlatforms = Array.from(memStore.platformCredentials.values())
      .filter((c) => c.userId === userId)
      .map((c) => ({ platform: c.platform, label: c.label, hint: c.hint, updatedAt: c.updatedAt }));
    return {
      profile: {
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        plan: u.plan || "community",
        query_count: u.query_count || 0,
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        total_tokens: u.total_tokens || 0,
        created_at: u.created_at,
      },
      connectedPlatforms,
      tasks,
      chatMessages: messages,
      exportedAt: new Date().toISOString(),
    };
  }

  const userRows = await (sql as any).query(
    `SELECT id, username, email, email_verified, role, plan, query_count, input_tokens, output_tokens, total_tokens, created_at
     FROM shunops_users WHERE id = $1;`,
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

  const connectedPlatforms = await (sql as any).query(
    `SELECT platform, label, secret_hint AS hint, updated_at AS "updatedAt" FROM shunops_user_platform_credentials WHERE user_id = $1 ORDER BY platform;`,
    [userId]
  );

  return {
    profile: userRows[0],
    connectedPlatforms: connectedPlatforms || [],
    tasks: tasks || [],
    chatMessages: messages || [],
    exportedAt: new Date().toISOString(),
  };
}
