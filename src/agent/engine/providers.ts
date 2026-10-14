import type { Env, ChatMessage, ToolCall } from '../../types.js';
import { getGeminiToolDeclarations, getOpenAIToolDeclarations } from '../../tools/registry.js';
import { parseSSEStream } from './sse.js';

/** A single streamed inference chunk, provider-agnostic. */
export interface StreamChunk {
  text?: string;
  toolCalls?: ToolCall[];
  isFinish?: boolean;
}

/**
 * Shuffle/Permute API keys to respect the Anti-Contention Invariant
 * (Rule 6 in GEMINI.md).
 */
export function getPermutedKeys(rawPool?: string, singleKey?: string): string[] {
  const keys: string[] = [];
  if (rawPool) {
    // Comma-separated or JSON array of keys
    try {
      if (rawPool.trim().startsWith('[')) {
        const parsed = JSON.parse(rawPool);
        if (Array.isArray(parsed)) keys.push(...parsed.map(String));
      } else {
        keys.push(...rawPool.split(',').map((k) => k.trim()).filter(Boolean));
      }
    } catch {
      keys.push(...rawPool.split(',').map((k) => k.trim()).filter(Boolean));
    }
  }
  if (singleKey && !keys.includes(singleKey.trim())) {
    keys.unshift(singleKey.trim());
  }

  if (keys.length <= 1) return keys;

  // Cryptographic random offset to avoid all instances hitting key 0
  const randomArray = new Uint32Array(1);
  crypto.getRandomValues(randomArray);
  const startIndex = (randomArray[0] ?? 0) % keys.length;

  return [...keys.slice(startIndex), ...keys.slice(0, startIndex)];
}

/**
 * Map platform chat history into the Gemini `contents` format, merging consecutive
 * `tool` responses into a single `function` turn and preserving text accompanying `toolCalls`.
 */
function toGeminiContents(history: ChatMessage[]): unknown[] {
  const out: Array<{ role: string; parts: unknown[] }> = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      const part = {
        functionResponse: {
          name: msg.name || 'tool_response',
          response: { output: msg.content },
        },
      };
      const prev = out[out.length - 1];
      if (prev && prev.role === 'function') {
        prev.parts.push(part);
      } else {
        out.push({ role: 'function', parts: [part] });
      }
      continue;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const parts: unknown[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          },
        });
      }
      out.push({ role: 'model', parts });
      continue;
    }

    const role = msg.role === 'user' ? 'user' : 'model';
    out.push({
      role,
      parts: [{ text: msg.content }],
    });
  }

  return out;
}

/** Primary provider: stream inference via the Google Gemini API (key passed in x-goog-api-key header). */
async function* streamGemini(
  history: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  modelName: string
): AsyncGenerator<StreamChunk> {
  const safeModel = encodeURIComponent(modelName);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:streamGenerateContent?alt=sse`;

  const contents = toGeminiContents(history);

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    tools: getGeminiToolDeclarations(),
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Gemini API returned empty response body.');
  }

  for await (const { data } of parseSSEStream(response.body)) {
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const candidates = parsed.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) continue;

      const candidate = candidates[0];
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) continue;

      for (const part of parts) {
        if (part.text) {
          yield { text: part.text };
        }
        if (part.functionCall) {
          yield {
            toolCalls: [
              {
                id: `call_${crypto.randomUUID()}`,
                name: part.functionCall.name,
                arguments: (part.functionCall.args as Record<string, unknown>) || {},
              },
            ],
          };
        }
      }
    } catch {
      // Ignore partial chunk parse error
    }
  }
}

/** OpenAI-compatible chat message shape used for the Groq/OpenRouter request body. */
interface GroqChatMessage {
  role: string;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

/**
 * Map platform chat history into the OpenAI-compatible message format shared by
 * the Groq and OpenRouter streaming providers.
 */
function toGroqMessages(history: ChatMessage[], systemPrompt: string): GroqChatMessage[] {
  const messages: GroqChatMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of history) {
    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.toolCallId || 'call_default',
        content: m.content,
      });
    } else if (m.toolCalls && m.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
    } else {
      messages.push({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content,
      });
    }
  }

  return messages;
}

/** Tool call assembled from chunked OpenAI-compatible streaming deltas. */
interface PendingToolCall {
  id: string;
  name: string;
  argsText: string;
}

/** Merge one streamed tool-call delta into the accumulator indexed by position. */
function mergeGroqToolCallDelta(
  pending: Record<number, PendingToolCall>,
  deltaToolCall: any
): void {
  const idx = deltaToolCall.index ?? 0;
  if (!pending[idx]) {
    pending[idx] = {
      id: deltaToolCall.id || `call_${Date.now()}`,
      name: deltaToolCall.function?.name || '',
      argsText: '',
    };
  }
  if (deltaToolCall.function?.name) pending[idx].name = deltaToolCall.function.name;
  if (deltaToolCall.function?.arguments) pending[idx].argsText += deltaToolCall.function.arguments;
}

/** Convert accumulated streamed tool calls into platform `ToolCall` objects. */
function finalizeGroqToolCalls(pending: Record<number, PendingToolCall>): ToolCall[] {
  return Object.values(pending).map((tc) => {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(tc.argsText || '{}');
    } catch {
      parsedArgs = {};
    }
    return {
      id: tc.id,
      name: tc.name,
      arguments: parsedArgs,
    };
  });
}

/**
 * OpenAI-compatible streaming engine (Groq LPUs and OpenRouter).
 */
async function* streamOpenAICompatible(
  url: string,
  history: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  modelName: string,
  providerName: string
): AsyncGenerator<StreamChunk> {
  const messages = toGroqMessages(history, systemPrompt);

  const body = {
    model: modelName,
    messages,
    tools: getOpenAIToolDeclarations(),
    stream: true,
    temperature: 0.4,
    max_tokens: 2048,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${providerName} API error status ${response.status}`);
  }

  if (!response.body) {
    throw new Error(`${providerName} API returned empty response body.`);
  }

  // Accumulator for tool calls streamed in chunks
  const pendingToolCalls: Record<number, PendingToolCall> = {};
  let flushedToolCalls = false;

  for await (const { data } of parseSSEStream(response.body)) {
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { text: delta.content };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          mergeGroqToolCallDelta(pendingToolCalls, tc);
        }
      }

      // Check finish reason
      if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
        flushedToolCalls = true;
        yield { toolCalls: finalizeGroqToolCalls(pendingToolCalls), isFinish: true };
      }
    } catch {
      // Ignore partial chunk parse error
    }
  }

  // Flush any accumulated tool calls when the provider closed the stream with finish_reason='stop'
  if (!flushedToolCalls && Object.keys(pendingToolCalls).length > 0) {
    yield { toolCalls: finalizeGroqToolCalls(pendingToolCalls), isFinish: true };
  }
}

