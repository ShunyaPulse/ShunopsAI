import { evaluateToolRiskWithFullContext } from "../ai/decisions.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomInt } from "node:crypto";

import { getRedisClient } from "../server/redis.js";

export interface ApprovalRequest {
  id: string;
  action: string;
  commandOrPayload: string;
  riskReason: string;
  timestamp: string;
  status: "pending" | "approved" | "rejected";
  userId?: number | null;
  username?: string | null;
}

export interface ApprovalRequester {
  userId?: number | undefined;
  username?: string | undefined;
}

const pendingApprovals = new Map<string, ApprovalRequest>();
const approvalResolvers = new Map<string, (approved: boolean) => void>();

const REDIS_APPROVAL_PREFIX = "shunops:approvals:";
const REDIS_ACTIVE_SET = "shunops:approvals:active";

/**
 * Tools that are strictly read-only or non-destructive by design.
 * Skipping Mammoth-1 network calls on these saves ~400-800ms per tool step
 * and eliminates false-positive human approval blocks on harmless reads.
 */
const INHERENTLY_SAFE_READ_ONLY_TOOLS = new Set<string>([
  "web_search",
  "search_knowledge_base",
  "inspect_website",
  "read_file",
  "list_directory",
  "sentinel_health_check",
  "ask_user_confirmation",
  "dual_model_consensus",
  "run_cloudflare_ai",
  "execute_sandboxed_code",
  "delegate_to_agent_swarm",
]);

/**
 * Checks whether a tool invocation is a known read-only / non-destructive operation
 * that does not need an external Mammoth-1 network audit after passing static regex checks.
 */
function isSafeNonDestructiveToolInvocation(toolName: string | undefined, command: string): boolean {
  if (!toolName) return false;
  if (INHERENTLY_SAFE_READ_ONLY_TOOLS.has(toolName)) {
    return true;
  }

  const norm = command.trim().toLowerCase();

  // Workspace & Agentic tools: read/list/recall/add/create_plan are non-destructive
  if (
    toolName === "manage_agent_memory" ||
    toolName === "manage_agent_tasks" ||
    toolName === "manage_workspace_files" ||
    toolName === "manage_agent_schedules" ||
    toolName === "index_knowledge_document"
  ) {
    return !/\b(delete_all|purge|drop|destroy)\b/i.test(norm);
  }

  // Pure read-only SQL queries (already passed static regex in isActionSensitive)
  if (toolName === "execute_neon_sql") {
    return /^(select|explain|show|with)\b/i.test(norm);
  }

  // Read-only Redis commands
  if (toolName === "execute_redis_command") {
    return /^(get|mget|hget|hgetall|keys|scan|ttl|pttl|exists|type|llen|lrange|smembers|scard|zrange|info|ping|dbsize)\b/i.test(
      norm
    );
  }

  // Read-only GitHub operations
  if (toolName === "manage_github") {
    return /^github\s+(list_|get_|search_|view_|check_)/i.test(norm);
  }

  // Read-only GCP & Kaggle status/list checks
  if (toolName === "inspect_gcp_cloud") {
    return /^(list_|read_|get_|query_)/i.test(norm);
  }
  if (toolName === "manage_kaggle") {
    return /^kaggle\s+(list|status|output)\b/i.test(norm);
  }

  return false;
}

/** Persist approval request to distributed Redis cache with 5-minute TTL. */
async function persistApprovalToRedis(request: ApprovalRequest): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const key = `${REDIS_APPROVAL_PREFIX}${request.id}`;
    await redis.set(key, JSON.stringify(request), "EX", 300);
    await redis.sadd(REDIS_ACTIVE_SET, request.id);
  } catch {}
}

async function settleApprovalInRedis(request: ApprovalRequest): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const key = `${REDIS_APPROVAL_PREFIX}${request.id}`;
    await redis.srem(REDIS_ACTIVE_SET, request.id);
    await redis.set(key, JSON.stringify(request), "EX", 60);
  } catch {}
}

