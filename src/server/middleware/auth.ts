import * as crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

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
}

/**
 * Build the bearer/X-API-Key auth middleware for privileged endpoints.
 *
 * If no token is configured the server only permits privileged work when bound
 * to localhost; otherwise it fails closed with a 503.
 */
export function createRequireAuth(config: AuthConfig) {
  const { apiToken, host } = config;

  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!apiToken) {
      // No token configured: refuse to run privileged work unless bound to localhost.
      if (host === "127.0.0.1" || host === "localhost") {
        next();
        return;
      }
      res.status(503).json({ error: "Server misconfigured: set AGENT_API_TOKEN before binding to a public interface." });
      return;
    }
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const provided = bearer || (req.headers["x-api-key"] as string) || "";
    if (provided && timingSafeEqualStr(provided, apiToken)) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized." });
  };
}
