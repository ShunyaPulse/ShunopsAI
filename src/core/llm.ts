import OpenAI from "openai";

/**
 * A resolved LLM client plus the model/provider identifiers used for logging.
 */
export interface LlmClient {
  client: OpenAI;
  model: string;
  provider: string;
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Build a Groq-hosted OpenAI-compatible client. Used by the automated PR
 * reviewer and code-scanning resolver because of its high throughput.
 */
export function getGroqClient(model = "openai/gpt-oss-120b"): LlmClient {
  return {
    client: new OpenAI({
      baseURL: GROQ_BASE_URL,
      apiKey: process.env.GROQ_API_KEY || "dummy",
    }),
    model,
    provider: "GROQ",
  };
}

/**
 * Extract the first JSON object from a model response. Models frequently wrap
 * JSON in prose or markdown fences, so callers rely on this instead of a raw
 * `JSON.parse`.
 *
 * Returns `null` when no balanced `{ ... }` block is present.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
