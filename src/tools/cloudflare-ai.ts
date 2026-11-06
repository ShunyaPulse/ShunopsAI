/**
 * Cloudflare Workers AI & Model Inference Tool
 * Provides direct REST API inference for Cloudflare Workers AI models & Embeddings.
 * Enterprise Dynamic Multi-Account Pool & Clean Diagnostic Reporting.
 */

export interface CloudflareAiOptions {
  model?: string | undefined;
  prompt?: string | undefined;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface CloudflareAiResponse {
  success: boolean;
  result?: any;
  errors?: any[];
  latencyMs?: number;
}

export interface CloudflareAccountInfo {
  id: string;
  token: string;
  envKey: string;
}

export interface CloudflareAccountProbe {
  id: string;
  displayName: string;
  ok: boolean;
  latencyMs: number;
  error?: string | undefined;
}

export interface CloudflareProbeResult {
  ok: boolean;
  healthyCount: number;
  totalCount: number;
  latencyMs: number;
  model: string;
  summary: string;
  error?: string | undefined;
  accounts: CloudflareAccountProbe[];
}

export const CLOUDFLARE_MODELS_CHAIN: string[] = [
  process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.1",
  "@cf/qwen/qwen1.5-7b-chat-awq",
];

const accountNameCache = new Map<string, string>();

/**
 * Discovers all configured Cloudflare accounts dynamically from process.env.
 * Zero hardcoded account names or aliases.
 */
export function getCloudflareAccountPool(): CloudflareAccountInfo[] {
  const pool: CloudflareAccountInfo[] = [];
  const env = process.env;

  // Primary account
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    pool.push({
      id: env.CLOUDFLARE_ACCOUNT_ID.trim(),
      token: env.CLOUDFLARE_API_TOKEN.trim(),
      envKey: "CLOUDFLARE_ACCOUNT_ID",
    });
  }

  // Dynamically discover all additional accounts without hardcoding
  for (const [k, v] of Object.entries(env)) {
    if (k === "CLOUDFLARE_ACCOUNT_ID") continue;
    if (
      k.endsWith("_CLOUDFLARE_ACCOUNT_ID") ||
      k.startsWith("CLOUDFLARE_ACCOUNT_ID_") ||
      k.includes("CLOUDFLARE_ACCOUNT_ID")
    ) {
      if (!v) continue;
      const accountId = v.trim();
      if (pool.some((p) => p.id === accountId)) continue;

      const tokenKey = k.replace("ACCOUNT_ID", "API_TOKEN");
      const token = env[tokenKey]?.trim();
      if (token) {
        pool.push({
          id: accountId,
          token,
          envKey: k,
        });
      }
    }
  }

  return pool;
}

/**
 * Fetches official account name directly from Cloudflare REST API.
 * Falls back to masked account ID if token lacks Account Read scope.
 * Zero hardcoded names.
 */
export async function fetchCloudflareAccountName(accountId: string, apiToken: string): Promise<string> {
  if (accountNameCache.has(accountId)) {
    return accountNameCache.get(accountId)!;
  }

  const maskedId = `${accountId.slice(0, 4)}...${accountId.slice(-4)}`;
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.success && data.result?.name) {
        const fetchedName = `${data.result.name} (${maskedId})`;
        accountNameCache.set(accountId, fetchedName);
        return fetchedName;
      }
    }
  } catch {}

  const fallbackName = `Account (${maskedId})`;
  accountNameCache.set(accountId, fallbackName);
  return fallbackName;
}

/**
 * Enterprise error sanitizer:
 * - Strips internal UUIDs, raw JSON payloads, and error codes
 * - Formats human-readable, executive-ready diagnostic messages
 */
