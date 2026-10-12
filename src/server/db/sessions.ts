import { getSql, hashToken, memStore } from "./store.js";

export interface SessionUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  plan?: string;
}

export async function createSession(userId: number, token: string, expiresInDays = 7): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const tokenHash = hashToken(token);

  const sql = getSql();
  if (!sql) {
    memStore.sessions.set(tokenHash, { userId, expiresAt });
    return;
  }

  await (sql as any).query(
    `INSERT INTO shunops_sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3);`,
    [userId, tokenHash, expiresAt.toISOString()]
  );
}

/**
 * Upgrades a session row that still stores a raw token to its hash form, so
 * plaintext tokens are progressively eliminated without logging anyone out.
 */
async function replaceLegacyTokenHash(sql: any, rawToken: string, tokenHash: string): Promise<void> {
  try {
    await sql.query(`UPDATE shunops_sessions SET token = $1 WHERE token = $2;`, [tokenHash, rawToken]);
  } catch {
    // Best-effort migration: a failure here must never break authentication.
  }
}

export async function findUserBySessionToken(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const sql = getSql();
  if (!sql) {
    const s = memStore.sessions.get(tokenHash) || memStore.sessions.get(token);
    if (!s || s.expiresAt < new Date()) return null;
    const u = memStore.users.get(s.userId);
    if (!u) return null;
    return { id: u.id, username: u.username, email: u.email, role: u.role, plan: u.plan || "community" };
  }

  const rows = await (sql as any).query(
    `SELECT u.id, u.username, u.email, u.role, u.plan, s.token AS session_token
     FROM shunops_sessions s
     JOIN shunops_users u ON s.user_id = u.id
     WHERE (s.token = $1 OR s.token = $2) AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1;`,
    [tokenHash, token]
  );
  const row = rows[0];
  if (!row) return null;

  if (row.session_token === token && tokenHash !== token) {
    await replaceLegacyTokenHash(sql as any, token, tokenHash);
  }

  return { id: row.id, username: row.username, email: row.email, role: row.role, plan: row.plan };
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);

  const sql = getSql();
  if (!sql) {
    memStore.sessions.delete(tokenHash);
    memStore.sessions.delete(token);
    return;
  }

  await (sql as any).query(`DELETE FROM shunops_sessions WHERE token = $1 OR token = $2;`, [tokenHash, token]);
}

export async function revokeAllUserSessions(userId: number): Promise<void> {
  const sql = getSql();
  if (!sql) {
    for (const [t, s] of memStore.sessions.entries()) {
      if (s.userId === userId) memStore.sessions.delete(t);
    }
    return;
  }
  await (sql as any).query(`DELETE FROM shunops_sessions WHERE user_id = $1;`, [userId]);
}
