import type { FastifyInstance } from "fastify";
import { registerLocalAuthRoutes } from "./auth/local.js";
import { registerOAuthRoutes } from "./auth/oauth.js";

/**
 * Authentication surface.
 *
 * The handlers live in focused sibling modules:
 * - `auth/session.ts` — cookie/session helpers shared by every handler
 * - `auth/local.ts`   — OTP, register, login, password and account lifecycle
 * - `auth/oauth.ts`   — Google and GitHub OAuth
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  await registerLocalAuthRoutes(app);
  await registerOAuthRoutes(app);
}
