import crypto from "crypto";
import { getSql, hashToken, memStore } from "./store.js";
import type { UserRecord } from "./users.js";

// ==========================================
// PERSONAL API KEYS (PER-USER KEYS)
// ==========================================

export interface CreatedApiKey {
  id: number;
  rawKey: string;
  keyPrefix: string;
}

export interface ApiKeySummary {
  id: number;
  name: string;
  keyPrefix: string;
  created_at: string;
  last_used_at: string | null;
}

export async function createApiKey(userId: number, name: string): Promise<CreatedApiKey> {
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
    `SELECT u.id, u.username, u.email, u.password_hash, u.google_id, u.github_id,
            u.email_verified, u.role, u.plan, u.query_count,
            u.input_tokens, u.output_tokens, u.total_tokens, u.created_at,
            k.id as key_id
     FROM shunops_api_keys k
     JOIN shunops_users u ON k.user_id = u.id
     WHERE k.key_hash = $1
     LIMIT 1;`,
    [keyHash]
  );

  if (rows[0]) {
    // Last-used tracking is fire-and-forget: never block an authenticated request on it.
    (sql as any)
      .query(`UPDATE shunops_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1;`, [rows[0].key_id])
      .catch(() => {});
    return rows[0];
  }
  return null;
}

export async function listUserApiKeys(userId: number): Promise<ApiKeySummary[]> {
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
