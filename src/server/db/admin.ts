import { getSql, memStore } from "./store.js";
import type { UserRecord } from "./users.js";

// ==========================================
// ADMIN CONSOLE HELPERS
// ==========================================

export const ASSIGNABLE_ROLES = ["user", "admin", "operator"] as const;

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
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) return false;

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
