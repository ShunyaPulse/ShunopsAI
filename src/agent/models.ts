import OpenAI from "openai";
import { randomInt } from "node:crypto";
import { colors } from "../core/colors.js";
import { recordCircuitBreakerSuccess, recordCircuitBreakerFailure, isModelDegraded } from "./circuitBreaker.js";
import { withSpan } from "../telemetry/otel.js";

// Interactive chat timeout per individual model call (12s max before fast failover)
const INFERENCE_TIMEOUT_MS = 12000;

// ==========================================
// Multi-Provider Model Configuration & Fallback Chain
// Ordered according to GEMINI.md Rule 3:
// Active Gemini Key Pool -> Groq LPUs (120B / 27B) -> OpenRouter High-Capacity
// ==========================================

export interface ModelTarget {
  provider: "groq" | "gemini" | "openrouter" | "github" | "cloudflare";
  model: string;
  name: string;
}

export const AGENT_MODELS_CHAIN: ModelTarget[] = [
  // 1. Google AI Studio Primary (Active Gemini 3.8 Flash; 3.5/3.6/3.7 deprecated & routed to 3.8)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview (Active 1/5)" },

  // 2. Groq Fallback (Ultra-Fast Zero-Lag LPU Execution)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning Fallback)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (Fast Tool Calling)" },

  // 3. GitHub Models (Direct Azure OpenAI Gateway via GITHUB_PAT)
  { provider: "github", model: "gpt-4o", name: "OpenAI GPT-4o (GitHub Models)" },
  { provider: "github", model: "gpt-4o-mini", name: "OpenAI GPT-4o Mini (GitHub Models)" },
  { provider: "github", model: "o1-mini", name: "OpenAI o1-mini (GitHub Reasoning)" },
  { provider: "github", model: "meta-llama-3.3-70b-instruct", name: "Llama 3.3 70B (GitHub Models)" },

  // 4. Cloudflare Workers AI (Serverless Edge Inference)
  { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Fast (Cloudflare Workers AI)" },
  { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B (Cloudflare Workers AI)" },
  { provider: "cloudflare", model: "@cf/qwen/qwen1.5-7b-chat-awq", name: "Qwen 1.5 7B Chat (Cloudflare Workers AI)" },

  // 5. OpenRouter High-Capability Heavyweights
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (OpenRouter)" },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (1M Context)" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" },
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "qwen/qwen3.8-27b:free", name: "Qwen 3.8 27B (OpenRouter)" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },
];

export const PRIMARY_MODEL = AGENT_MODELS_CHAIN[0]?.model ?? "gemini-3.8-flash";
export const FALLBACK_MODELS = AGENT_MODELS_CHAIN.slice(1).map((t) => t.model);

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";

// ==========================================
// Multi-Service API Key Pool Anti-Contention Invariant (GEMINI.md Rule 6)
// ==========================================
let cachedKeys: string[] = [];
let lastRawKeyString = "";
let roundRobinIndex = 0;

let cachedGroqKeys: string[] = [];
let lastRawGroqString = "";
let groqRoundRobinIndex = 0;

let cachedOpenRouterKeys: string[] = [];
let lastRawOpenRouterString = "";
let openRouterRoundRobinIndex = 0;

export function getOpenRouterKeysPool(): string[] {
  const raw =
    process.env.OPENROUTER_KEYS ||
    process.env.OPENROUTER_API_KEYS ||
    process.env.OPENROUTER_API_KEY ||
    "";
  if (raw !== lastRawOpenRouterString) {
    lastRawOpenRouterString = raw;
    cachedOpenRouterKeys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (cachedOpenRouterKeys.length > 1) {
      openRouterRoundRobinIndex = randomInt(0, cachedOpenRouterKeys.length);
    } else {
      openRouterRoundRobinIndex = 0;
    }
  }
  return cachedOpenRouterKeys;
}

export function getNextOpenRouterKey(): string | null {
  const keys = getOpenRouterKeysPool();
  if (keys.length === 0) return null;
  const key = keys[openRouterRoundRobinIndex];
  openRouterRoundRobinIndex = (openRouterRoundRobinIndex + 1) % keys.length;
  return key ?? null;
}

export function advanceOpenRouterKeyOnRateLimit(): void {
  const keys = getOpenRouterKeysPool();
  if (keys.length > 0) {
    openRouterRoundRobinIndex = (openRouterRoundRobinIndex + 1) % keys.length;
  }
}

export function getGroqKeysPool(): string[] {
  const raw =
    process.env.GROQ_KEYS ||
    process.env.GROQ_API_KEYS ||
    process.env.GROQ_API_KEY ||
    "";
  if (raw !== lastRawGroqString) {
    lastRawGroqString = raw;
    cachedGroqKeys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (cachedGroqKeys.length > 1) {
      groqRoundRobinIndex = randomInt(0, cachedGroqKeys.length);
    } else {
      groqRoundRobinIndex = 0;
    }
  }
  return cachedGroqKeys;
}

export function getNextGroqKey(): string | null {
  const keys = getGroqKeysPool();
  if (keys.length === 0) return null;
  const key = keys[groqRoundRobinIndex];
  groqRoundRobinIndex = (groqRoundRobinIndex + 1) % keys.length;
  return key ?? null;
}

export function advanceGroqKeyOnRateLimit(): void {
  const keys = getGroqKeysPool();
  if (keys.length > 0) {
    groqRoundRobinIndex = (groqRoundRobinIndex + 1) % keys.length;
  }
}

export function getApiKeysPool(): string[] {
  const raw =
    process.env.GEMINI_KEYS ||
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";
  if (raw !== lastRawKeyString) {
    lastRawKeyString = raw;
    cachedKeys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    // Initialize starting index once on startup so different services/instances start at different indices
    if (cachedKeys.length > 1) {
      roundRobinIndex = randomInt(0, cachedKeys.length);
    } else {
      roundRobinIndex = 0;
    }
  }
  return cachedKeys;
}

export function getNextGeminiKey(): string | null {
  const keys = getApiKeysPool();
  if (keys.length === 0) return null;
  const key = keys[roundRobinIndex];
  roundRobinIndex = (roundRobinIndex + 1) % keys.length;
  return key ?? null;
}

export function advanceGeminiKeyOnRateLimit(): void {
  const keys = getApiKeysPool();
  if (keys.length > 0) {
    roundRobinIndex = (roundRobinIndex + 1) % keys.length;
  }
}

export interface ProviderKeyOverrides {
  groqApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
  openrouterApiKey?: string | undefined;
  githubToken?: string | undefined;
  cloudflareAccountId?: string | undefined;
  cloudflareApiToken?: string | undefined;
}

/**
 * Flatten multimodal content arrays (`[{ type: 'text' }, { type: 'image_url' }]`) into
 * plain text for text-only fallback models (such as Cloudflare Workers AI 7B/8B or o1-mini).
 */
function flattenMultimodalMessages(
  messages: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const textParts = msg.content
        .map((part: any) => {
          if (part?.type === "text") return String(part.text || "");
          if (part?.type === "image_url") return "[User attached an image]";
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return { role: "user", content: textParts };
    }
    return msg;
  });
}

