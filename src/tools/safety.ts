import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface ApprovalRequest {
  id: string;
  action: string;
  commandOrPayload: string;
  riskReason: string;
  timestamp: string;
  status: "pending" | "approved" | "rejected";
}

const pendingApprovals = new Map<string, ApprovalRequest>();
const approvalResolvers = new Map<string, (approved: boolean) => void>();

/**
 * Heuristics to check if an action is potentially destructive/sensitive
 */
export function isActionSensitive(command: string): { isSensitive: boolean; reason: string } {
  const normalized = command.trim().toLowerCase();

  // Database sensitive keywords
  if (/\b(drop\s+table|drop\s+database|truncate|delete\s+from|alter\s+table)\b/i.test(normalized)) {
    return {
      isSensitive: true,
      reason: "Destructive database operation (DROP/DELETE/TRUNCATE/ALTER).",
    };
  }

  // Filesystem and OS destructive patterns
  if (
    normalized.includes("rm -rf") ||
    normalized.includes("rmdir /s") ||
    normalized.includes("del /f") ||
    normalized.includes("mkfs") ||
    normalized.includes("dd if=")
  ) {
    return {
      isSensitive: true,
      reason: "Recursive filesystem deletion or formatting detected.",
    };
  }

  // Git dangerous commands
  if (
    normalized.includes("git push --force") ||
    normalized.includes("git push -f") ||
    normalized.includes("git reset --hard") ||
    normalized.includes("git clean -fdx")
  ) {
    return {
      isSensitive: true,
      reason: "Destructive Git history rewrite or unrecoverable reset.",
    };
  }

  // Cloud infrastructure teardown
  if (
    normalized.includes("gcloud run services delete") ||
    normalized.includes("wrangler delete") ||
    normalized.includes("flushall") ||
    normalized.includes("flushdb")
  ) {
    return {
      isSensitive: true,
      reason: "Cloud service teardown or in-memory cache purge.",
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
  riskReason: string
): Promise<{ approved: boolean; message: string }> {
  const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const request: ApprovalRequest = {
    id,
    action,
    commandOrPayload,
    riskReason,
    timestamp: new Date().toISOString(),
    status: "pending",
  };

  pendingApprovals.set(id, request);
  await notifyTelegram(request);

  console.log(`\n\x1b[31m\x1b[1m========================================================\x1b[0m`);
  console.log(`\x1b[31m\x1b[1m⚠️  [HUMAN-IN-THE-LOOP APPROVAL REQUIRED]\x1b[0m`);
  console.log(`\x1b[33mAction:\x1b[0m ${action}`);
  console.log(`\x1b[33mRisk Reason:\x1b[0m ${riskReason}`);
  console.log(`\x1b[33mCommand / Payload:\x1b[0m\n${commandOrPayload}`);
  console.log(`\x1b[31m\x1b[1m========================================================\x1b[0m`);

  // Interactive CLI prompt
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        `\x1b[32mApprove this sensitive execution? (y/N): \x1b[0m`
      );
      rl.close();

      const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      request.status = approved ? "approved" : "rejected";

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
      return { approved: false, message: "Approval prompt aborted." };
    }
  }

  // Non-interactive / API server mode: Wait for external resolution via /api/approve
  return new Promise((resolve) => {
    approvalResolvers.set(id, (approved: boolean) => {
      request.status = approved ? "approved" : "rejected";
      if (approved) {
        resolve({ approved: true, message: `Action remotely approved (${id}).` });
      } else {
        resolve({ approved: false, message: `Action remotely rejected (${id}).` });
      }
    });

    // Timeout safety: auto-reject after 5 minutes if no response
    setTimeout(() => {
      if (pendingApprovals.get(id)?.status === "pending") {
        request.status = "rejected";
        approvalResolvers.delete(id);
        resolve({ approved: false, message: `Approval timed out after 5 minutes (${id}).` });
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * Handle remote approval from API endpoint /api/approve
 */
export function resolveApproval(id: string, approved: boolean): boolean {
  const resolver = approvalResolvers.get(id);
  if (resolver) {
    resolver(approved);
    approvalResolvers.delete(id);
    return true;
  }
  return false;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return Array.from(pendingApprovals.values()).filter((r) => r.status === "pending");
}
