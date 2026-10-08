import type {
  Env,
  ChatMessage,
  ChatRequestBody,
  ToolCall,
  ActionConfirmationDetails,
  Role,
} from '../types.js';
import {
  tools,
  getGeminiToolDeclarations,
  getOpenAIToolDeclarations,
} from '../tools/registry.js';

// Default prompt ensuring active tool calling and professional edge intelligence
const DEFAULT_SYSTEM_PROMPT = `You are a high-speed, proactive Cloudflare Edge AI Agent and Command Engine.
Your role is to assist website visitors, answer questions accurately, and execute user commands in real time.

CAPABILITIES:
1. Conversational Q&A: Explain services, answer questions, provide guidance, and chat naturally with rapid, concise responses.
2. Command & Action Engine:
   - When visitors want to register, submit inquiry, contact sales, or book a demo: Call 'submit_lead'.
   - When users ask to track an order, parcel, delivery, or support ticket reference: Call 'track_order_or_status'.
   - When users want to schedule a meeting, consultation call, or appointment: Call 'schedule_appointment'.
   - When users issue commands to restart services, flush cache, deploy preview, change tiers, or cancel subscriptions: Call 'trigger_system_action'.

GUIDELINES:
- Always use the appropriate tool when user intent implies an action or information retrieval. Do not fabricate order numbers or appointments without invoking tools.
- Keep conversational answers crisp, helpful, and formatted with clean Markdown (bolding, lists, code blocks).
- Be polite, professional, and support both English and Hindi naturally if addressed in Hindi.
`;

/**
 * Format SSE Message string
 */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Shuffle/Permute API keys to respect Anti-Contention Invariant (Rule 6 in GEMINI.md)
 */
function getPermutedKeys(rawPool?: string, singleKey?: string): string[] {
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
 * Load session history from Cloudflare KV
 */
async function loadSessionHistory(
  sessionId: string,
  env: Env,
  maxTurns: number = 10
): Promise<ChatMessage[]> {
  if (!env.CHAT_SESSIONS || !sessionId) return [];
  try {
    const raw = await env.CHAT_SESSIONS.get(`session:${sessionId}`, 'text');
    if (!raw) return [];
    const history = JSON.parse(raw) as ChatMessage[];
    if (Array.isArray(history)) {
      return history.slice(-maxTurns * 2);
    }
  } catch {
    // Ignore KV read errors gracefully
  }
  return [];
}

/**
 * Save session history to Cloudflare KV
 */
async function saveSessionHistory(
  sessionId: string,
  history: ChatMessage[],
  env: Env,
  maxTurns: number = 10,
  ttlSeconds: number = 86400
): Promise<void> {
  if (!env.CHAT_SESSIONS || !sessionId) return;
  try {
    const trimmed = history.slice(-maxTurns * 2);
    await env.CHAT_SESSIONS.put(`session:${sessionId}`, JSON.stringify(trimmed), {
      expirationTtl: ttlSeconds,
    });
  } catch {
    // Non-blocking KV save
  }
}

/**
 * Parse Server-Sent Events stream from upstream fetch
 */
async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ event?: string | undefined; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep remainder

      let currentEvent: string | undefined = undefined;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = undefined;
          continue;
        }
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          yield { event: currentEvent, data };
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      yield { data: buffer.trim().slice(5).trim() };
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Primary Provider: Stream inference via Google Gemini API
 */