function hasMultimodalContent(messages: OpenAI.ChatCompletionMessageParam[]): boolean {
  return messages.some((m) => m.role === "user" && Array.isArray(m.content));
}

function isTextOnlyModel(target: ModelTarget): boolean {
  return (
    target.provider === "cloudflare" ||
    target.model === "o1-mini" ||
    target.model.includes("north-mini-code")
  );
}

/**
 * Create an OpenAI-compatible client for a provider target, with optional request-scoped BYOK overrides.
 */
export function createClientForTarget(target: ModelTarget, overrides?: ProviderKeyOverrides): OpenAI {
  if (target.provider === "groq") {
    const apiKey = overrides?.groqApiKey || getNextGroqKey() || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("No Groq API key available");
    return new OpenAI({
      baseURL: GROQ_BASE_URL,
      apiKey,
      timeout: INFERENCE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (target.provider === "gemini") {
    const apiKey = overrides?.geminiApiKey || getNextGeminiKey() || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("No Gemini API key available");
    return new OpenAI({
      baseURL: GEMINI_OPENAI_BASE_URL,
      apiKey,
      timeout: INFERENCE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (target.provider === "github") {
    const apiKey = overrides?.githubToken || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
    if (!apiKey) throw new Error("No GITHUB_PAT available");
    return new OpenAI({
      baseURL: GITHUB_MODELS_BASE_URL,
      apiKey,
      timeout: INFERENCE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (target.provider === "cloudflare") {
    const accountId = overrides?.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = overrides?.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiKey) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    return new OpenAI({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      apiKey,
      timeout: INFERENCE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  const apiKey = overrides?.openrouterApiKey || getNextOpenRouterKey() || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OpenRouter API key available");
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    timeout: INFERENCE_TIMEOUT_MS,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/nemotron-agent",
      "X-Title": "Nemotron-Autonomous-Agent",
    },
  });
}

/**
 * Call the completion API with multi-provider automatic failover across models
 * and providers (Active Gemini -> Groq -> GitHub Models -> Cloudflare Workers AI -> OpenRouter).
 */
export async function callChatCompletionWithFailover(
  messages: OpenAI.ChatCompletionMessageParam[],
  targets: ModelTarget[],
  tools: OpenAI.ChatCompletionTool[],
  temperature = 0.2,
  overrides?: ProviderKeyOverrides
): Promise<{ response: OpenAI.ChatCompletion; usedModel: string }> {
  const geminiPool = getApiKeysPool();
  const groqPool = getGroqKeysPool();
  const openRouterPool = getOpenRouterKeysPool();
  const hasServerGemini = geminiPool.length > 0;
  const hasServerGroq = groqPool.length > 0 || Boolean(process.env.GROQ_API_KEY);
  const hasGitHub = Boolean(overrides?.githubToken || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN);
  const hasCloudflare = Boolean(
    (overrides?.cloudflareAccountId && overrides?.cloudflareApiToken) ||
      (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)
  );
  const hasServerOpenRouter = openRouterPool.length > 0 || Boolean(process.env.OPENROUTER_API_KEY);

  const isBYOK = Boolean(overrides?.groqApiKey || overrides?.geminiApiKey || overrides?.openrouterApiKey);

  const eligibleTargets = targets.filter((target) => {
    if (isBYOK) {
      // Rule 9: BYOK Isolation. When BYOK keys are provided, ONLY execute providers
      // for which the user supplied a valid key. NEVER fall back to server pool keys.
      if (target.provider === "gemini") return Boolean(overrides?.geminiApiKey);
      if (target.provider === "groq") return Boolean(overrides?.groqApiKey);
      if (target.provider === "openrouter") return Boolean(overrides?.openrouterApiKey);
      if (target.provider === "github") return Boolean(overrides?.githubToken);
      if (target.provider === "cloudflare") {
        return Boolean(overrides?.cloudflareAccountId && overrides?.cloudflareApiToken);
      }
      return false;
    }
    // Shared Server Mode: attempt providers that have configured server keys or connected user platform keys
    if (target.provider === "gemini") return hasServerGemini;
    if (target.provider === "groq") return hasServerGroq;
    if (target.provider === "github") return hasGitHub;
    if (target.provider === "cloudflare") return hasCloudflare;
    if (target.provider === "openrouter") return hasServerOpenRouter;
    return false;
  });

  if (eligibleTargets.length === 0) {
    if (isBYOK) {
      throw new Error("No compatible models found for the provided BYOK API key(s).");
    }
    throw new Error(
      "No AI provider keys configured on server. Please configure GEMINI_KEYS or GROQ_API_KEY in server environment, or provide your own key in the BYOK Settings."
    );
  }

  let lastError: any = null;
  const isMultimodal = hasMultimodalContent(messages);

  for (let tIdx = 0; tIdx < eligibleTargets.length; tIdx++) {
    const target = eligibleTargets[tIdx]!;
    // Proactively skip models that recently tripped circuit-breaker cooldown
    if (await isModelDegraded(target.provider, target.model)) {
      continue;
    }

    // If Gemini/Groq/OpenRouter target using server pool, bounded retries across pool keys before model fallback (Rule 6)
    let attempts = 1;
    if (!overrides?.geminiApiKey && target.provider === "gemini") {
      attempts = Math.min(2, geminiPool.length);
    } else if (!overrides?.groqApiKey && target.provider === "groq") {
      attempts = Math.min(2, groqPool.length);
    } else if (!overrides?.openrouterApiKey && target.provider === "openrouter") {
      attempts = Math.min(2, openRouterPool.length);
    }

    for (let att = 0; att < attempts; att++) {
      try {
        const result = await withSpan(
          `llm.completion ${target.provider}:${target.model}`,
          {
            kind: "CLIENT",
            attributes: {
              "llm.provider": target.provider,
              "llm.model": target.model,
              "llm.attempt": att + 1,
              "llm.failover": tIdx > 0 || att > 0,
            },
          },
          async (llmSpan) => {
            const client = createClientForTarget(target, overrides);
            console.log(
              `${colors.gray}[Requesting Model]${colors.reset} [${target.provider.toUpperCase()}] ${target.model}`
            );

            const effectiveMessages =
              isMultimodal && isTextOnlyModel(target) ? flattenMultimodalMessages(messages) : messages;

            // Providers reject an empty `tools` array (`tools: Array must have at
            // least 1 item`), so tool-less runs (e.g. the public /api/chat bot)
            // must omit the parameters entirely instead of sending an empty list.
            const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
              model: target.model,
              messages: effectiveMessages,
              temperature,
            };
            if (tools.length > 0) {
              params.tools = tools;
              params.tool_choice = "auto";
            }

            let response: OpenAI.ChatCompletion;
            try {
              response = await client.chat.completions.create(params);
            } catch (innerErr: any) {
              // If a model rejected multimodal array content with 400/422, retry once with flattened text
              if (
                isMultimodal &&
                effectiveMessages === messages &&
                (innerErr?.status === 400 || innerErr?.status === 422)
              ) {
                response = await client.chat.completions.create({
                  ...params,
                  messages: flattenMultimodalMessages(messages),
                });
              } else {
                throw innerErr;
              }
            }

            if (response.choices && response.choices.length > 0 && response.choices[0]) {
              if (response.usage) {
                llmSpan.setAttribute("llm.prompt_tokens", response.usage.prompt_tokens || 0);
                llmSpan.setAttribute("llm.completion_tokens", response.usage.completion_tokens || 0);
              }
              recordCircuitBreakerSuccess(target.provider, target.model).catch(() => {});
              return { response, usedModel: `${target.provider.toUpperCase()}:${target.model}` };
            }
            throw new Error(`Model ${target.model} returned empty choices array.`);
          }
        );
        return result;
      } catch (err: any) {
        lastError = err;
        const isTimeout =
          err?.name === "APIConnectionTimeoutError" ||
          String(err?.message || "").toLowerCase().includes("timeout") ||
          String(err?.message || "").toLowerCase().includes("timed out");
        const statusCode = err?.status || err?.statusCode || (isTimeout ? 504 : "Unknown");
        recordCircuitBreakerFailure(target.provider, target.model, statusCode, err?.message).catch(() => {});
        console.warn(
          `${colors.yellow}[Failover Notice]${colors.reset} [${target.provider}] ${target.model} attempt ${att + 1}/${attempts} failed (${statusCode}: ${err.message}). Trying fallback...`
        );
        if (statusCode === 429) {
          if (target.provider === "gemini") {
            advanceGeminiKeyOnRateLimit();
          } else if (target.provider === "groq") {
            advanceGroqKeyOnRateLimit();
          } else if (target.provider === "openrouter") {
            advanceOpenRouterKeyOnRateLimit();
          }
        }
        // 503 is service-level unavailability/high demand at provider. 504/isTimeout means connection stalled.
        // Fast-fail immediately to next model in cascade without burning another 12s on the same dead model.
        if (
          statusCode === 503 ||
          String(statusCode).includes("503") ||
          statusCode === 404 ||
          statusCode === 504 ||
          isTimeout
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  throw new Error(
    `All configured multi-provider models failed in failover chain. Last error: ${String(lastError?.message || lastError || "Provider unavailable").replace(/([?&]key=|Bearer\s+|gsk_|AIzaSy)[A-Za-z0-9_\-]+/gi, "$1[REDACTED]").slice(0, 180)}`
  );
}
