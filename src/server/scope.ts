import { userScope, type ToolScope } from "../agent/scope.js";
import { getUserCredentialBundle } from "./db.js";

/**
 * Shared, request-scoped tenant resolution.
 *
 * Every entry point that can start an agent run (session cookie, personal API
 * key, `Authorization` header) ends up here, so the decision "does this run act
 * on the operator's infrastructure or the caller's own accounts" lives in
 * exactly one place.
 */

export interface AuthenticatedUser {
  id?: number;
  username?: string;
  role?: string;
  isMaster?: boolean;
}

export function isAdminUser(user: AuthenticatedUser | undefined | null): boolean {
  return Boolean(
    user?.isMaster === true || user?.role === "admin" || user?.role === "operator"
  );
}

/** Numeric id of a real tenant account; `0` is the operator/master or anonymous pseudo-user. */
export function tenantUserId(user: AuthenticatedUser | undefined | null): number {
  const id = typeof user?.id === "number" ? user.id : 0;
  return id > 0 ? id : 0;
}

/**
 * Operator (admin/master/operator) callers keep server credentials. A real
 * tenant gets a user scope holding only the credentials they connected, and
 * never any fallback to the server's own. Unauthenticated/anonymous callers
 * (`user == null`) receive a zero-privilege user scope (`userId: 0`) so they can
 * never escalate to `admin` scope.
 */
export async function buildRequestScope(
  user: AuthenticatedUser | undefined | null
): Promise<ToolScope> {
  const userId = tenantUserId(user);
  if (isAdminUser(user)) {
    const adminCreds = userId > 0 ? await getUserCredentialBundle(userId) : {};
    return {
      kind: "admin",
      userId,
      username: user?.username || "admin",
      credentials: adminCreds,
    };
  }
  if (userId <= 0) {
    return userScope(0, "anonymous", {});
  }
  const credentials = await getUserCredentialBundle(userId);
  return userScope(userId, user?.username || `user_${userId}`, credentials);
}
