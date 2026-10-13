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
  /**
   * Owning account. `null` means the request belongs to the operator (CLI/cron
   * or an admin run) and is therefore visible to admins only.
   */
  userId?: number | null;
  username?: string | null;
}

/** Who a run belongs to, so approvals can be routed to the right tenant. */
export interface ApprovalRequester {
  userId?: number | undefined;
  username?: string | undefined;
}

const pendingApprovals = new Map<string, ApprovalRequest>();
const approvalResolvers = new Map<string, (approved: boolean) => void>();

const REDIS_APPROVAL_PREFIX = "shunops:approvals:";
const REDIS_ACTIVE_SET = "shunops:approvals:active";

/** Persist approval request to distributed Redis cache with 5-minute TTL. */
async function persistApprovalToRedis(request: ApprovalRequest): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const key = `${REDIS_APPROVAL_PREFIX}${request.id}`;
    await redis.set(key, JSON.stringify(request), "EX", 300);
    await redis.sadd(REDIS_ACTIVE_SET, request.id);
  } catch {
    // Non-fatal, local memory map continues safely
  }
}

/** Clear active approval key from distributed Redis cache. */
async function settleApprovalInRedis(id: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const key = `${REDIS_APPROVAL_PREFIX}${id}`;
    await redis.srem(REDIS_ACTIVE_SET, id);
    await redis.del(key);
  } catch {
    // Non-fatal
  }
}

/** Rehydrate any pending approval requests stored in Redis across instance restarts. */
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
  } catch {
    // Non-fatal
  }
}

/**
 * Terminal state for an approval request: record the verdict and remove the
 * entry from the pending queue so the maps cannot grow without bound over the
 * lifetime of a long-running server.
 */
function settleApproval(request: ApprovalRequest, approved: boolean): void {
  request.status = approved ? "approved" : "rejected";
  pendingApprovals.delete(request.id);
  approvalResolvers.delete(request.id);
  settleApprovalInRedis(request.id).catch(() => {});
}

/**
 * Heuristics to check if an action is potentially destructive/sensitive
 */
export function isActionSensitive(command: string): { isSensitive: boolean; reason: string } {
  const normalized = command.trim().toLowerCase();

  // Database sensitive keywords
  if (/\b(drop\s+table|drop\s+database|drop\s+schema|truncate|delete\s+from|alter\s+table|update\s+\w+\s+set\b|grant\s+all|revoke\s+)\b/i.test(normalized)) {
    return {
      isSensitive: true,
      reason: "Destructive or privilege-altering database operation.",
    };
  }

  // Filesystem and OS destructive patterns
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

  // Privilege escalation or permission tampering
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

  // Remote code execution / pipe-to-shell / encoded payloads
  if (
    /\|\s*(sudo\s+)?(ba|z|k)?sh\b/.test(normalized) ||
    /(curl|wget)[^|;&]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/.test(normalized) ||
    /(^|[\s;&|])eval\s/.test(normalized) ||
    /base64\s+(-d|--decode)/.test(normalized) ||
    /(^|[\s;&|])nc\s+.*-e/.test(normalized) ||
    /(^|[\s;&|])ncat\s+.*-e/.test(normalized) ||
    /(^|[\s;&|])bash\s+-c\b/.test(normalized) ||
    /(^|[\s;&|])sh\s+-c\b/.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Remote-code-execution or encoded-payload execution pattern detected.",
    };
  }

  // Git dangerous commands
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

  // Cloud infrastructure teardown
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

  // Inline script and language runtime evaluation (bypasses static shell regex)
  if (
    /(^|[\s;&|])node(\.exe)?\s+(-e|--eval)\b/.test(normalized) ||
    /(^|[\s;&|])python[23]?(\.exe)?\s+-c\b/.test(normalized) ||
    /(^|[\s;&|])perl\s+-e\b/.test(normalized) ||
    /(^|[\s;&|])ruby\s+-e\b/.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Direct inline code evaluation (node -e / python -c) detected.",
    };
  }

  // File search-and-destroy patterns
  if (/(^|[\s;&|])find\s+.*-(delete|exec\s+rm)\b/.test(normalized)) {
    return {
      isSensitive: true,
      reason: "Recursive search-and-delete filesystem operation detected.",
    };
  }

  // Shell evasion ($IFS) and critical path redirections
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

  // Destructive operations in GitHub, YouTube, Kaggle, and Cloudflare tools
  if (
    /^github\s+(delete_|force_push|destroy)/i.test(normalized) ||
    /^youtube\s+(delete|destroy|remove)/i.test(normalized) ||
    /^kaggle\s+(delete|destroy|remove)/i.test(normalized) ||
    /^auto_heal\s+.*(delete|destroy|purge)/i.test(normalized) ||
    /^write_file\s+.*\.env/i.test(normalized)
  ) {
    return {
      isSensitive: true,
      reason: "Destructive cloud resource deletion, forced overwrite, or secret mutation requested.",
    };
  }

  return { isSensitive: false, reason: "" };
}

/**
 * Sends an alert to Telegram if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are present
 */
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

/**
 * Prompt user in CLI or queue for remote approval
 */
export async function requestHumanApproval(
  action: string,
  commandOrPayload: string,
  riskReason: string,
  requester: ApprovalRequester = {}
): Promise<{ approved: boolean; message: string }> {
  // Use a cryptographically strong random suffix: approval IDs must be
  // unguessable so a third party cannot approve/reject a pending action.
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

  // Fire the alert without awaiting it: the non-interactive resolver below must
  // be registered in this same tick. Awaiting first left a window where the
  // request was already listed as pending but had no resolver, so a prompt
  // /api/approve would be rejected as "not found" and the action would hang
  // until it timed out.
  // A tenant's request belongs in that tenant's own approval queue: sending it
  // to the operator's Telegram would leak the user's payload off-platform.
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

  // Interactive CLI prompt
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
    const timer = setTimeout(() => {
      if (pendingApprovals.get(id)?.status === "pending") {
        settleApproval(request, false);
        resolve({ approved: false, message: `Approval timed out after 5 minutes (${id}).` });
      }
    }, 5 * 60 * 1000);

    approvalResolvers.set(id, (approved: boolean) => {
      clearTimeout(timer);
      settleApproval(request, approved);
      if (approved) {
        resolve({ approved: true, message: `Action remotely approved (${id}).` });
      } else {
        resolve({ approved: false, message: `Action remotely rejected (${id}).` });
      }
    });
  });
}

/**
 * Handle remote approval from API endpoint /api/approve
 */
export function resolveApproval(
  id: string,
  approved: boolean,
  requester: { userId?: number | undefined; isAdmin?: boolean } = {}
): boolean {
  if (typeof id !== "string") return false;
  const resolver = approvalResolvers.get(id);
  const request = pendingApprovals.get(id);
  // Settle if request exists (either with live local resolver, or rehydrated from Redis across restarts)
  if (!request) return false;

  // Tenant isolation: a signed-in user may only settle their own request. An
  // internal caller that passes no userId keeps admin power (CLI/cron/admin).
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

/**
 * Pending approvals. Pass a userId to get only that account's requests; call
 * with no argument (admin scope) to see everything.
 */
export function listPendingApprovals(userId?: number): ApprovalRequest[] {
  const pending = Array.from(pendingApprovals.values()).filter((r) => r.status === "pending");
  if (typeof userId === "number") {
    return pending.filter((r) => r.userId === userId);
  }
  return pending;
}
