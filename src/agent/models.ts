import OpenAI from "openai";
import { colors } from "../core/colors.js";

// ==========================================
// Multi-Provider Model Configuration & Fallback Chain
// Ordered according to GEMINI.md Rule 3:
// Active Gemini Key Pool -> Groq LPUs (120B / 27B) -> OpenRouter High-Capacity
// ==========================================

export interface ModelTarget {
  provider: "groq" | "gemini" | "openrouter";
  model: string;
  name: string;
}

export const AGENT_MODELS_CHAIN: ModelTarget[] = [
  // 1. Google AI Studio Primary (Active Non-Lite Gemini Models with Verified 1/5 Quota)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.5-flash", name: "Gemini 3.5 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview (Active 1/5)" },

  // 2. Groq Fallback (Ultra-Fast Zero-Lag LPU Execution)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning Fallback)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (Fast Tool Calling)" },

  // 3. OpenRouter High-Capability Heavyweights
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

// ==========================================
// Multi-Service API Key Pool Anti-Contention Invariant (GEMINI.md Rule 6)
// ==========================================
let cachedKeys: string[] = [];
let lastRawKeyString = "";
let roundRobinIndex = 0;

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
      roundRobinIndex = Math.floor(Math.random() * cachedKeys.length);
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
}

/**
 * Create an OpenAI-compatible client for a provider target, with optional request-scoped BYOK overrides.
 */
export function createClientForTarget(target: ModelTarget, overrides?: ProviderKeyOverrides): OpenAI {
  if (target.provider === "groq") {
    const apiKey = overrides?.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("No Groq API key available");
    return new OpenAI({
      baseURL: GROQ_BASE_URL,
      apiKey,
    });
  }
  if (target.provider === "gemini") {
    const apiKey = overrides?.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("No Gemini API key available");
    return new OpenAI({
      baseURL: GEMINI_OPENAI_BASE_URL,
      apiKey,
    });
  }
  const apiKey = overrides?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OpenRouter API key available");
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/nemotron-agent",
      "X-Title": "Nemotron-Autonomous-Agent",
    },
  });
}

/**
 * Call the completion API with multi-provider automatic failover across models
 * and providers (Active Gemini -> Groq -> OpenRouter).
 */
export async function callChatCompletionWithFailover(
  messages: OpenAI.ChatCompletionMessageParam[],
  targets: ModelTarget[],
  tools: OpenAI.ChatCompletionTool[],
  temperature = 0.2,
  overrides?: ProviderKeyOverrides
): Promise<{ response: OpenAI.ChatCompletion; usedModel: string }> {
  const geminiPool = getApiKeysPool();
  const hasServerGemini = geminiPool.length > 0;
  const hasServerGroq = Boolean(process.env.GROQ_API_KEY);
  const hasServerOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  const isBYOK = Boolean(overrides?.groqApiKey || overrides?.geminiApiKey || overrides?.openrouterApiKey);

  const eligibleTargets = targets.filter((target) => {
    if (isBYOK) {
      // Rule 9: BYOK Isolation. When BYOK keys are provided, ONLY execute providers
      // for which the user supplied a valid key. NEVER fall back to server pool keys.
      if (target.provider === "gemini") return Boolean(overrides?.geminiApiKey);
      if (target.provider === "groq") return Boolean(overrides?.groqApiKey);
      if (target.provider === "openrouter") return Boolean(overrides?.openrouterApiKey);
      return false;
    }
    // Shared Server Mode: only attempt providers that have configured server keys
    if (target.provider === "gemini") return hasServerGemini;
    if (target.provider === "groq") return hasServerGroq;
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

  for (const target of eligibleTargets) {
    // If Gemini target using server pool, bounded retries on 429 across pool keys before model fallback (Rule 6)
    const attempts = target.provider === "gemini" && !overrides?.geminiApiKey ? Math.min(2, geminiPool.length) : 1;

    for (let att = 0; att < attempts; att++) {
      try {
        const client = createClientForTarget(target, overrides);
        console.log(
          `${colors.gray}[Requesting Model]${colors.reset} [${target.provider.toUpperCase()}] ${target.model}`
        );

        // Providers reject an empty `tools` array (`tools: Array must have at
        // least 1 item`), so tool-less runs (e.g. the public /api/chat bot)
        // must omit the parameters entirely instead of sending an empty list.
        const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: target.model,
          messages,
          temperature,
        };
        if (tools.length > 0) {
          params.tools = tools;
          params.tool_choice = "auto";
        }

        const response = await client.chat.completions.create(params);

        if (response.choices && response.choices.length > 0 && response.choices[0]) {
          return { response, usedModel: `${target.provider.toUpperCase()}:${target.model}` };
        }
        throw new Error(`Model ${target.model} returned empty choices array.`);
      } catch (err: any) {
        lastError = err;
        const statusCode = err?.status || err?.statusCode || "Unknown";
        console.warn(
          `${colors.yellow}[Failover Notice]${colors.reset} [${target.provider}] ${target.model} attempt ${att + 1}/${attempts} failed (${statusCode}: ${err.message}). Trying fallback...`
        );
        if (statusCode === 429 && target.provider === "gemini") {
          advanceGeminiKeyOnRateLimit();
        }
        if (err?.status === 404) break; // Model does not exist, move to next model
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  throw new Error(
    `All configured multi-provider models failed in failover chain. Last error: ${lastError?.message || lastError}`
  );
}

