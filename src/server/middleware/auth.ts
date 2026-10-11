import * as crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { findUserBySessionToken, findUserByApiKey } from "../db.js";

/** Constant-time string comparison that never throws on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface AuthConfig {
  /** Shared bearer token guarding privileged endpoints (empty = disabled). */
  apiToken: string;
  /** Interface the server binds to; localhost tokens may be omitted. */
  host: string;
  /** Dashboard basic auth username. */
  dashboardUsername?: string;
  /** Dashboard basic auth password. */
  dashboardPassword?: string;
}

/** Verify HTTP Basic Auth header against expected credentials. */
export function verifyBasicAuth(header: string, expectedUser?: string, expectedPass?: string): boolean {
  if (!header.startsWith("Basic ") || !expectedUser || !expectedPass) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) return false;
    const user = decoded.slice(0, colonIdx);
    const pass = decoded.slice(colonIdx + 1);
    return timingSafeEqualStr(user, expectedUser) && timingSafeEqualStr(pass, expectedPass);
  } catch {
    return false;
  }
}

/**
 * Build the multi-tenant auth hook for privileged endpoints in Fastify.
 * Accepts:
 * 1. Master Bearer token / X-API-Key (grants admin access)
 * 2. Per-User API key (shun_...)
 * 3. Master Basic Auth credentials
 * 4. Logged-in session cookie (shunops_user_session)
 * Attaches the resolved user to (req as any).user.
 */
export function createRequireAuth(config: AuthConfig) {
  const { apiToken, host, dashboardUsername, dashboardPassword } = config;

  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = (req.headers.authorization as string) || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const provided = bearer || (req.headers["x-api-key"] as string) || "";

    // 1. Validate Master Bearer token or Master X-API-Key
    if (apiToken && provided && timingSafeEqualStr(provided, apiToken)) {
      (req as any).user = { id: 0, username: "master_admin", role: "admin", isMaster: true };
      return;
    }

    // 2. Validate Per-User API Key (shun_...)
    if (provided && provided.startsWith("shun_")) {
      try {
        const user = await findUserByApiKey(provided);
        if (user) {
          (req as any).user = user;
          return;
        }
      } catch {}
    }

    // 3. Validate Basic Auth from authenticated browser session or automation
    if (dashboardUsername && dashboardPassword && verifyBasicAuth(header, dashboardUsername, dashboardPassword)) {
      (req as any).user = { id: 0, username: dashboardUsername, role: "admin", isMaster: true };
      return;
    }

    // 4. Validate Logged-in Session Cookie (shunops_user_session)
    const sessionCookie = (req.cookies as any)?.shunops_user_session;
    if (sessionCookie) {
      try {
        const user = await findUserBySessionToken(sessionCookie);
        if (user) {
          (req as any).user = user;
          return;
        }
      } catch {}
    }

    // 5. Allow unauthenticated only for genuinely local, direct connections when
    // no apiToken is configured (dev mode).
    if (!apiToken && (host === "127.0.0.1" || host === "localhost")) {
      const remote = req.socket?.remoteAddress || "";
      const isLoopback =
        remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const isProxied = Boolean(req.headers["x-forwarded-for"]);
      if (isLoopback && !isProxied) {
        (req as any).user = { id: 0, username: "local_dev", role: "admin", isMaster: true };
        return;
      }
    }

    reply.status(401).send({ error: "Unauthorized. Valid session, user API key, or authorization token required." });
  };
}

/**
 * Build HTTP Basic Auth / Admin challenge hook for browser dashboard & sentinel pages.
 */
export function createRequireDashboardAuth(config: AuthConfig) {
  const { apiToken, host, dashboardUsername, dashboardPassword } = config;

  return async function requireDashboardAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = (req.headers.authorization as string) || "";

    // 1. Basic Auth check (for automation/CLI with explicit credentials)
    if (dashboardUsername && dashboardPassword && verifyBasicAuth(header, dashboardUsername, dashboardPassword)) {
      (req as any).user = { id: 0, username: dashboardUsername, role: "admin", isMaster: true };
      return;
    }

    // 2. Bearer token check (Master API token)
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || (req.headers["x-api-key"] as string) || "";
    if (token && apiToken && timingSafeEqualStr(token, apiToken)) {
      (req as any).user = { id: 0, username: "master_admin", role: "admin", isMaster: true };
      return;
    }

    // 3. Admin session cookie check
    const sessionCookie = (req.cookies as any)?.shunops_user_session;
    if (sessionCookie) {
      try {
        const user = await findUserBySessionToken(sessionCookie);
        if (user && user.role === "admin") {
          (req as any).user = user;
          return;
        }
      } catch {}
    }

    // 4. Allow unauthenticated only for direct loopback connections when
    // no dashboard password AND no apiToken are configured (local dev convenience).
    if (!dashboardPassword && !apiToken && (host === "127.0.0.1" || host === "localhost")) {
      const remote = req.socket?.remoteAddress || "";
      const isLoopback =
        remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const isProxied = Boolean(req.headers["x-forwarded-for"]);
      if (isLoopback && !isProxied) {
        (req as any).user = { id: 0, username: "local_dev", role: "admin", isMaster: true };
        return;
      }
    }

    // For browser requests (HTML), redirect directly to /login
    if (req.headers.accept?.includes("text/html")) {
      return reply.redirect("/login");
    }

    // For API requests, return 401 JSON
    reply.status(401).send({ error: "Unauthorized. Admin privileges required." });
  };
}
