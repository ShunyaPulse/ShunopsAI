import OpenAI from "openai";
import { randomInt } from "node:crypto";
import { colors } from "../core/colors.js";

// ==========================================
// Multi-Provider Model Configuration & Fallback Chain
// ==========================================

export interface ModelTarget {
  provider: "groq" | "gemini" | "openrouter";
  model: string;
  name: string;
}

export const AGENT_MODELS_CHAIN: ModelTarget[] = [
  // 1. Primary Choice (#1 Highest Quality)
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (Primary #1)" },

  // 2. OpenRouter High-Capability Fallback Chain
  { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (1M Context)" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" },
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "qwen/qwen3.8-27b:free", name: "Qwen 3.8 27B (OpenRouter)" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },

  // 3. Groq Fallback (Ultra-Fast Zero-Lag LPU Execution)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning Fallback)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (Fast Tool Calling)" },

  // 4. Google AI Studio Fallback (Gemini Key Pool with Active 1/5 Quota)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (AI Studio 34-Key Pool)" },
  { provider: "gemini", model: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.5-flash", name: "Gemini 3.5 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview (Active 1/5)" },
];

export const PRIMARY_MODEL = AGENT_MODELS_CHAIN[0]?.model ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
export const FALLBACK_MODELS = AGENT_MODELS_CHAIN.slice(1).map((t) => t.model);

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Pick a random key from the comma-separated `GEMINI_API_KEY` pool so load is
 * distributed across the 34 provisioned AI Studio keys.
 */
function getGeminiKey(): string {
  const raw =
    process.env.GEMINI_KEYS ||
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return "dummy-gemini-key";
  return keys[randomInt(0, keys.length)] || "dummy-gemini-key";
}

/**
 * Create an OpenAI-compatible client for a provider target.
 */
export function createClientForTarget(target: ModelTarget): OpenAI {
  if (target.provider === "groq") {
    return new OpenAI({
      baseURL: GROQ_BASE_URL,
      apiKey: process.env.GROQ_API_KEY || "dummy-groq-key",
    });
  }
  if (target.provider === "gemini") {
    return new OpenAI({
      baseURL: GEMINI_OPENAI_BASE_URL,
      apiKey: getGeminiKey(),
    });
  }
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY || "dummy-openrouter-key",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/nemotron-agent",
      "X-Title": "Nemotron-Autonomous-Agent",
    },
  });
}

/**
 * Call the completion API with multi-provider automatic failover across models
 * and providers (Groq -> Gemini -> OpenRouter).
 */
export async function callChatCompletionWithFailover(
  messages: OpenAI.ChatCompletionMessageParam[],
  targets: ModelTarget[],
  tools: OpenAI.ChatCompletionTool[],
  temperature = 0.2
): Promise<{ response: OpenAI.ChatCompletion; usedModel: string }> {
  let lastError: any = null;

  for (const target of targets) {
    // If Gemini target, attempt with up to 4 different keys from pool before giving up on that model
    const attempts = target.provider === "gemini" ? 4 : 1;

    for (let att = 0; att < attempts; att++) {
      try {
        const client = createClientForTarget(target);
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
        if (err?.status === 404) break; // Model does not exist, move to next model
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  throw new Error(
    `All configured multi-provider models failed in failover chain. Last error: ${lastError?.message || lastError}`
  );
}
