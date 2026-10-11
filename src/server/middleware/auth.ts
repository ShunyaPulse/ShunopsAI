import * as crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

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
 * Build the bearer/X-API-Key/Basic Auth hook for privileged endpoints in Fastify.
 */
export function createRequireAuth(config: AuthConfig) {
  const { apiToken, host, dashboardUsername, dashboardPassword } = config;

  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = (req.headers.authorization as string) || "";

    // 1. Validate Bearer token or X-API-Key
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const provided = bearer || (req.headers["x-api-key"] as string) || "";

    if (apiToken && provided && timingSafeEqualStr(provided, apiToken)) {
      return;
    }

    // 2. Validate Basic Auth from authenticated browser session
    if (dashboardUsername && dashboardPassword && verifyBasicAuth(header, dashboardUsername, dashboardPassword)) {
      return;
    }

    // Allow unauthenticated only for genuinely local, direct connections when
    // no apiToken is configured. A request bearing X-Forwarded-For is treated
    // as proxied (i.e. potentially public) and must authenticate, so a
    // reverse proxy in front of a localhost bind cannot silently expose this.
    if (!apiToken && (host === "127.0.0.1" || host === "localhost")) {
      const remote = req.socket?.remoteAddress || "";
      const isLoopback =
        remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const isProxied = Boolean(req.headers["x-forwarded-for"]);
      if (isLoopback && !isProxied) return;
    }

    reply.status(401).send({ error: "Unauthorized." });
  };
}

/**
 * Build HTTP Basic Auth challenge hook for browser dashboard & sentinel pages.
 */
export function createRequireDashboardAuth(config: AuthConfig) {
  const { apiToken, host, dashboardUsername, dashboardPassword } = config;

  return async function requireDashboardAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = (req.headers.authorization as string) || "";

    // 1. Basic Auth check
    if (dashboardUsername && dashboardPassword && verifyBasicAuth(header, dashboardUsername, dashboardPassword)) {
      return;
    }

    // 2. Bearer token check
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || (req.headers["x-api-key"] as string) || "";
    if (token && apiToken && timingSafeEqualStr(token, apiToken)) {
      return;
    }

    // 3. Allow unauthenticated only for direct loopback connections when
    // no dashboard password AND no apiToken are configured (local dev convenience).
    if (!dashboardPassword && !apiToken && (host === "127.0.0.1" || host === "localhost")) {
      const remote = req.socket?.remoteAddress || "";
      const isLoopback =
        remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const isProxied = Boolean(req.headers["x-forwarded-for"]);
      if (isLoopback && !isProxied) return;
    }

    // Challenge with WWW-Authenticate header for native browser login popup
    reply
      .header("WWW-Authenticate", 'Basic realm="ShunopsAI Command Center"')
      .status(401)
      .type("text/html")
      .send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>401 Unauthorized • ShunopsAI</title>
  <style>
    body { background: #0b0f19; color: #e2e8f0; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { text-align: center; padding: 40px 48px; background: #131c31; border-radius: 12px; border: 1px solid #1e293b; box-shadow: 0 8px 32px rgba(0,0,0,0.5); max-width: 420px; }
    h2 { margin: 0 0 12px; color: #38bdf8; }
    p { margin: 0; color: #94a3b8; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="box">
    <h2>🔒 Access Restricted</h2>
    <p>ShunopsAI Command Center requires authentication.<br>Please sign in with your credentials.</p>
  </div>
</body>
</html>`);
  };
}
