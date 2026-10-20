import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

/**
 * Postgres handle for the whole persistence layer. Every module in this folder
 * resolves its connection through `getSql()`, so connection policy lives in one
 * place. Returns `null` when no DATABASE_URL is configured, which is the signal
 * that the in-memory store below should be used instead.
 */
export function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }
  return neon(dbUrl);
}

/**
 * In-memory store fallback when DATABASE_URL is not set (e.g. testing or local
 * offline mode). Shared mutable state, so it must stay a single module-level
 * instance for every persistence module to see the same data.
 */
export const memStore = {
  users: new Map<number, any>(),
  usersByUsername: new Map<string, any>(),
  usersByEmail: new Map<string, any>(),
  usersByGoogleId: new Map<string, any>(),
  usersByGithubId: new Map<string, any>(),
  sessions: new Map<string, { userId: number; expiresAt: Date }>(),
  emailOtps: new Map<
    string,
    {
      email: string;
      otp: string;
      attempts: number;
      expiresAt: number;
      usedAt: number | null;
      createdAt: number;
    }
  >(),
  tasks: new Map<string, any>(),
  conversations: new Map<string, { id: string; userId: number; title: string; createdAt: string; updatedAt: string }>(),
  chatMessages: [] as Array<{ id: number; userId: number; role: string; message: string; createdAt: string; conversationId?: string }>,
  apiKeys: new Map<string, { id: number; userId: number; prefix: string; name: string; createdAt: string; lastUsedAt: string | null }>(),
  // Per-user platform credentials, keyed `${userId}:${platform}`.
  platformCredentials: new Map<
    string,
    {
      id: number;
      userId: number;
      platform: string;
      label: string | null;
      hint: string;
      payload: string;
      createdAt: string;
      updatedAt: string;
    }
  >(),
  knowledgeDocs: new Map<number, any>(),
  nextUserId: 1,
  nextMsgId: 1,
  nextKeyId: 1,
  nextCredentialId: 1,
  nextDocId: 1,
};

/** Session and API-key tokens are persisted as scrypt hashes, never in plaintext. */
export function hashToken(rawToken: string): string {
  return crypto.scryptSync(rawToken, "shunops-token-salt", 32).toString("hex");
}
