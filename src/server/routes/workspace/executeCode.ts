import type { FastifyInstance } from "fastify";
import { findUserBySessionToken } from "../../db.js";
import {
  getTenantAgenticSnapshot,
  hydrateTenantAgenticState,
  persistTenantAgenticState,
  resolveTenantKey,
} from "../../../tools/agentic.js";
import { buildRequestScope } from "../../scope.js";
import { getClientIp, checkDistributedSubnetQuota } from "../../middleware/ratelimit.js";
import { verifyCloudflareTurnstile, verifyShieldSolution } from "../../middleware/bot-shield.js";
import type { WorkspaceRouteDeps } from "./shared.js";

const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_TIMEOUT_MS = 5000;
const GUEST_TRIAL_LIMIT = 3;
const GUEST_TRIAL_WINDOW_SECONDS = 86400;

function clampTimeout(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  if (floored > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  if (floored < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  return floored;
}

function sandboxEngineerInstructions(): string {
  return [
    "You are the ShunopsAI Sandbox JavaScript Engineer.",
    "Write clean, self-contained, immediately runnable JavaScript for the isolated V8 sandbox to fulfill the user's task.",
    "Available built-in sandbox globals (no imports or require needed):",
    "- `writeWorkspaceFile(filename, content)`: Save a file (e.g. .json, .md, .csv, .txt) to the user's workspace",
    "- `appendWorkspaceFile(filename, content)`: Append to a workspace file",
    "- `readWorkspaceFile(filename)`: Read an existing workspace file",
    "- `listWorkspaceFiles()`: List workspace filenames",
    "- `sum(arr)`, `mean(arr)`, `median(arr)`, `stdDev(arr)`, `groupBy(arr, key)`, `csvParse(text)`, `formatMarkdownTable(rows)`",
    "Enclose your code in a single ```javascript code block and end with `return ...;` so the result is returned.",
  ].join("\n");
}

/** Resolve the caller: session cookie first, then any auth attached by middleware. */
async function resolveCaller(req: any): Promise<any> {
  const user = req.user || null;
  if (user) return user;
  const sessionToken = (req.cookies as any)?.shunops_user_session;
  if (!sessionToken) return null;
  try {
    return await findUserBySessionToken(sessionToken);
  } catch {
    return null;
  }
}

/**
 * Guest anti-bot + quota gate. Returns an error response when the guest is not
 * allowed to run, or null when the request may proceed.
 */
async function enforceGuestGate(
  req: any,
  reply: any,
  clientIp: string,
  body: any
): Promise<{ success: false; error: string; trialExhausted?: boolean } | null> {
  const turnstileToken = body.turnstileToken;
  const shield = body.shield;

  if (!turnstileToken && !shield) {
    reply.status(403);
    return {
      success: false,
      error: "Bot shield validation required for guest trial. Please solve the challenge or sign up.",
    };
  }

  if (turnstileToken) {
    const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
    if (!isHuman) {
      reply.status(403);
      return {
        success: false,
        error: "Cloudflare Turnstile verification failed. Please refresh and try again.",
      };
    }
  } else if (shield) {
    const isValid = verifyShieldSolution(
      shield.salt,
      Number(shield.timestamp),
      Number(shield.targetDifficulty),
      shield.signature,
      String(shield.solution)
    );
    if (!isValid) {
      reply.status(403);
      return { success: false, error: "Browser security challenge failed. Please refresh." };
    }
  }

  // Strict 3 Trial Runs per 24 hours per IP address via OCI Redis Token Bucket
  const quota = await checkDistributedSubnetQuota(
    `guest:trial:${clientIp}`,
    GUEST_TRIAL_LIMIT,
    GUEST_TRIAL_WINDOW_SECONDS
  );
  if (!quota.allowed) {
    reply.status(429);
    return {
      success: false,
      trialExhausted: true,
      error: "Free guest trial limit reached (3 runs per 24 hours). Create a free account to unlock unlimited workspace runs!",
    };
  }

  return null;
}

/** Ask a model to turn a natural-language task into runnable sandbox JavaScript. */
async function generateSandboxCode(
  taskPrompt: string,
  existingFileNames: string[],
  req: any,
  user: any,
  isGuest: boolean
): Promise<{ code: string; generated: boolean; error?: string }> {
  const userGroqKey = (req.headers["x-groq-key"] as string | undefined)?.trim();
  const userGeminiKey = (req.headers["x-gemini-key"] as string | undefined)?.trim();
  const scope = user ? await buildRequestScope(user) : { credentials: {} };
  const creds = (scope.credentials || {}) as any;
  const keyOverrides = {
    ...(userGroqKey ? { groqApiKey: userGroqKey } : {}),
    ...(userGeminiKey ? { geminiApiKey: userGeminiKey } : {}),
    ...(creds.github?.token ? { githubToken: creds.github.token } : {}),
    ...(creds.cloudflare?.accountId ? { cloudflareAccountId: creds.cloudflare.accountId } : {}),
    ...(creds.cloudflare?.apiToken ? { cloudflareApiToken: creds.cloudflare.apiToken } : {}),
  };

  const userMsg = [
    existingFileNames.length > 0 ? `Existing workspace files: ${existingFileNames.join(", ")}` : "",
    `Task to solve in JavaScript sandbox: ${taskPrompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { AGENT_MODELS_CHAIN, callChatCompletionWithFailover } = await import("../../../agent/models.js");
  const { extractRunnableJsFromText } = await import("../../../agent/swarm.js");

  const { response } = await callChatCompletionWithFailover(
    [
      { role: "system", content: sandboxEngineerInstructions() },
      { role: "user", content: userMsg },
    ],
    isGuest
      ? [
          { provider: "gemini" as const, model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Guest Active)" },
          { provider: "groq" as const, model: "qwen/qwen3.8-27b", name: "Groq Qwen 27B (Guest Active)" },
        ]
      : AGENT_MODELS_CHAIN,
    [],
    0.2,
    keyOverrides
  );

  const rawReply = response.choices?.[0]?.message?.content?.trim() || "";
  const extracted = extractRunnableJsFromText(rawReply);
  if (extracted) return { code: extracted, generated: true };
  if (rawReply && !rawReply.includes("```")) return { code: rawReply, generated: true };
  return { code: "", generated: true };
}

/** Interactive code sandbox runner and AI task-to-code generator. */
export function registerExecuteCodeRoute(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  app.post<{ Body: { code?: string; taskPrompt?: string; timeoutMs?: number; turnstileToken?: string; shield?: any } }>(
    "/api/workspace/execute-code",
    async (req, reply) => {
      const user = await resolveCaller(req);
      const clientIp = getClientIp(req);
      const isGuest = !user;

      if (isGuest) {
        const rejection = await enforceGuestGate(req, reply, clientIp, req.body || {});
        if (rejection) return rejection;
      }

      const tenantKey = user
        ? resolveTenantKey(user.id, user.role === "admin" ? "admin" : "user")
        : `tenant:guest:${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}`;

      if (user) {
        await hydrateTenantAgenticState(tenantKey);
      }

      const { executeInSandbox } = await import("../../../agent/sandbox/runner.js");
      const { getTenantFilesMap, persistSandboxWrittenFiles } = await import("../../../tools/agentic.js");

      let code = String(req.body?.code || "").trim();
      const taskPrompt = String(req.body?.taskPrompt || "").trim();
      let generatedByAi = false;

      const workspaceFiles = getTenantFilesMap(tenantKey);
      const existingFileNames = Object.keys(workspaceFiles);

      if (taskPrompt) {
        generatedByAi = true;
        try {
          const generated = await generateSandboxCode(taskPrompt, existingFileNames, req, user, isGuest);
          if (generated.code) code = generated.code;
        } catch (err: any) {
          if (!code) {
            reply.status(500);
            return {
              success: false,
              error: `AI code generation failed: ${err?.message || "model unavailable"}. You can also type JavaScript directly in the editor.`,
            };
          }
        }
      }

      if (!code.trim()) {
        reply.status(400);
        return { success: false, error: "Provide a task description or JavaScript code to execute." };
      }

      const safeTimeoutMs =
        req.body?.timeoutMs !== undefined
          ? clampTimeout(req.body.timeoutMs, DEFAULT_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      const res = await executeInSandbox(code, {
        timeoutMs: safeTimeoutMs,
        workspaceFiles,
      });
      const savedFiles =
        res.success && !isGuest ? await persistSandboxWrittenFiles(res.writtenFiles, tenantKey) : [];
      if (savedFiles.length > 0 && !isGuest) {
        await persistTenantAgenticState(tenantKey);
      }

      return {
        success: res.success,
        generatedByAi,
        generatedCode: code,
        result: res.result,
        error: res.error,
        logs: res.logs,
        savedFiles,
        executionTimeMs: res.executionTimeMs,
        engine: res.engine,
        isGuest,
        ...(isGuest ? {} : getTenantAgenticSnapshot(tenantKey)),
      };
    }
  );
}
