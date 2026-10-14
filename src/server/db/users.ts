import { getSql, memStore } from "./store.js";

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
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  created_at: string;
}

const USER_COLUMNS =
  "id, username, email, password_hash, google_id, github_id, email_verified, role, plan, query_count, input_tokens, output_tokens, total_tokens, created_at";

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.usersByUsername.get(username.toLowerCase()) || null;
  }
  const rows = await (sql as any).query(
    `SELECT ${USER_COLUMNS} FROM shunops_users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
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
    `SELECT ${USER_COLUMNS} FROM shunops_users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
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
    `SELECT ${USER_COLUMNS} FROM shunops_users WHERE google_id = $1 LIMIT 1;`,
    [googleId]
  );
  return rows[0] || null;
}

export async function findUserByGithubId(githubId: string): Promise<UserRecord | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.usersByGithubId.get(githubId) || null;
  }
  const rows = await (sql as any).query(
    `SELECT ${USER_COLUMNS} FROM shunops_users WHERE github_id = $1 LIMIT 1;`,
    [githubId]
  );
  return rows[0] || null;
}

/** Every user gets a personal workspace row; keep creation in one place. */
async function createDefaultWorkspace(sql: any, userId: number, username: string): Promise<void> {
  await sql.query(
    `INSERT INTO shunops_user_workspaces (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING;`,
    [userId, `${username}'s Workspace`]
  );
}

function rememberUserInMemory(user: UserRecord): UserRecord {
  memStore.users.set(user.id, user);
  memStore.usersByUsername.set(user.username.toLowerCase(), user);
  if (user.email) memStore.usersByEmail.set(user.email.toLowerCase(), user);
  if (user.google_id) memStore.usersByGoogleId.set(user.google_id, user);
  if (user.github_id) memStore.usersByGithubId.set(user.github_id, user);
  return user;
}

/** Appends `_1`, `_2`, ... until the candidate username is unused. */
async function resolveUniqueUsername(baseUsername: string): Promise<string> {
  let username = baseUsername;
  let counter = 1;
  while (await findUserByUsername(username)) {
    username = `${baseUsername}_${counter++}`;
  }
  return username;
}

/** Derives a safe, slug-like username from a display name or email local part. */
function slugifyUsername(candidate: string, fallbackPrefix: string): string {
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);
  return slug.length >= 3 ? slug : `${fallbackPrefix}_${Date.now().toString(36)}`;
}

export async function createUser(
  username: string,
  passwordHash: string | null,
  email?: string,
  emailVerified = false
): Promise<UserRecord> {
  const sql = getSql();
  if (!sql) {
    return rememberUserInMemory({
      id: memStore.nextUserId++,
      username,
      email: email || null,
      password_hash: passwordHash,
      email_verified: emailVerified,
      role: "user",
      plan: "community",
      query_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      created_at: new Date().toISOString(),
    });
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLUMNS};`,
    [username, email || null, passwordHash, emailVerified]
  );
  const user = rows[0];

  await createDefaultWorkspace(sql as any, user.id, username);

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
       RETURNING ${USER_COLUMNS};`,
      [googleId, byEmail.id]
    );
    return updated[0];
  }

  const baseUsername = slugifyUsername(name || cleanEmail.split("@")[0] || "user", "user");
  const username = await resolveUniqueUsername(baseUsername);

  if (!sql) {
    return rememberUserInMemory({
      id: memStore.nextUserId++,
      username,
      email: cleanEmail,
      password_hash: null,
      google_id: googleId,
      email_verified: true,
      role: "user",
      plan: "community",
      query_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      created_at: new Date().toISOString(),
    });
  }

  try {
    const rows = await (sql as any).query(
      `INSERT INTO shunops_users (username, email, google_id, email_verified)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (google_id) DO UPDATE SET email_verified = TRUE, updated_at = CURRENT_TIMESTAMP
       RETURNING ${USER_COLUMNS};`,
      [username, cleanEmail, googleId]
    );
    const user = rows[0];
    await createDefaultWorkspace(sql as any, user.id, user.username);
    return user;
  } catch {
    // Handle concurrent TOCTOU race on email/username unique constraint
    const existing = (await findUserByGoogleId(googleId)) || (await findUserByEmail(cleanEmail));
    if (existing) return existing;
    throw new Error("Failed to upsert Google user account.");
  }
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
       RETURNING ${USER_COLUMNS};`,
      [githubId, byEmail.id]
    );
    return updated[0];
  }

  const baseUsername = slugifyUsername(login || name || cleanEmail.split("@")[0] || "gh_user", "gh");
  const username = await resolveUniqueUsername(baseUsername);

  if (!sql) {
    return rememberUserInMemory({
      id: memStore.nextUserId++,
      username,
      email: cleanEmail,
      password_hash: null,
      github_id: githubId,
      email_verified: true,
      role: "user",
      plan: "community",
      query_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      created_at: new Date().toISOString(),
    });
  }

  try {
    const rows = await (sql as any).query(
      `INSERT INTO shunops_users (username, email, github_id, email_verified)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (github_id) DO UPDATE SET email_verified = TRUE, updated_at = CURRENT_TIMESTAMP
       RETURNING ${USER_COLUMNS};`,
      [username, cleanEmail, githubId]
    );
    const user = rows[0];
    await createDefaultWorkspace(sql as any, user.id, user.username);
    return user;
  } catch {
    // Handle concurrent TOCTOU race on email/username unique constraint
    const existing = (await findUserByGithubId(githubId)) || (await findUserByEmail(cleanEmail));
    if (existing) return existing;
    throw new Error("Failed to upsert GitHub user account.");
  }
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
