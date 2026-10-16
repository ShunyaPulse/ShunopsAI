import type {
  Env,
  ChatMessage,
  ChatRequestBody,
  ToolCall,
  ActionConfirmationDetails,
} from '../types.js';
import { tools } from '../tools/registry.js';
import { DEFAULT_SYSTEM_PROMPT } from './engine/prompt.js';
import { formatSSE } from './engine/sse.js';
import { loadSessionHistory, saveSessionHistory } from './engine/session.js';
import { cascadeStream } from './engine/providers.js';

const MAX_EDGE_REACT_ROUNDS = 4;

/** Everything the edge ReAct loop needs for one request. */
interface EdgeRunContext {
  sessionId: string;
  message: string;
  clientHistory?: string | undefined;
  modelPreference?: string | undefined;
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
  onFirstChunk: (provider: string, model: string) => Promise<void>,
  modelPreference?: string
): Promise<InferenceResult> {
  let provider = 'Unknown';
  let model = 'Unknown';
  let text = '';
  const toolCalls: ToolCall[] = [];
  let isFirstChunk = true;

  for await (const chunk of cascadeStream(history, systemPrompt, env, modelPreference)) {
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
 * Run the multi-turn ReAct loop for one request: up to MAX_EDGE_REACT_ROUNDS of
 * inference and tool execution until the model emits a final conversational response
 * (or raises an interactive action confirmation card), then KV persistence.
 */
async function runEdgeAgentLoop(context: EdgeRunContext): Promise<void> {
  const { sessionId, message, clientHistory, modelPreference, systemPrompt, maxTurns, ttlSeconds, env, sendEvent } = context;

  const conversationHistory = await loadSessionHistory(sessionId, env, maxTurns);
  if (conversationHistory.length === 0 && clientHistory && typeof clientHistory === 'string') {
    for (const line of clientHistory.split('\n').slice(-12)) {
      if (line.startsWith('User: ')) {
        conversationHistory.push({ role: 'user', content: line.slice(6).trim().slice(0, 1500) });
      } else if (line.startsWith('Assistant: ')) {
        conversationHistory.push({ role: 'model', content: line.slice(11).trim().slice(0, 1500) });
      }
    }
  }

  // Append new user message
  conversationHistory.push({
    role: 'user',
    content: message,
    timestamp: Date.now(),
  });

  let requiresConfirmationCard: ActionConfirmationDetails | null = null;
  let emittedStartEvent = false;

  for (let roundIdx = 0; roundIdx < MAX_EDGE_REACT_ROUNDS; roundIdx++) {
    const round = await streamInference(
      conversationHistory,
      systemPrompt,
      env,
      sendEvent,
      async (provider, model) => {
        if (!emittedStartEvent) {
          emittedStartEvent = true;
          await sendEvent('start', { provider, model, sessionId });
        }
      },
      modelPreference
    );

    if (round.toolCalls.length === 0) {
      conversationHistory.push({
        role: 'model',
        content: round.text,
        timestamp: Date.now(),
      });
      break;
    }

    // Record model's tool call invocation in history
    conversationHistory.push({
      role: 'model',
      content: round.text,
      toolCalls: round.toolCalls,
      timestamp: Date.now(),
    });

    const card = await executeToolCalls(
      round.toolCalls,
      conversationHistory,
      env,
      sessionId,
      sendEvent
    );
    if (card) {
      requiresConfirmationCard = card;
    }

    // If this was the final allowed tool round, run one concluding synthesis turn
    if (roundIdx === MAX_EDGE_REACT_ROUNDS - 1) {
      const finalRound = await streamInference(
        conversationHistory,
        systemPrompt,
        env,
        sendEvent,
        async () => {},
        modelPreference
      );
      conversationHistory.push({
        role: 'model',
        content: finalRound.text,
        timestamp: Date.now(),
      });
    }
  }

  // Persist conversation turns to Cloudflare KV
  await saveSessionHistory(sessionId, conversationHistory, env, maxTurns, ttlSeconds);

  // Send completion event
  await sendEvent('done', {
    sessionId,
    hasActionCard: !!requiresConfirmationCard,
  });
}

/** Emit the bilingual fallback events used when the edge run fails (never leak raw errMsg). */
async function emitEdgeFailure(
  sendEvent: EdgeRunContext['sendEvent'],
  sessionId: string,
  _err: unknown
): Promise<void> {
  // Emit user-friendly bilingual fallback message without exposing internal URLs or keys
  const friendlyMessage =
    'We experienced a temporary connectivity delay at the edge. Please try again. / तकनीकी समस्या के कारण सेवा में विलंब हो रहा है, कृपया पुनः प्रयास करें।';

  await sendEvent('chunk', { text: `\n\n> ⚠️ *${friendlyMessage}*` });
  await sendEvent('error', {
    message: friendlyMessage,
  });
  await sendEvent('done', { sessionId, error: true });
}

/**
 * Core agent execution engine:
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
  const rawPageCtx = typeof requestBody.pageContext === 'string' ? requestBody.pageContext.trim().slice(0, 6000) : '';
  const systemPrompt = rawPageCtx
    ? `${DEFAULT_SYSTEM_PROMPT}\n\n[Host Website Live UI Context — Use these exact on-site sidebar items, menus, button colors, and labels to guide the user instead of generic external advice]:\n${rawPageCtx}`
    : DEFAULT_SYSTEM_PROMPT;

  // Prepare Server-Sent Events TransformStream
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: unknown) => {
    const raw = formatSSE(event, data);
    await writer.write(encoder.encode(raw));
  };

  // Run the ReAct agent loop asynchronously on the edge
  void runEdgeAgentLoop({
    sessionId,
    message,
    clientHistory: requestBody.history,
    modelPreference: requestBody.modelPreference,
    systemPrompt,
    maxTurns,
    ttlSeconds,
    env,
    sendEvent,
  })
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