async function* streamGroq(
  history: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  modelName: string
) {
  yield* streamOpenAICompatible(
    'https://api.groq.com/openai/v1/chat/completions',
    history,
    systemPrompt,
    apiKey,
    modelName,
    'Groq'
  );
}

/** Candidate model lists per fallback tier. */
const GROQ_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
const OPENROUTER_FALLBACK_MODELS = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

/**
 * Cascade caller that switches across the Gemini key pool -> Groq LPUs ->
 * OpenRouter high-capacity.
 *
 * Complies with Rule 3 in GEMINI.md.
 */
export async function* cascadeStream(
  history: ChatMessage[],
  systemPrompt: string,
  env: Env,
  modelPreference: string = 'auto'
): AsyncGenerator<StreamChunk & { provider: string; model: string }> {
  const geminiKeys = getPermutedKeys(env.GEMINI_KEYS, env.GEMINI_API_KEY);
  const primaryModel = env.PRIMARY_MODEL || 'gemini-3.8-flash';
  const groqModel = env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';

  let lastError: Error | null = null;
  const preferDeepReasoning =
    modelPreference === 'deep-reasoning' || modelPreference === 'groq-120b';

  // 0. When caller explicitly selected Deep Reasoning mode and Groq is configured, prioritize Groq 120B first
  if (preferDeepReasoning && env.GROQ_API_KEY) {
    try {
      for await (const chunk of streamGroq(history, systemPrompt, env.GROQ_API_KEY, groqModel)) {
        yield { ...chunk, provider: 'Groq LPU', model: groqModel };
      }
      return;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // 1. Try the Gemini key pool with rotation.
  const maxGeminiAttempts = Math.min(2, geminiKeys.length);
  for (const key of geminiKeys.slice(0, maxGeminiAttempts)) {
    try {
      for await (const chunk of streamGemini(history, systemPrompt, key, primaryModel)) {
        yield { ...chunk, provider: 'Google Gemini', model: primaryModel };
      }
      return; // Succeeded completely
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next key in pool
    }
  }

  // 2. Fall back to Groq LPUs if Gemini is exhausted or 429'd
  if (env.GROQ_API_KEY) {
    const groqCandidates = Array.from(new Set([groqModel, ...GROQ_FALLBACK_MODELS].filter(Boolean)));
    for (const gModel of groqCandidates) {
      try {
        for await (const chunk of streamGroq(history, systemPrompt, env.GROQ_API_KEY, gModel)) {
          yield { ...chunk, provider: 'Groq LPU', model: gModel };
        }
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  // 3. Fall back to OpenRouter high-capacity if Groq is exhausted or unavailable
  if (env.OPENROUTER_API_KEY) {
    for (const orModel of OPENROUTER_FALLBACK_MODELS) {
      try {
        for await (const chunk of streamOpenAICompatible(
          'https://openrouter.ai/api/v1/chat/completions',
          history,
          systemPrompt,
          env.OPENROUTER_API_KEY,
          orModel,
          'OpenRouter'
        )) {
          yield { ...chunk, provider: 'OpenRouter', model: orModel };
        }
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  // If all providers failed
  throw lastError || new Error('All AI providers (Gemini Key Pool, Groq & OpenRouter) were exhausted.');
}