async function* streamGemini(
  history: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  modelName: string
): AsyncGenerator<{
  text?: string;
  toolCalls?: ToolCall[];
  isFinish?: boolean;
}> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

  // Map history to Gemini format
  const contents = history.map((msg) => {
    const role = msg.role === 'user' ? 'user' : 'model';

    if (msg.role === 'tool') {
      return {
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name || 'tool_response',
              response: { output: msg.content },
            },
          },
        ],
      };
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'model',
        parts: msg.toolCalls.map((tc) => ({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          },
        })),
      };
    }

    return {
      role,
      parts: [{ text: msg.content }],
    };
  });

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error status ${response.status}: ${errText.slice(0, 150)}`);
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
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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

/**
 * OpenAI-Compatible Streaming Engine (Groq LPUs and OpenRouter)
 */
async function* streamOpenAICompatible(
  url: string,
  history: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  modelName: string,
  providerName: string
): AsyncGenerator<{
  text?: string;
  toolCalls?: ToolCall[];
  isFinish?: boolean;
}> {
  const messages: Array<{
    role: string;
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  }> = [{ role: 'system', content: systemPrompt }];

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
        content: null,
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
    const errText = await response.text();
    throw new Error(`${providerName} API error status ${response.status}: ${errText.slice(0, 150)}`);
  }

  if (!response.body) {
    throw new Error(`${providerName} API returned empty response body.`);
  }

  // Accumulator for tool calls streamed in chunks
  const pendingToolCalls: Record<number, { id: string; name: string; argsText: string }> = {};

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
          const idx = tc.index ?? 0;
          if (!pendingToolCalls[idx]) {
            pendingToolCalls[idx] = {
              id: tc.id || `call_${Date.now()}`,
              name: tc.function?.name || '',
              argsText: '',
            };
          }
          if (tc.function?.name) pendingToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) pendingToolCalls[idx].argsText += tc.function.arguments;
        }
      }

      // Check finish reason
      const finishReason = parsed.choices?.[0]?.finish_reason;
      if (finishReason === 'tool_calls') {
        const completedCalls: ToolCall[] = Object.values(pendingToolCalls).map((tc) => {
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
        yield { toolCalls: completedCalls, isFinish: true };
      }
    } catch {
      // Ignore partial chunk parse error
    }
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

/**
 * Cascade caller that switches across Gemini Key pool -> Groq LPUs -> OpenRouter High-Capacity
 * Complies with Rule 3 in GEMINI.md
 */
async function* cascadeStream(
  history: ChatMessage[],
  systemPrompt: string,
  env: Env
): AsyncGenerator<{
  text?: string;
  toolCalls?: ToolCall[];
  provider: string;
  model: string;
}> {
  const geminiKeys = getPermutedKeys(env.GEMINI_KEYS, env.GEMINI_API_KEY);
  const primaryModel = env.PRIMARY_MODEL || 'gemini-3.8-flash';
  const groqModel = env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';

  let lastError: Error | null = null;

  // 1. Try Gemini Key Pool with rotation
  for (const key of geminiKeys) {
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

  // 2. Fallback to Groq LPUs if Gemini is exhausted or 429'd
  if (env.GROQ_API_KEY) {
    const groqCandidates = Array.from(new Set([groqModel, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'].filter(Boolean)));
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

  // 3. Fallback to OpenRouter High-Capacity if Groq is exhausted or unavailable
  if (env.OPENROUTER_API_KEY) {
    const openrouterCandidates = [
      'openrouter/free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ];
    for (const orModel of openrouterCandidates) {
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

/**
 * Core Agent Execution Engine:
 * - Loads session from KV
 * - Manages multi-turn ReAct tool execution loop
 * - Emits real-time SSE stream events
 * - Updates KV state cleanly
 */
export async function executeAgentStream(
  requestBody: ChatRequestBody,
  env: Env
): Promise<Response> {
  const { sessionId, message, systemPrompt: customPrompt } = requestBody;
  const maxTurns = parseInt(env.MAX_HISTORY_TURNS || '10', 10);
  const ttlSeconds = parseInt(env.SESSION_TTL_SECONDS || '86400', 10);
  const systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;

  // Prepare Server-Sent Events TransformStream
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: unknown) => {
    const raw = formatSSE(event, data);
    await writer.write(encoder.encode(raw));
  };

  // Run the ReAct agent loop asynchronously on the edge
  (async () => {
    const conversationHistory = await loadSessionHistory(sessionId, env, maxTurns);

    // Append new user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    conversationHistory.push(userMessage);

    let activeProvider = 'Unknown';
    let activeModel = 'Unknown';
    let accumulatedText = '';
    const collectedToolCalls: ToolCall[] = [];
    let requiresConfirmationCard: ActionConfirmationDetails | null = null;

    try {
      // First round of inference
      let isFirstChunk = true;

      for await (const chunk of cascadeStream(conversationHistory, systemPrompt, env)) {
        if (isFirstChunk) {
          activeProvider = chunk.provider;
          activeModel = chunk.model;
          await sendEvent('start', {
            provider: activeProvider,
            model: activeModel,
            sessionId,
          });
          isFirstChunk = false;
        }

        if (chunk.text) {
          accumulatedText += chunk.text;
          await sendEvent('chunk', { text: chunk.text });
        }

        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          collectedToolCalls.push(...chunk.toolCalls);
        }
      }

      // If the model called tools, execute them in the ReAct loop
      if (collectedToolCalls.length > 0) {
        // Record model's tool call invocation in history
        conversationHistory.push({
          role: 'model',
          content: accumulatedText,
          toolCalls: collectedToolCalls,
          timestamp: Date.now(),
        });

        for (const tc of collectedToolCalls) {
          await sendEvent('tool_call', {
            name: tc.name,
            args: tc.arguments,
            toolCallId: tc.id,
          });

          const toolDef = tools[tc.name];
          if (!toolDef) {
            const errorResult = { error: `Tool "${tc.name}" is not registered.` };
            await sendEvent('tool_result', { name: tc.name, result: errorResult });
            conversationHistory.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              content: JSON.stringify(errorResult),
            });
            continue;
          }

          // Execute tool handler
          const result = await toolDef.handler(tc.arguments, env, sessionId);

          // If the tool requires interactive user confirmation (e.g., trigger_system_action)
          if (result.requiresConfirmation && result.confirmationDetails) {
            requiresConfirmationCard = result.confirmationDetails;
            await sendEvent('action_required', {
              action: result.confirmationDetails,
            });
          }

          await sendEvent('tool_result', {
            name: tc.name,
            result: result.data || result.error,
          });

          // Feed result back into conversation history
          conversationHistory.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            content: JSON.stringify(result.data || result.error),
          });
        }

        // Second round of inference to stream the final conversational answer after tool execution
        let secondRoundText = '';
        for await (const chunk of cascadeStream(conversationHistory, systemPrompt, env)) {
          if (chunk.text) {
            secondRoundText += chunk.text;
            await sendEvent('chunk', { text: chunk.text });
          }
        }

        // Add final assistant response to history
        conversationHistory.push({
          role: 'model',
          content: secondRoundText,
          timestamp: Date.now(),
        });
      } else {
        // Pure conversational response without tool calls
        conversationHistory.push({
          role: 'model',
          content: accumulatedText,
          timestamp: Date.now(),
        });
      }

      // Persist conversation turns to Cloudflare KV
      await saveSessionHistory(sessionId, conversationHistory, env, maxTurns, ttlSeconds);

      // Send completion event
      await sendEvent('done', {
        sessionId,
        hasActionCard: !!requiresConfirmationCard,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Emit user-friendly bilingual fallback message
      const friendlyMessage =
        'We experienced a temporary connectivity delay at the edge. Please try again. / तकनीकी समस्या के कारण सेवा में विलंब हो रहा है, कृपया पुनः प्रयास करें।';

      await sendEvent('chunk', { text: `\n\n> ⚠️ *${friendlyMessage}*` });
      await sendEvent('error', {
        message: friendlyMessage,
        detail: errMsg.slice(0, 100),
      });
      await sendEvent('done', { sessionId, error: true });
    } finally {
      try {
        await writer.close();
      } catch {
        // Stream writer already closed
      }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
