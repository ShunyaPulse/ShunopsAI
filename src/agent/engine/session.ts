import type { Env, ChatMessage } from '../../types.js';

/** Load persisted session history from Cloudflare KV. */
export async function loadSessionHistory(
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

/** Persist the recent session history to Cloudflare KV. */
export async function saveSessionHistory(
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
