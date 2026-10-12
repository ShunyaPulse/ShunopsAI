import { getSql, memStore } from "./store.js";

// ==========================================
// BILLING / METERING USAGE
// ==========================================

export const PLAN_LIMITS: Record<string, number> = {
  community: 100, // 100 free queries per month
  byok: 999999,   // Unlimited with own keys
  pro: 10000,     // 10,000 queries per month
};

const DEFAULT_PLAN = "community";

export interface UserUsage {
  plan: string;
  queryCount: number;
  limit: number;
}

export interface QueryMeterResult {
  allowed: boolean;
  queryCount: number;
  limit: number;
  plan: string;
}

export async function getUserUsageAndPlan(userId: number): Promise<UserUsage> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    const plan = u?.plan || DEFAULT_PLAN;
    const queryCount = u?.query_count || 0;
    return { plan, queryCount, limit: PLAN_LIMITS[plan] || 100 };
  }

  const rows = await (sql as any).query(
    `SELECT plan, query_count FROM shunops_users WHERE id = $1 LIMIT 1;`,
    [userId]
  );
  const plan = rows[0]?.plan || DEFAULT_PLAN;
  const queryCount = Number(rows[0]?.query_count || 0);
  return { plan, queryCount, limit: PLAN_LIMITS[plan] || 100 };
}

export async function incrementUserQueryCount(userId: number): Promise<QueryMeterResult> {
  const usage = await getUserUsageAndPlan(userId);
  if (usage.queryCount >= usage.limit && usage.plan !== "byok") {
    return { allowed: false, queryCount: usage.queryCount, limit: usage.limit, plan: usage.plan };
  }

  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (u) u.query_count = (u.query_count || 0) + 1;
    return { allowed: true, queryCount: usage.queryCount + 1, limit: usage.limit, plan: usage.plan };
  }

  await (sql as any).query(
    `UPDATE shunops_users SET query_count = query_count + 1 WHERE id = $1;`,
    [userId]
  );

  return { allowed: true, queryCount: usage.queryCount + 1, limit: usage.limit, plan: usage.plan };
}
