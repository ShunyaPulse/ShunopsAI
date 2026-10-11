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
      password_hash VARCHAR(255),
      google_id VARCHAR(255) UNIQUE,
      github_id VARCHAR(255) UNIQUE,
      email_verified BOOLEAN DEFAULT FALSE,
      role VARCHAR(32) DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure new columns exist on existing table
  await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;`);
  await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS github_id VARCHAR(255) UNIQUE;`);
  await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;`);
  await (sql as any).query(`ALTER TABLE shunops_users ALTER COLUMN password_hash DROP NOT NULL;`);

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_email_otps (
      email VARCHAR(255) PRIMARY KEY,
      otp VARCHAR(10) NOT NULL,
      attempts INTEGER DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
  await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_users_email ON shunops_users(email);`);
}

export interface UserRecord {
  id: number;
  username: string;
  email: string | null;
  password_hash: string | null;
  google_id?: string | null;
  github_id?: string | null;
  email_verified: boolean;
  role: string;
  created_at: string;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, created_at FROM shunops_users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
    [username]
  );
  return rows[0] || null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, created_at FROM shunops_users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
    [email]
  );
  return rows[0] || null;
}

export async function findUserByGoogleId(googleId: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, created_at FROM shunops_users WHERE google_id = $1 LIMIT 1;`,
    [googleId]
  );
  return rows[0] || null;
}

export async function createUser(
  username: string,
  passwordHash: string | null,
  email?: string,
  emailVerified = false
): Promise<UserRecord> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, created_at;`,
    [username, email || null, passwordHash, emailVerified]
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

export async function upsertGoogleUser(googleId: string, email: string, name?: string): Promise<UserRecord> {
  const sql = getSql();
  const cleanEmail = email.trim().toLowerCase();

  // 1. Try to find by google_id
  const byGoogle = await findUserByGoogleId(googleId);
  if (byGoogle) return byGoogle;

  // 2. Try to link with existing email
  const byEmail = await findUserByEmail(cleanEmail);
  if (byEmail) {
    const updated = await (sql as any).query(
      `UPDATE shunops_users SET google_id = $1, email_verified = TRUE WHERE id = $2
       RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, created_at;`,
      [googleId, byEmail.id]
    );
    return updated[0];
  }

  // 3. Create new user with username derived from email or name
  let baseUsername = (name || cleanEmail.split("@")[0] || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);
  if (baseUsername.length < 3) baseUsername = `user_${Date.now().toString(36)}`;

  let username = baseUsername;
  let counter = 1;
  while (await findUserByUsername(username)) {
    username = `${baseUsername}_${counter++}`;
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, google_id, email_verified)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, created_at;`,
    [username, cleanEmail, googleId]
  );
  const user = rows[0];

  await (sql as any).query(
    `INSERT INTO shunops_user_workspaces (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING;`,
    [user.id, `${username}'s Workspace`]
  );

  return user;
}

export async function findUserByGithubId(githubId: string): Promise<UserRecord | null> {
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, created_at FROM shunops_users WHERE github_id = $1 LIMIT 1;`,
    [githubId]
  );
  return rows[0] || null;
}

export async function upsertGithubUser(githubId: string, email: string, login: string, name?: string): Promise<UserRecord> {
  const sql = getSql();
  const cleanEmail = email.trim().toLowerCase();

  // 1. Try to find by github_id
  const byGithub = await findUserByGithubId(githubId);
  if (byGithub) return byGithub;

  // 2. Try to link with existing email (Canonical Account Linking)
  const byEmail = await findUserByEmail(cleanEmail);
  if (byEmail) {
    const updated = await (sql as any).query(
      `UPDATE shunops_users SET github_id = $1, email_verified = TRUE WHERE id = $2
       RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, created_at;`,
      [githubId, byEmail.id]
    );
    return updated[0];
  }

  // 3. Create new user with username derived from github login
  let baseUsername = (login || name || cleanEmail.split("@")[0] || "gh_user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);
  if (baseUsername.length < 3) baseUsername = `gh_${Date.now().toString(36)}`;

  let username = baseUsername;
  let counter = 1;
  while (await findUserByUsername(username)) {
    username = `${baseUsername}_${counter++}`;
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, github_id, email_verified)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, created_at;`,
    [username, cleanEmail, githubId]
  );
  const user = rows[0];

  await (sql as any).query(
    `INSERT INTO shunops_user_workspaces (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING;`,
    [user.id, `${username}'s Workspace`]
  );

  return user;
}

export async function markEmailAsVerified(email: string): Promise<void> {
  const sql = getSql();
  await (sql as any).query(
    `UPDATE shunops_users SET email_verified = TRUE WHERE LOWER(email) = LOWER($1);`,
    [email]
  );
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

export async function findUserBySessionToken(token: string): Promise<{ id: number; username: string; email: string | null; role: string } | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = await (sql as any).query(
    `SELECT u.id, u.username, u.email, u.role
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
