import { neon } from "@neondatabase/serverless";

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  return neon(dbUrl);
}

/**
 * Initialize Multi-Tenant SaaS Tables in Neon Serverless Postgres.
 * Creates users, sessions, and user workspace profiles.
 */
export async function initDatabaseSchema(): Promise<void> {
  const sql = getSql();

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(32) DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
      token VARCHAR(128) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_user_workspaces (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
      name VARCHAR(128) DEFAULT 'Default Workspace',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_sessions_token ON shunops_sessions(token);`);
  await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_users_username ON shunops_users(username);`);
}

export interface UserRecord {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  role: string;
  created_at: string;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, role, created_at FROM shunops_users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
    [username]
  );
  return rows[0] || null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, role, created_at FROM shunops_users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
    [email]
  );
  return rows[0] || null;
}

export async function createUser(username: string, passwordHash: string, email?: string): Promise<UserRecord> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, password_hash, role, created_at;`,
    [username, email || null, passwordHash]
  );
  const user = rows[0];

  // Initialize empty workspace
  await (sql as any).query(
    `INSERT INTO shunops_user_workspaces (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING;`,
    [user.id, `${username}'s Workspace`]
  );

  return user;
}

export async function createSession(userId: number, token: string, expiresInDays = 7): Promise<void> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  await (sql as any).query(
    `INSERT INTO shunops_sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3);`,
    [userId, token, expiresAt.toISOString()]
  );
}

export async function findUserBySessionToken(token: string): Promise<{ id: number; username: string; role: string } | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT u.id, u.username, u.role
     FROM shunops_sessions s
     JOIN shunops_users u ON s.user_id = u.id
     WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1;`,
    [token]
  );
  return rows[0] || null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  const sql = getSql();
  await (sql as any).query(`DELETE FROM shunops_sessions WHERE token = $1;`, [token]);
}