export function sanitizeAiErrorMessage(raw: any): string {
  if (!raw) return "Service temporarily unavailable";

  let msg = "";
  if (Array.isArray(raw)) {
    msg = raw.map((e) => (typeof e === "object" ? e.message || JSON.stringify(e) : String(e))).join("; ");
  } else if (typeof raw === "object") {
    msg = raw.message || JSON.stringify(raw);
  } else {
    msg = String(raw);
  }

  // Professional translation for daily neuron allocation exhausted
  if (msg.includes("10,000 neurons") || msg.includes("daily free allocation") || /code["']?\s*:\s*4006/i.test(msg)) {
    return "Daily free quota reached (10,000 neurons exhausted for today)";
  }

  // Strip duplicate AiError prefixes
  msg = msg.replace(/\bAiError:\s*AiError:\s*/gi, "AiError: ");

  // Strip Cloudflare internal request UUIDs e.g. (40e5eb0f-ca50-43bf-8462-bbca33abf841)
  msg = msg.replace(/\([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)/gi, "");

  // Strip code numbers e.g. ,"code":4006 or {code: 4006}
  msg = msg.replace(/,?\s*["']?code["']?\s*:\s*\d+/gi, "");

  // Clean raw JSON wrappers
  msg = msg.replace(/^[\[{\s"']+|[\]}\s"']+$/g, "").trim();

  return msg || "Service temporarily unavailable";
}

/**
 * Run inference on Cloudflare Workers AI with automatic multi-account fallback cascade
 */
export async function runCloudflareAiInference(
  promptOrOptions: string | CloudflareAiOptions,
  /** Per-user account. When present it is the ONLY account billed/queried. */
  overrides: { accountId?: string; apiToken?: string } = {}
): Promise<string> {
  const accountPool = (overrides.accountId && overrides.apiToken)
    ? [{ id: overrides.accountId, token: overrides.apiToken, envKey: "OVERRIDE" }]
    : getCloudflareAccountPool();

  if (accountPool.length === 0) {
    return "Error: No Cloudflare accounts configured in environment.";
  }

  const requestedModel = typeof promptOrOptions === "object" ? promptOrOptions.model : undefined;
  const modelsToTry = requestedModel
    ? [requestedModel, ...CLOUDFLARE_MODELS_CHAIN.filter((m) => m !== requestedModel)]
    : CLOUDFLARE_MODELS_CHAIN;

  let bodyPayload: any = {};
  if (typeof promptOrOptions === "string") {
    bodyPayload = {
      prompt: promptOrOptions,
      max_tokens: 1024,
    };
  } else {
    if (promptOrOptions.messages && promptOrOptions.messages.length > 0) {
      bodyPayload = {
        messages: promptOrOptions.messages,
        max_tokens: promptOrOptions.maxTokens || 1024,
        temperature: promptOrOptions.temperature ?? 0.7,
      };
    } else {
      bodyPayload = {
        prompt: promptOrOptions.prompt || "",
        max_tokens: promptOrOptions.maxTokens || 1024,
        temperature: promptOrOptions.temperature ?? 0.7,
      };
    }
  }

  if (process.env.CLOUDFLARE_LORA_NAME && !bodyPayload.lora) {
    bodyPayload.lora = process.env.CLOUDFLARE_LORA_NAME;
  }

  let lastCleanError = "";

  // Cascade across all configured accounts in pool
  for (const acc of accountPool) {
    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const model = modelsToTry[mIdx]!;
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc.id)}/ai/run/${model}`;
      const start = Date.now();

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${acc.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(30000),
        });

        const latencyMs = Date.now() - start;
        const data = (await res.json()) as any;

        if (!res.ok || !data.success) {
          lastCleanError = sanitizeAiErrorMessage(data.errors || data);
          console.warn('[Cloudflare AI Fallback] Account (...[REDACTED]) Model [REDACTED] returned: [REDACTED]. Trying next...');
          continue;
        }

        const outputText =
          data.result?.response ||
          data.result?.generated_text ||
          JSON.stringify(data.result, null, 2);

        return `Cloudflare AI Response [Model: ${model}, Latency: ${latencyMs}ms]:\n${outputText}`;
      } catch (err: any) {
        lastCleanError = sanitizeAiErrorMessage('[REDACTED]');
        console.warn('[Cloudflare AI Fallback] Network issue encountered. Trying next...');
      }
    }
  }

  return `Cloudflare AI All Pool Accounts Failed: ${lastCleanError}`;
}

/**
 * Enterprise Health check probe for Cloudflare Workers AI:
 * - Dynamically probes all accounts in the pool
 * - Resolves official account names
 * - Sanitizes errors (removes internal UUIDs and code numbers)
 * - Accurately reports pool resilience (reserve accounts available)
 */
export async function pingCloudflareAi(): Promise<CloudflareProbeResult> {
  const pool = getCloudflareAccountPool();

  if (pool.length === 0) {
    return {
      ok: false,
      healthyCount: 0,
      totalCount: 0,
      latencyMs: 0,
      model: "none",
      summary: "No Cloudflare accounts configured in environment.",
      error: "Missing Cloudflare account configuration in .env",
      accounts: [],
    };
  }

  const model = "@cf/meta/llama-3.2-1b-instruct";
  const accountResults: CloudflareAccountProbe[] = [];

  for (const acc of pool) {
    const displayName = await fetchCloudflareAccountName(acc.id, acc.token);
    const start = Date.now();

    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc.id)}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${acc.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "PING. Reply with 'PONG'.",
            max_tokens: 5,
          }),
          signal: AbortSignal.timeout(8000),
        }
      );

      const latencyMs = Date.now() - start;
      const data = (await res.json()) as any;

      if (res.ok && data.success) {
        accountResults.push({
          id: acc.id,
          displayName,
          ok: true,
          latencyMs,
        });
      } else {
        const cleanErr = sanitizeAiErrorMessage(data.errors || data);
        accountResults.push({
          id: acc.id,
          displayName,
          ok: false,
          latencyMs,
          error: cleanErr,
        });
      }
    } catch (err: any) {
      accountResults.push({
        id: acc.id,
        displayName,
        ok: false,
        latencyMs: Date.now() - start,
        error: sanitizeAiErrorMessage(err.message),
      });
    }
  }

  const healthyAccounts = accountResults.filter((a) => a.ok);
  const failedAccounts = accountResults.filter((a) => !a.ok);
  const avgLatency = healthyAccounts.length > 0
    ? Math.round(healthyAccounts.reduce((sum, a) => sum + a.latencyMs, 0) / healthyAccounts.length)
    : 0;

  let summary = "";
  if (healthyAccounts.length === accountResults.length) {
    summary = `All ${pool.length} Cloudflare accounts active and healthy (avg latency: ${avgLatency}ms).`;
  } else if (healthyAccounts.length > 0) {
    const failedDescriptions = failedAccounts.map((a) => `${a.displayName}: ${a.error}`).join("; ");
    summary = `${healthyAccounts.length} of ${pool.length} accounts healthy. Affected: ${failedDescriptions}. System operating on ${healthyAccounts.length} active reserve accounts.`;
  } else {
    const errorDetails = failedAccounts.map((a) => `${a.displayName}: ${a.error}`).join("; ");
    summary = `All ${pool.length} Cloudflare accounts in pool exhausted or unavailable (${errorDetails}).`;
  }

  return {
    ok: healthyAccounts.length > 0,
    healthyCount: healthyAccounts.length,
    totalCount: pool.length,
    latencyMs: avgLatency,
    model,
    summary,
    error: healthyAccounts.length === 0 ? summary : (failedAccounts.length > 0 ? summary : undefined),
    accounts: accountResults,
  };
}