export async function rehydratePendingApprovalsFromRedis(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const activeIds = await redis.smembers(REDIS_ACTIVE_SET);
    if (!activeIds || activeIds.length === 0) return;

    for (const id of activeIds) {
      if (pendingApprovals.has(id)) continue;
      const raw = await redis.get(`${REDIS_APPROVAL_PREFIX}${id}`);
      if (!raw) {
        await redis.srem(REDIS_ACTIVE_SET, id);
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as ApprovalRequest;
        if (parsed.status === "pending") {
          pendingApprovals.set(parsed.id, parsed);
        } else {
          await redis.srem(REDIS_ACTIVE_SET, id);
        }
      } catch {
        await redis.srem(REDIS_ACTIVE_SET, id);
      }
    }
  } catch {}
}

function settleApproval(request: ApprovalRequest, approved: boolean): void {
  request.status = approved ? "approved" : "rejected";
  pendingApprovals.delete(request.id);
  approvalResolvers.delete(request.id);
  settleApprovalInRedis(request).catch(() => {});
}

/**
 * Evaluates whether an action is potentially destructive or sensitive:
 * 1. Instant static regex check (0ms) catches explicit destructive patterns.
 * 2. Fast-paths read-only / non-destructive tools in 0ms (no forced Mammoth calls).
 * 3. Uses Baseten Mammoth 1 decision model ONLY for ambiguous mutating / host / cloud actions
 *    with full semantic context (task goal, environment, arguments, and intent alignment).
 */
export async function isActionSensitiveAsync(
  command: string,
  context?: {
    toolName?: string | undefined;
    taskGoal?: string | undefined;
    tenantUserId?: number | null | undefined;
    environment?: string | undefined;
  }
): Promise<{ isSensitive: boolean; reason: string }> {
  // 1. Instant static regex check (0ms)
  const syncCheck = isActionSensitive(command);
  if (syncCheck.isSensitive) {
    return syncCheck;
  }

  // 2. Skip network call for known read-only or harmless workspace operations (0ms)
  if (isSafeNonDestructiveToolInvocation(context?.toolName, command)) {
    return { isSensitive: false, reason: "" };
  }

  // 3. Full-Context Baseten Mammoth 1 Semantic Decision for ambiguous mutating/host commands
  try {
    const verdict = await evaluateToolRiskWithFullContext({
      toolName: context?.toolName || "tool",
      taskGoal: context?.taskGoal,
      payload: command,
      environment: context?.environment,
      tenantUserId: context?.tenantUserId,
    });
    if (verdict?.requiresApproval) {
      return {
        isSensitive: true,
        reason: verdict.rationale,
      };
    }
  } catch {}

  return { isSensitive: false, reason: "" };
}

