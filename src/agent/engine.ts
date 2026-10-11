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

WEBSITE CONTEXTS & ADAPTATION:
1. SaralGati (Elderly Accessibility Companion & Caregiver Hub):
   - Provide respectful, patient, and warm guidance in simple Hindi/English (Hinglish supported).
   - SOS & Emergency: Clarify how caregiver alerts work, remind that emergency services (112 / ambulance) should be dialed immediately for critical medical distress, and verify alert status.
   - Smartphone Guidance: Explain phone buttons (Volume, Home, Power, Back) and app usage (WhatsApp, calling, camera) in ultra-simple step-by-step instructions.
   - Medicine & Care Routine: Explain medication schedules, meal timings, water reminders, and daily habits.
   - Anti-Fraud & Scam Shield: Evaluate suspicious messages, OTP requests, fake bank calls, lottery messages, and instruct elders never to share PIN/OTP.

2. Kanban Cloud (Agile Workflow & Board Management):
   - Help users structure boards (Backlog, In Progress, Review, Done).
   - Card creation and sprint planning: Summarize workload, explain WIP (Work In Progress) limit best practices, highlight blockers, and advise on task prioritization.
   - Board actions: Automations, swimlanes, and metrics (lead time, cycle time, throughput).

3. Generic Command & Action Engine:
   - When visitors want to register, submit inquiry, contact sales, or book a demo: Call 'submit_lead'.
   - When users ask to track an order, parcel, delivery, or support ticket reference: Call 'track_order_or_status'.
   - When users want to schedule a meeting, consultation call, or appointment: Call 'schedule_appointment'.
   - When users issue commands to restart services, flush cache, deploy preview, change tiers, or cancel subscriptions: Call 'trigger_system_action'.

GUIDELINES:
- Always use the appropriate tool when user intent implies an action or information retrieval. Do not fabricate order numbers or appointments without invoking tools.
- Keep conversational answers crisp, helpful, and formatted with clean Markdown (bolding, lists, code blocks).
- Be polite, professional, and empathetic.
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
 * Map platform chat history into the Gemini `contents` format.
 */
function toGeminiContents(history: ChatMessage[]): unknown[] {
  return history.map((msg) => {
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
    const errText = await response.text();
    throw new Error(`${providerName} API error status ${response.status}: ${errText.slice(0, 150)}`);
  }

  if (!response.body) {
    throw new Error(`${providerName} API returned empty response body.`);
  }

  // Accumulator for tool calls streamed in chunks
  const pendingToolCalls: Record<number, PendingToolCall> = {};

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
        yield { toolCalls: finalizeGroqToolCalls(pendingToolCalls), isFinish: true };
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

/** Everything the edge ReAct loop needs for one request. */
interface EdgeRunContext {
  sessionId: string;
  message: string;
  systemPrompt: string;
  maxTurns: number;
  ttlSeconds: number;
  env: Env;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

/** Outcome of a single streamed inference round. */
interface InferenceResult {
  provider: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
}

/**
 * Stream one inference round through the provider cascade, forwarding text
 * chunks to the client and collecting any tool calls the model requested.
 */
async function streamInference(
  history: ChatMessage[],
  systemPrompt: string,
  env: Env,
  sendEvent: EdgeRunContext['sendEvent'],
  onFirstChunk: (provider: string, model: string) => Promise<void>
): Promise<InferenceResult> {
  let provider = 'Unknown';
  let model = 'Unknown';
  let text = '';
  const toolCalls: ToolCall[] = [];
  let isFirstChunk = true;

  for await (const chunk of cascadeStream(history, systemPrompt, env)) {
    if (isFirstChunk) {
      provider = chunk.provider;
      model = chunk.model;
      await onFirstChunk(provider, model);
      isFirstChunk = false;
    }

    if (chunk.text) {
      text += chunk.text;
      await sendEvent('chunk', { text: chunk.text });
    }

    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      toolCalls.push(...chunk.toolCalls);
    }
  }

  return { provider, model, text, toolCalls };
}

/**
 * Execute the model's tool calls in order, streaming each result and feeding it
 * back into the conversation. Returns the confirmation card when one was raised.
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  conversationHistory: ChatMessage[],
  env: Env,
  sessionId: string,
  sendEvent: EdgeRunContext['sendEvent']
): Promise<ActionConfirmationDetails | null> {
  let confirmationCard: ActionConfirmationDetails | null = null;

  for (const tc of toolCalls) {
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
      confirmationCard = result.confirmationDetails;
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

  return confirmationCard;
}

/**
 * Run the multi-turn ReAct loop for one request: first inference round, tool
 * execution, a second round to stream the final answer, then KV persistence.
 */
async function runEdgeAgentLoop(context: EdgeRunContext): Promise<void> {
  const { sessionId, message, systemPrompt, maxTurns, ttlSeconds, env, sendEvent } = context;

  const conversationHistory = await loadSessionHistory(sessionId, env, maxTurns);

  // Append new user message
  conversationHistory.push({
    role: 'user',
    content: message,
    timestamp: Date.now(),
  });

  // First round of inference
  const firstRound = await streamInference(
    conversationHistory,
    systemPrompt,
    env,
    sendEvent,
    (provider, model) => sendEvent('start', { provider, model, sessionId })
  );

  let requiresConfirmationCard: ActionConfirmationDetails | null = null;

  if (firstRound.toolCalls.length > 0) {
    // Record model's tool call invocation in history
    conversationHistory.push({
      role: 'model',
      content: firstRound.text,
      toolCalls: firstRound.toolCalls,
      timestamp: Date.now(),
    });

    requiresConfirmationCard = await executeToolCalls(
      firstRound.toolCalls,
      conversationHistory,
      env,
      sessionId,
      sendEvent
    );

    // Second round of inference to stream the final conversational answer after tool execution
    const secondRound = await streamInference(conversationHistory, systemPrompt, env, sendEvent, async () => {});

    // Add final assistant response to history
    conversationHistory.push({
      role: 'model',
      content: secondRound.text,
      timestamp: Date.now(),
    });
  } else {
    // Pure conversational response without tool calls
    conversationHistory.push({
      role: 'model',
      content: firstRound.text,
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
}

/** Emit the bilingual fallback events used when the edge run fails. */
async function emitEdgeFailure(
  sendEvent: EdgeRunContext['sendEvent'],
  sessionId: string,
  err: unknown
): Promise<void> {
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
  const { sessionId } = requestBody;
  // Never accept a client-supplied system prompt: it would let a visitor
  // override the agent's safety/behavior instructions (prompt injection).
  const message = String(requestBody.message || '').slice(0, 8000);
  const maxTurns = parseInt(env.MAX_HISTORY_TURNS || '10', 10);
  const ttlSeconds = parseInt(env.SESSION_TTL_SECONDS || '86400', 10);
  const systemPrompt = DEFAULT_SYSTEM_PROMPT;

  // Prepare Server-Sent Events TransformStream
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: unknown) => {
    const raw = formatSSE(event, data);
    await writer.write(encoder.encode(raw));
  };

  // Run the ReAct agent loop asynchronously on the edge
  void runEdgeAgentLoop({ sessionId, message, systemPrompt, maxTurns, ttlSeconds, env, sendEvent })
    .catch((err: unknown) => emitEdgeFailure(sendEvent, sessionId, err))
    .finally(async () => {
      try {
        await writer.close();
      } catch {
        // Stream writer already closed
      }
    });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
