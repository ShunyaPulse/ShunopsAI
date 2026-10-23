import type { preHandlerHookHandler } from "fastify";
import { resolveTenantKey } from "../../../tools/agentic.js";

export interface WorkspaceRouteDeps {
  requireAuth: preHandlerHookHandler;
}

/** Tenant key for the authenticated user on a workspace request. */
export function tenantKeyFor(user: any): string {
  return resolveTenantKey(user?.id, user?.role === "admin" ? "admin" : "user");
}

/** JSON preview that never throws on cyclic or unserialisable values. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
