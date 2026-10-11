import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }
  return neon(dbUrl);
}

// In-memory store fallback when DATABASE_URL is not set (e.g. testing or local offline mode)
const memStore = {
  users: new Map<number, any>(),
  usersByUsername: new Map<string, any>(),
  usersByEmail: new Map<string, any>(),
  usersByGoogleId: new Map<string, any>(),
  usersByGithubId: new Map<string, any>(),
  sessions: new Map<string, { userId: number; expiresAt: Date }>(),
  tasks: new Map<string, any>(),
  chatMessages: [] as Array<{ id: number; userId: number; role: string; message: string; createdAt: string }>,
  apiKeys: new Map<string, { id: number; userId: number; prefix: string; name: string; createdAt: string; lastUsedAt: string | null }>(),
  nextUserId: 1,
  nextMsgId: 1,
  nextKeyId: 1,
};

export interface SchemaMigration {
  version: number;
  name: string;
  up: (sql: any) => Promise<void>;
}

export const MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    name: "001_core_saas_tables",
    up: async (sql) => {
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
          plan VARCHAR(32) DEFAULT 'community',
          query_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

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
    },
  },
  {
    version: 2,
    name: "002_multi_tenant_tasks",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_tasks (
          id VARCHAR(64) PRIMARY KEY,
          user_id INTEGER REFERENCES shunops_users(id) ON DELETE CASCADE,
          goal TEXT NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
          steps_taken INTEGER DEFAULT 0,
          final_answer TEXT,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMPTZ
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_tasks_user_id ON shunops_tasks(user_id);`);
    },
  },
  {
    version: 3,
    name: "003_conversation_persistence",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_chat_messages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          role VARCHAR(16) NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_chat_messages_user ON shunops_chat_messages(user_id, created_at);`);
    },
  },
  {
    version: 4,
    name: "004_personal_api_keys",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_api_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          key_hash VARCHAR(128) UNIQUE NOT NULL,
          key_prefix VARCHAR(16) NOT NULL,
          name VARCHAR(128) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMPTZ
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_api_keys_hash ON shunops_api_keys(key_hash);`);
    },
  },
  {
    version: 5,
    name: "005_metering_and_plans",
    up: async (sql) => {
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS plan VARCHAR(32) DEFAULT 'community';`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS query_count INTEGER DEFAULT 0;`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
    },
  },
];

/**
 * Execute versioned database migrations.
 */
export async function runDatabaseMigrations(): Promise<{ applied: string[]; currentVersion: number }> {
  const sql = getSql();
  if (!sql) {
    return { applied: [], currentVersion: MIGRATIONS.length };
  }

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRows = await (sql as any).query(`SELECT version FROM shunops_schema_migrations;`);
  const appliedSet = new Set((appliedRows || []).map((r: any) => Number(r.version)));

  const appliedNow: string[] = [];
  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      await migration.up(sql);
      await (sql as any).query(
        `INSERT INTO shunops_schema_migrations (version, name) VALUES ($1, $2);`,
        [migration.version, migration.name]
      );
      appliedNow.push(migration.name);
    }
  }

  const latestRow = await (sql as any).query(`SELECT MAX(version) as current_version FROM shunops_schema_migrations;`);
  const currentVersion = Number(latestRow?.[0]?.current_version || 0);

  return { applied: appliedNow, currentVersion };
}

/**
 * Backward-compatible schema initializer that executes versioned migrations.
 */
export async function initDatabaseSchema(): Promise<void> {
  await runDatabaseMigrations();
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
  plan?: string;
  query_count?: number;
  created_at: string;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.usersByUsername.get(username.toLowerCase()) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at FROM shunops_users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
    [username]
  );
  return rows[0] || null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.usersByEmail.get(email.toLowerCase()) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at FROM shunops_users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
    [email]
  );
  return rows[0] || null;
}

export async function findUserByGoogleId(googleId: string): Promise<UserRecord | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.usersByGoogleId.get(googleId) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at FROM shunops_users WHERE google_id = $1 LIMIT 1;`,
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
  if (!sql) {
    const user: UserRecord = {
      id: memStore.nextUserId++,
      username,
      email: email || null,
      password_hash: passwordHash,
      email_verified: emailVerified,
      role: "user",
      plan: "community",
      query_count: 0,
      created_at: new Date().toISOString(),
    };
    memStore.users.set(user.id, user);
    memStore.usersByUsername.set(username.toLowerCase(), user);
    if (email) memStore.usersByEmail.set(email.toLowerCase(), user);
    return user;
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at;`,
    [username, email || null, passwordHash, emailVerified]
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

export async function upsertGoogleUser(googleId: string, email: string, name?: string): Promise<UserRecord> {
  const cleanEmail = email.trim().toLowerCase();

  const byGoogle = await findUserByGoogleId(googleId);
  if (byGoogle) return byGoogle;

  const sql = getSql();
  const byEmail = await findUserByEmail(cleanEmail);
  if (byEmail) {
    if (!sql) {
      byEmail.google_id = googleId;
      byEmail.email_verified = true;
      memStore.usersByGoogleId.set(googleId, byEmail);
      return byEmail;
    }
    const updated = await (sql as any).query(
      `UPDATE shunops_users SET google_id = $1, email_verified = TRUE WHERE id = $2
       RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at;`,
      [googleId, byEmail.id]
    );
    return updated[0];
  }

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

  if (!sql) {
    const user: UserRecord = {
      id: memStore.nextUserId++,
      username,
      email: cleanEmail,
      password_hash: null,
      google_id: googleId,
      email_verified: true,
      role: "user",
      plan: "community",
      query_count: 0,
      created_at: new Date().toISOString(),
    };
    memStore.users.set(user.id, user);
    memStore.usersByUsername.set(username.toLowerCase(), user);
    memStore.usersByEmail.set(cleanEmail, user);
    memStore.usersByGoogleId.set(googleId, user);
    return user;
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, google_id, email_verified)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at;`,
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
  if (!sql) {
    return memStore.usersByGithubId.get(githubId) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at FROM shunops_users WHERE github_id = $1 LIMIT 1;`,
    [githubId]
  );
  return rows[0] || null;
}

export async function upsertGithubUser(githubId: string, email: string, login: string, name?: string): Promise<UserRecord> {
  const cleanEmail = email.trim().toLowerCase();

  const byGithub = await findUserByGithubId(githubId);
  if (byGithub) return byGithub;

  const sql = getSql();
  const byEmail = await findUserByEmail(cleanEmail);
  if (byEmail) {
    if (!sql) {
      byEmail.github_id = githubId;
      byEmail.email_verified = true;
      memStore.usersByGithubId.set(githubId, byEmail);
      return byEmail;
    }
    const updated = await (sql as any).query(
      `UPDATE shunops_users SET github_id = $1, email_verified = TRUE WHERE id = $2
       RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at;`,
      [githubId, byEmail.id]
    );
    return updated[0];
  }

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

  if (!sql) {
    const user: UserRecord = {
      id: memStore.nextUserId++,
      username,
      email: cleanEmail,
      password_hash: null,
      github_id: githubId,
      email_verified: true,
      role: "user",
      plan: "community",
      query_count: 0,
      created_at: new Date().toISOString(),
    };
    memStore.users.set(user.id, user);
    memStore.usersByUsername.set(username.toLowerCase(), user);
    memStore.usersByEmail.set(cleanEmail, user);
    memStore.usersByGithubId.set(githubId, user);
    return user;
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, github_id, email_verified)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, created_at;`,
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
  if (!sql) {
    const u = memStore.usersByEmail.get(email.toLowerCase());
    if (u) u.email_verified = true;
    return;
  }
  await (sql as any).query(
    `UPDATE shunops_users SET email_verified = TRUE WHERE LOWER(email) = LOWER($1);`,
    [email]
  );
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
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

export async function findUserBySessionToken(token: string): Promise<{ id: number; username: string; email: string | null; role: string; plan?: string } | null> {
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
    `SELECT u.id, u.username, u.email, u.role, u.plan
     FROM shunops_sessions s
     JOIN shunops_users u ON s.user_id = u.id
     WHERE (s.token = $1 OR s.token = $2) AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1;`,
    [tokenHash, token]
  );
  return rows[0] || null;
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

// ==========================================
// MULTI-TENANT TASKS PERSISTENCE & ISOLATION
// ==========================================

export async function saveTaskRecord(task: {
  id: string;
  userId?: number | undefined;
  goal: string;
  status: string;
  stepsTaken?: number | undefined;
  finalAnswer?: string | undefined;
  error?: string | undefined;
  createdAt?: string | undefined;
  completedAt?: string | undefined;
}): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memStore.tasks.set(task.id, {
      ...task,
      user_id: task.userId,
      steps_taken: task.stepsTaken || 0,
      final_answer: task.finalAnswer,
      created_at: task.createdAt || new Date().toISOString(),
      completed_at: task.completedAt,
    });
    return;
  }

  await (sql as any).query(
    `INSERT INTO shunops_tasks (id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       steps_taken = EXCLUDED.steps_taken,
       final_answer = EXCLUDED.final_answer,
       error = EXCLUDED.error,
       completed_at = EXCLUDED.completed_at;`,
    [
      task.id,
      task.userId || null,
      task.goal,
      task.status,
      task.stepsTaken || 0,
      task.finalAnswer || null,
      task.error || null,
      task.createdAt ? new Date(task.createdAt) : new Date(),
      task.completedAt ? new Date(task.completedAt) : null,
    ]
  );
}

export async function getTaskRecord(taskId: string): Promise<any | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.tasks.get(taskId) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at FROM shunops_tasks WHERE id = $1 LIMIT 1;`,
    [taskId]
  );
  return rows[0] || null;
}

export async function listUserTasks(userId: number, limit = 50): Promise<any[]> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.tasks.values())
      .filter((t) => t.user_id === userId)
      .slice(-limit)
      .reverse();
  }
  const rows = await (sql as any).query(
    `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at FROM shunops_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2;`,
    [userId, limit]
  );
  return rows || [];
}

// ==========================================
// PERSONAL API KEYS (PER-USER KEYS)
// ==========================================

export async function createApiKey(userId: number, name: string): Promise<{ id: number; rawKey: string; keyPrefix: string }> {
  const rawKey = `shun_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = hashToken(rawKey);
  const keyPrefix = rawKey.slice(0, 9); // e.g., 'shun_a1b2'

  const sql = getSql();
  if (!sql) {
    const id = memStore.nextKeyId++;
    memStore.apiKeys.set(keyHash, {
      id,
      userId,
      prefix: keyPrefix,
      name,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    return { id, rawKey, keyPrefix };
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_api_keys (user_id, key_hash, key_prefix, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id;`,
    [userId, keyHash, keyPrefix, name]
  );
  return { id: rows[0].id, rawKey, keyPrefix };
}

export async function findUserByApiKey(rawKey: string): Promise<UserRecord | null> {
  if (!rawKey || !rawKey.startsWith("shun_")) return null;
  const keyHash = hashToken(rawKey);

  const sql = getSql();
  if (!sql) {
    const keyRecord = memStore.apiKeys.get(keyHash);
    if (!keyRecord) return null;
    keyRecord.lastUsedAt = new Date().toISOString();
    return memStore.users.get(keyRecord.userId) || null;
  }

  const rows = await (sql as any).query(
    `SELECT u.id, u.username, u.email, u.password_hash, u.google_id, u.github_id, u.email_verified, u.role, u.plan, u.query_count, u.created_at, k.id as key_id
     FROM shunops_api_keys k
     JOIN shunops_users u ON k.user_id = u.id
     WHERE k.key_hash = $1
     LIMIT 1;`,
    [keyHash]
  );

  if (rows[0]) {
    (sql as any).query(`UPDATE shunops_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1;`, [rows[0].key_id]).catch(() => {});
    return rows[0];
  }
  return null;
}

export async function listUserApiKeys(userId: number): Promise<Array<{ id: number; name: string; keyPrefix: string; created_at: string; last_used_at: string | null }>> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.apiKeys.values())
      .filter((k) => k.userId === userId)
      .map((k) => ({ id: k.id, name: k.name, keyPrefix: k.prefix, created_at: k.createdAt, last_used_at: k.lastUsedAt }));
  }

  const rows = await (sql as any).query(
    `SELECT id, name, key_prefix as "keyPrefix", created_at, last_used_at FROM shunops_api_keys WHERE user_id = $1 ORDER BY created_at DESC;`,
    [userId]
  );
  return rows || [];
}

export async function deleteApiKey(userId: number, keyId: number): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    for (const [h, k] of memStore.apiKeys.entries()) {
      if (k.userId === userId && k.id === keyId) {
        memStore.apiKeys.delete(h);
        return true;
      }
    }
    return false;
  }

  const result = await (sql as any).query(`DELETE FROM shunops_api_keys WHERE id = $1 AND user_id = $2 RETURNING id;`, [keyId, userId]);
  return result.length > 0;
}

// ==========================================
// ADMIN CONSOLE HELPERS
// ==========================================

export async function listAllUsers(limit = 50, offset = 0): Promise<UserRecord[]> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.users.values()).slice(offset, offset + limit);
  }
  const rows = await (sql as any).query(
    `SELECT id, username, email, email_verified, role, plan, query_count, created_at FROM shunops_users ORDER BY id ASC LIMIT $1 OFFSET $2;`,
    [limit, offset]
  );
  return rows || [];
}

export async function updateUserRole(userId: number, role: string): Promise<boolean> {
  const validRoles = ["user", "admin", "operator"];
  if (!validRoles.includes(role)) return false;

  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (!u) return false;
    u.role = role;
    return true;
  }

  const result = await (sql as any).query(
    `UPDATE shunops_users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id;`,
    [role, userId]
  );
  return result.length > 0;
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

export async function getSystemUserStats(): Promise<{ totalUsers: number; totalTasks: number; totalChatMessages: number }> {
  const sql = getSql();
  if (!sql) {
    return {
      totalUsers: memStore.users.size,
      totalTasks: memStore.tasks.size,
      totalChatMessages: memStore.chatMessages.length,
    };
  }

  const uRes = await (sql as any).query(`SELECT COUNT(*) as count FROM shunops_users;`);
  const tRes = await (sql as any).query(`SELECT COUNT(*) as count FROM shunops_tasks;`);
  const cRes = await (sql as any).query(`SELECT COUNT(*) as count FROM shunops_chat_messages;`);

  return {
    totalUsers: Number(uRes?.[0]?.count || 0),
    totalTasks: Number(tRes?.[0]?.count || 0),
    totalChatMessages: Number(cRes?.[0]?.count || 0),
  };
}

// ==========================================
// BILLING / METERING USAGE
// ==========================================

export const PLAN_LIMITS: Record<string, number> = {
  community: 100, // 100 free queries per month
  byok: 999999,   // Unlimited with own keys
  pro: 10000,     // 10,000 queries per month
};

export async function getUserUsageAndPlan(userId: number): Promise<{ plan: string; queryCount: number; limit: number }> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    const plan = u?.plan || "community";
    const queryCount = u?.query_count || 0;
    return { plan, queryCount, limit: PLAN_LIMITS[plan] || 100 };
  }

  const rows = await (sql as any).query(
    `SELECT plan, query_count FROM shunops_users WHERE id = $1 LIMIT 1;`,
    [userId]
  );
  const plan = rows[0]?.plan || "community";
  const queryCount = Number(rows[0]?.query_count || 0);
  return { plan, queryCount, limit: PLAN_LIMITS[plan] || 100 };
}

export async function incrementUserQueryCount(userId: number): Promise<{ allowed: boolean; queryCount: number; limit: number; plan: string }> {
  const usage = await getUserUsageAndPlan(userId);
  if (usage.queryCount >= usage.limit && usage.plan !== "byok") {
    return { allowed: false, queryCount: usage.queryCount, limit: usage.limit, plan: usage.plan };
  }

  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (u) u.query_count = (u.query_count || 0) + 1;
    return { allowed: true, queryCount: (usage.queryCount + 1), limit: usage.limit, plan: usage.plan };
  }

  await (sql as any).query(
    `UPDATE shunops_users SET query_count = query_count + 1 WHERE id = $1;`,
    [userId]
  );

  return { allowed: true, queryCount: usage.queryCount + 1, limit: usage.limit, plan: usage.plan };
}

// ==========================================
// DATABASE READINESS PROBE
// ==========================================

export async function checkDbHealth(): Promise<{ ok: boolean; status: string; latencyMs?: number; error?: string }> {
  const sql = getSql();
  if (!sql) {
    return { ok: true, status: "mock_memory_store" };
  }

  const start = Date.now();
  try {
    await (sql as any).query(`SELECT 1;`);
    const latencyMs = Date.now() - start;
    return { ok: true, status: "connected", latencyMs };
  } catch (err: any) {
    return { ok: false, status: "error", error: err.message || "Postgres health check failed" };
  }
}