export function isActionSensitive(command: string): { isSensitive: boolean; reason: string } {
  const normalized = command
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .trim()
    .toLowerCase();

  if (
    /\b(drop\s+table|drop\s+database|drop\s+schema|truncate|delete\s+from|alter\s+table|update\s+\w+\s+set\b|grant\s+all|revoke\s+|copy\s+.*\bprogram\b|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export)\b/i.test(
      normalized
    )
  ) {
    return {
      isSensitive: true,
      reason: "Destructive, privilege-altering, or host-accessing database operation.",
    };
  }

  if (
    /(^|[\s;&|])rm\s+-[a-z]*r[a-z]*f|(^|[\s;&|])rm\s+-[a-z]*f[a-z]*r/.test(normalized) ||
    normalized.includes("rm -rf") ||
    normalized.includes("rmdir /s") ||
    normalized.includes("del /f") ||
    normalized.includes("del /q") ||
    normalized.includes("format ") ||
    normalized.includes("mkfs") ||
    normalized.includes("wipefs") ||
    /(^|[\s;&|])dd\s+if=/.test(normalized) ||
    normalized.includes("shred ")
  ) {
    return {
      isSensitive: true,
      reason: "Recursive filesystem deletion, formatting, or disk overwrite detected.",
    };
  }

  if (
    /(^|[\s;&|])sudo\b/.test(normalized) ||
    /(^|[\s;&|])su\s/.test(normalized) ||
    /chmod\s+(-[a-z]+\s+)*777/.test(normalized) ||
    /(^|[\s;&|])(chown|useradd|userdel|passwd|crontab|visudo|iptables|ufw)\b/.test(normalized) ||
    normalized.includes("setcap ") ||
    /(^|[\s;&|])(shutdown|reboot|halt|poweroff)\b/.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Privilege escalation, permission tampering, or host power control detected.",
    };
  }

  if (
    /\|\s*(sudo\s+)?(ba|z|k)?sh\b/.test(normalized) ||
    /(curl|wget)[^|;&]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/.test(normalized) ||
    /(^|[\s;&|])eval\s/.test(normalized) ||
    /base64\s+(-d|--decode)/.test(normalized) ||
    /(^|[\s;&|])nc\s+.*-e/.test(normalized) ||
    /(^|[\s;&|])ncat\s+.*-e/.test(normalized) ||
    /(^|[\s;&|])bash\s+-c\b/.test(normalized) ||
    /(^|[\s;&|])sh\s+-c\b/.test(normalized) ||
    /\$\([^)]+\)/.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Remote-code-execution, command substitution, or encoded-payload execution pattern detected.",
    };
  }

  if (
    normalized.includes("git push --force") ||
    normalized.includes("git push -f") ||
    normalized.includes("git reset --hard") ||
    normalized.includes("git clean -fdx") ||
    normalized.includes("git clean -fd") ||
    normalized.includes("git filter-branch")
  ) {
    return {
      isSensitive: true,
      reason: "Destructive Git history rewrite or unrecoverable reset.",
    };
  }

  if (
    normalized.includes("gcloud run services delete") ||
    normalized.includes("gcloud compute instances delete") ||
    normalized.includes("gcloud projects delete") ||
    normalized.includes("wrangler delete") ||
    normalized.includes("wrangler kv:bulk delete") ||
    normalized.includes("flushall") ||
    normalized.includes("flushdb") ||
    normalized.includes("drop database")
  ) {
    return {
      isSensitive: true,
      reason: "Cloud service teardown or in-memory cache purge.",
    };
  }

  if (
    /(^|[\s;&|])node(\.exe)?\s+(-e|--eval)\b/.test(normalized) ||
    /(^|[\s;&|])python[23]?(\.exe)?\s+(-c|-m)\b/.test(normalized) ||
    /(^|[\s;&|])perl\s+-e\b/.test(normalized) ||
    /(^|[\s;&|])ruby\s+-e\b/.test(normalized) ||
    /(^|[\s;&|])(npx|tsx|bunx|deno\s+eval)\b/.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Direct inline code or package runner evaluation detected.",
    };
  }

  if (/(^|[\s;&|])find\s+.*-(delete|exec\s+rm)\b/.test(normalized)) {
    return {
      isSensitive: true,
      reason: "Recursive search-and-delete filesystem operation detected.",
    };
  }

  if (
    normalized.includes("$ifs") ||
    normalized.includes("${ifs}") ||
    />\s*(\/etc\/|\/boot\/|\.env|c:\\windows)/i.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Shell delimiter manipulation ($IFS) or sensitive file overwrite redirection detected.",
    };
  }

  if (
    /^github\s+(delete_|force_push|destroy)/i.test(normalized) ||
    /^youtube\s+(delete|destroy|remove)/i.test(normalized) ||
    /^kaggle\s+(delete|destroy|remove)/i.test(normalized) ||
    /^auto_heal\s+.*(delete|destroy|purge)/i.test(normalized) ||
    /^write_file\s+.*(\.env|\.github[\\/]workflows|package\.json|dockerfile|\.sh\b|\.ps1\b)/i.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Destructive cloud resource deletion, workflow/manifest modification, or secret mutation requested.",
    };
  }

  return { isSensitive: false, reason: "" };
}

async function notifyTelegram(request: ApprovalRequest): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  try {
    const text = `🚨 *[SENSITIVE ACTION APPROVAL REQUIRED]*\n\n*Action:* ${request.action}\n*Reason:* ${request.riskReason}\n*Payload:*\n\`\`\`\n${request.commandOrPayload}\n\`\`\`\n_Pending approval ID: ${request.id}_`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err: any) {
    console.warn(`[Telegram Notification Error]: ${err.message}`);
  }
}

