import { getSql, memStore } from "./store.js";

// ==========================================
// MODERN INDUSTRY-GRADE TOKEN BILLING & METERING
// Replaces simplistic request counters with input & output token quotas
// and automatic 30-day rolling monthly billing cycle resets.
// ==========================================

export const TOKEN_PLAN_LIMITS: Record<string, number> = {
  community: 1_500_000,    // 1,500,000 Total Monthly Tokens (Free Community Tier - Generous zero-cost quota)
  byok: 999_999_999,       // Unlimited with Bring-Your-Own-Key
  pro: 25_000_000,         // 25,000,000 Total Monthly Tokens (Pro Tier)
};

// Maintained for backward compatibility; points to modern token allocations
export const PLAN_LIMITS: Record<string, number> = {
  community: 1_500_000,
  byok: 999_999_999,
  pro: 25_000_000,
};

const DEFAULT_PLAN = "community";
const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day billing cycle

export interface UserUsage {
  plan: string;
  queryCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenLimit: number;
  limit: number; // Aliased to tokenLimit for backward compatibility
  lastResetAt?: string | undefined;
}

export interface TokenMeterResult {
  allowed: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenLimit: number;
  queryCount: number;
  limit: number;
  plan: string;
}

export type QueryMeterResult = TokenMeterResult;

function isMonthlyCycleExpired(lastResetAt: unknown): boolean {
  if (!lastResetAt) return false;
  const ts = new Date(String(lastResetAt)).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Date.now() - ts >= MONTHLY_WINDOW_MS;
}

export async function getUserUsageAndPlan(userId: number): Promise<UserUsage> {
  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (u && isMonthlyCycleExpired(u.last_reset_at)) {
      u.query_count = 0;
      u.input_tokens = 0;
      u.output_tokens = 0;
      u.total_tokens = 0;
      u.last_reset_at = new Date().toISOString();
    }
    const plan = u?.plan || DEFAULT_PLAN;
    const queryCount = Number(u?.query_count || 0);
    const inputTokens = Number(u?.input_tokens || 0);
    const outputTokens = Number(u?.output_tokens || 0);
    const totalTokens = Number(u?.total_tokens || inputTokens + outputTokens);
    const tokenLimit = TOKEN_PLAN_LIMITS[plan] ?? 1_500_000;
    return {
      plan,
      queryCount,
      inputTokens,
      outputTokens,
      totalTokens,
      tokenLimit,
      limit: tokenLimit,
      lastResetAt: u?.last_reset_at,
    };
  }

  let rows = await (sql as any).query(
    `SELECT plan, query_count, input_tokens, output_tokens, total_tokens, last_reset_at
     FROM shunops_users WHERE id = $1 LIMIT 1;`,
    [userId]
  );
  let row = rows[0];

  // Automatic 30-day rolling monthly quota reset
  if (row && isMonthlyCycleExpired(row.last_reset_at)) {
    try {
      const resetRows = await (sql as any).query(
        `UPDATE shunops_users
         SET query_count = 0,
             input_tokens = 0,
             output_tokens = 0,
             total_tokens = 0,
             last_reset_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING plan, query_count, input_tokens, output_tokens, total_tokens, last_reset_at;`,
        [userId]
      );
      if (resetRows[0]) row = resetRows[0];
    } catch {}
  }

  const plan = row?.plan || DEFAULT_PLAN;
  const queryCount = Number(row?.query_count || 0);
  const inputTokens = Number(row?.input_tokens || 0);
  const outputTokens = Number(row?.output_tokens || 0);
  const totalTokens = Number(row?.total_tokens || inputTokens + outputTokens);
  const tokenLimit = TOKEN_PLAN_LIMITS[plan] ?? 1_500_000;

  return {
    plan,
    queryCount,
    inputTokens,
    outputTokens,
    totalTokens,
    tokenLimit,
    limit: tokenLimit,
    lastResetAt: row?.last_reset_at,
  };
}

/**
 * Pre-flight check: determines if user has remaining token allowance before inference.
 */
export async function checkUserTokenQuota(
  userId: number,
  estimatedTokens: number = 0
): Promise<{ allowed: boolean; usage: UserUsage }> {
  const usage = await getUserUsageAndPlan(userId);
  if (usage.plan === "byok") {
    return { allowed: true, usage };
  }
  const isAllowed = usage.totalTokens + estimatedTokens < usage.tokenLimit;
  return { allowed: isAllowed, usage };
}

/**
 * Atomically records consumed input and output tokens upon completion.
 */
export async function recordUserTokenUsage(
  userId: number,
  inputTokens: number,
  outputTokens: number
): Promise<TokenMeterResult> {
  const inTok = Math.max(0, Math.round(inputTokens));
  const outTok = Math.max(0, Math.round(outputTokens));
  const addedTotal = inTok + outTok;

  const sql = getSql();
  if (!sql) {
    const u = memStore.users.get(userId);
    if (u) {
      if (isMonthlyCycleExpired(u.last_reset_at)) {
        u.query_count = 0;
        u.input_tokens = 0;
        u.output_tokens = 0;
        u.total_tokens = 0;
        u.last_reset_at = new Date().toISOString();
      }
      u.query_count = Number(u.query_count || 0) + 1;
      u.input_tokens = Number(u.input_tokens || 0) + inTok;
      u.output_tokens = Number(u.output_tokens || 0) + outTok;
      u.total_tokens = Number(u.total_tokens || 0) + addedTotal;
    }
    const usage = await getUserUsageAndPlan(userId);
    return {
      allowed: usage.plan === "byok" || usage.totalTokens <= usage.tokenLimit,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tokenLimit: usage.tokenLimit,
      queryCount: usage.queryCount,
      limit: usage.tokenLimit,
      plan: usage.plan,
    };
  }

  // Ensure monthly window reset is applied if expired before incrementing
  await getUserUsageAndPlan(userId).catch(() => {});

  const rows = await (sql as any).query(
    `UPDATE shunops_users 
     SET query_count = query_count + 1,
         input_tokens = COALESCE(input_tokens, 0) + $1,
         output_tokens = COALESCE(output_tokens, 0) + $2,
         total_tokens = COALESCE(total_tokens, 0) + $3
     WHERE id = $4
     RETURNING plan, query_count, input_tokens, output_tokens, total_tokens;`,
    [inTok, outTok, addedTotal, userId]
  );

  const row = rows[0];
  const plan = row?.plan || DEFAULT_PLAN;
  const tokenLimit: number = TOKEN_PLAN_LIMITS[plan] ?? 1_500_000;
  const totalTokens = Number(row?.total_tokens || 0);

  return {
    allowed: plan === "byok" || totalTokens <= tokenLimit,
    inputTokens: Number(row?.input_tokens || 0),
    outputTokens: Number(row?.output_tokens || 0),
    totalTokens,
    tokenLimit,
    queryCount: Number(row?.query_count || 0),
    limit: tokenLimit,
    plan,
  };
}

/**
 * Backward-compatible helper for legacy callers.
 */
export async function incrementUserQueryCount(userId: number): Promise<QueryMeterResult> {
  const usage = await getUserUsageAndPlan(userId);
  if (usage.totalTokens >= usage.tokenLimit && usage.plan !== "byok") {
    return {
      allowed: false,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tokenLimit: usage.tokenLimit,
      queryCount: usage.queryCount,
      limit: usage.limit,
      plan: usage.plan,
    };
  }
  return recordUserTokenUsage(userId, 0, 0);
}
