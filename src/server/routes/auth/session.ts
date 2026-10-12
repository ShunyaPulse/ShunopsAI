import type { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { createSession, findUserBySessionToken, type SessionUser, type UserRecord } from "../../db.js";

/** HTTP-only cookie that carries the authenticated user's session token. */
export const COOKIE_NAME = "shunops_user_session";

const SESSION_TTL_DAYS = 7;

/** Minimal, secret-free user shape returned by the auth endpoints. */
export interface PublicUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
}

/** Strip password hashes and provider ids before returning a user to a client. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

/** Issue a fresh session token for the user and set the HTTP-only auth cookie. */
export async function startUserSession(userId: number, reply: FastifyReply): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await createSession(userId, token, SESSION_TTL_DAYS);
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
  return token;
}

/** Resolve the session cookie to a user, or null when unauthenticated. */
export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const token = (req.cookies as any)?.[COOKIE_NAME];
  if (!token) return null;
  return findUserBySessionToken(token);
}

/**
 * Resolve the current user for a handler that requires authentication. Sends a
 * 401 and returns null when there is no valid session, so callers only need to
 * guard on the returned user.
 */
export async function requireSessionUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  if (!user) reply.status(401);
  return user;
}
