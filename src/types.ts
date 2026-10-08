import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * Cloudflare Worker Environment Bindings
 */
export interface Env {
  // KV Namespace for conversation session storage
  CHAT_SESSIONS: KVNamespace;

  // Gemini API Keys (Single key or comma-separated pool for anti-contention rotation)
  GEMINI_API_KEY?: string;
  GEMINI_KEYS?: string;

  // Groq API Key for fast LPU inference fallback
  GROQ_API_KEY?: string;

  // OpenRouter Key for ultimate resilience fallback
  OPENROUTER_API_KEY?: string;

  // Cloudflare Turnstile Secret Key for bot protection
  TURNSTILE_SECRET_KEY?: string;

  // Allowed Origin for CORS (e.g. "https://yourwebsite.com" or "*")
  ALLOWED_ORIGIN?: string;

  // Webhook for lead capture & integrations
  ACTION_WEBHOOK_URL?: string;

  // External API URL for order/status checks
  EXTERNAL_API_BASE_URL?: string;

  // HMAC Secret for signing action confirmation tokens
  ACTION_SECRET?: string;

  // Model selection overrides
  PRIMARY_MODEL?: string;
  FALLBACK_MODEL?: string;
  GROQ_FALLBACK_MODEL?: string;

  // Configuration options
  MAX_HISTORY_TURNS?: string;
  SESSION_TTL_SECONDS?: string;
}

/**
 * Unified Chat Message
 */
export type Role = 'user' | 'model' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp?: number;
}

/**
 * Tool Schema Definition (Gemini & OpenAI compatible)
 */
export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  handler: (args: Record<string, unknown>, env: Env, sessionId: string) => Promise<ToolExecutionResult>;
}

/**
 * Structured Tool Execution Result
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationDetails?: ActionConfirmationDetails;
}

/**
 * Interactive Action Confirmation Details
 */
export interface ActionConfirmationDetails {
  actionId: string;
  actionType: string;
  payload: Record<string, unknown>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  token: string;
  expiresAt: number;
}

/**
 * Request payload for POST /api/chat
 */
export interface ChatRequestBody {
  sessionId: string;
  message: string;
  turnstileToken?: string;
  systemPrompt?: string;
}

/**
 * Request payload for POST /api/action/confirm
 */
export interface ActionConfirmRequest {
  sessionId: string;
  actionId: string;
  approved: boolean;
  actionType: string;
  payload: Record<string, unknown>;
  token: string;
  /** Epoch ms at which the token expires (bound into the HMAC signature). */
  expiresAt: number;
}

export interface ActionConfirmResponse {
  success: boolean;
  message: string;
  actionId: string;
  status: 'approved' | 'rejected' | 'failed';
  result?: unknown;
}

/**
 * Server-Sent Events Protocol
 */
export type SSEEventType =
  | 'start'
  | 'chunk'
  | 'tool_call'
  | 'tool_result'
  | 'action_required'
  | 'done'
  | 'error';

export interface SSEMessage {
  event: SSEEventType;
  data: string; // JSON-stringified payload
}