export async function requestHumanApproval(
  action: string,
  commandOrPayload: string,
  riskReason: string,
  requester: ApprovalRequester = {}
): Promise<{ approved: boolean; message: string }> {
  const id = `req_${Date.now()}_${randomInt(0, 0xffffffff).toString(36)}`;
  const tenantUserId =
    typeof requester.userId === "number" && requester.userId > 0 ? requester.userId : null;
  const request: ApprovalRequest = {
    id,
    action,
    commandOrPayload,
    riskReason,
    timestamp: new Date().toISOString(),
    status: "pending",
    userId: tenantUserId,
    username: requester.username ?? null,
  };

  pendingApprovals.set(id, request);
  persistApprovalToRedis(request).catch(() => {});

  const telegramAlert = tenantUserId === null ? notifyTelegram(request).catch(() => {}) : Promise.resolve();

  console.log(`\n\x1b[31m\x1b[1m========================================================\x1b[0m`);
  console.log(`\x1b[31m\x1b[1m⚠️  [HUMAN-IN-THE-LOOP APPROVAL REQUIRED]\x1b[0m`);
  if (tenantUserId !== null) {
    console.log(
      `\x1b[33mTenant:\x1b[0m user_${tenantUserId} — awaiting approval in their own workspace (${id})`
    );
  }
  console.log(`\x1b[33mAction:\x1b[0m ${action}`);
  console.log(`\x1b[33mRisk Reason:\x1b[0m ${riskReason}`);
  console.log(`\x1b[33mCommand / Payload:\x1b[0m\n${commandOrPayload}`);
  console.log(`\x1b[31m\x1b[1m========================================================\x1b[0m`);

  if (process.stdin.isTTY) {
    await telegramAlert;
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        `\x1b[32mApprove this sensitive execution? (y/N): \x1b[0m`
      );
      rl.close();

      const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      settleApproval(request, approved);

      if (approved) {
        return { approved: true, message: `Action approved by user (${id}). Proceeding.` };
      } else {
        return {
          approved: false,
          message: `Action was REJECTED by user (${id}). Aborting sensitive operation.`,
        };
      }
    } catch {
      rl.close();
      settleApproval(request, false);
      return { approved: false, message: "Approval prompt aborted." };
    }
  }

  // Non-interactive / API server mode: Wait for external resolution via /api/approve
  return new Promise((resolve) => {
    let settled = false;

    const finish = (approved: boolean, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (redisPollTimer) clearInterval(redisPollTimer);
      settleApproval(request, approved);
      resolve({ approved, message });
    };

    const timer = setTimeout(() => {
      if (pendingApprovals.get(id)?.status === "pending") {
        finish(false, `Approval timed out after 5 minutes (${id}).`);
      }
    }, 5 * 60 * 1000);
    if (typeof (timer as any).unref === "function") (timer as any).unref();

    const redis = getRedisClient();
    const redisPollTimer = redis
      ? setInterval(async () => {
          if (settled || redis.status !== "ready") return;
          try {
            const raw = await redis.get(`${REDIS_APPROVAL_PREFIX}${id}`);
            if (!raw) return;
            const parsed = JSON.parse(raw) as ApprovalRequest;
            if (parsed.status === "approved") {
              finish(true, `Action remotely approved (${id}).`);
            } else if (parsed.status === "rejected") {
              finish(false, `Action remotely rejected (${id}).`);
            }
          } catch {}
        }, 1500)
      : null;
    if (redisPollTimer && typeof (redisPollTimer as any).unref === "function") {
      (redisPollTimer as any).unref();
    }

    approvalResolvers.set(id, (approved: boolean) => {
      finish(
        approved,
        approved ? `Action remotely approved (${id}).` : `Action remotely rejected (${id}).`
      );
    });
  });
}

export function resolveApproval(
  id: string,
  approved: boolean,
  requester: { userId?: number | undefined; isAdmin?: boolean } = {}
): boolean {
  if (typeof id !== "string") return false;
  const resolver = approvalResolvers.get(id);
  const request = pendingApprovals.get(id);
  if (!request) return false;

  const isAdmin = requester.isAdmin ?? requester.userId === undefined;
  if (!isAdmin && request.userId != null && request.userId !== requester.userId) {
    return false;
  }

  if (typeof resolver === "function") {
    resolver(approved);
  }
  settleApproval(request, approved);
  return true;
}

export function listPendingApprovals(userId?: number): ApprovalRequest[] {
  const pending = Array.from(pendingApprovals.values()).filter((r) => r.status === "pending");
  if (typeof userId === "number") {
    return pending.filter((r) => r.userId === userId);
  }
  return pending;
}
