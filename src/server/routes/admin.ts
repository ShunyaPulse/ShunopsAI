import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  listAllUsers,
  updateUserRole,
  revokeAllUserSessions,
  getSystemUserStats,
  findUserBySessionToken,
} from "../db.js";
import { isAdminUser } from "../scope.js";

export interface AdminRouteOptions {
  requireDashboardAuth?: preHandlerHookHandler;
}

/**
 * Admin Console & Governance Routes (Restricted to role='admin' / 'operator').
 */
export async function adminRoutes(app: FastifyInstance, options: AdminRouteOptions = {}): Promise<void> {
  const adminGuard: preHandlerHookHandler = async (req, reply) => {
    // 1. If options.requireDashboardAuth provided, run it
    if (options.requireDashboardAuth) {
      await (options.requireDashboardAuth as any)(req, reply);
      if (reply.sent) return;
    }

    // 2. Double-check session user role
    const sessionCookie = (req.cookies as any)?.shunops_user_session;
    if (sessionCookie) {
      const user = await findUserBySessionToken(sessionCookie);
      if (user && isAdminUser(user)) {
        (req as any).user = user;
        return;
      }
    }

    // 3. Check if attached req.user is admin/operator
    const attachedUser = (req as any).user;
    if (attachedUser && isAdminUser(attachedUser)) {
      return;
    }

    reply.status(403).send({ error: "Access denied. Administrator privileges required." });
  };

  // 1. List users
  app.get("/api/admin/users", { preHandler: [adminGuard] }, async (req) => {
    const query = (req.query as any) || {};
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const users = await listAllUsers(limit, offset);
    return { success: true, users };
  });

  // 2. Change user role (promote / demote)
  app.post<{ Params: { id: string }; Body: { role: string } }>(
    "/api/admin/users/:id/role",
    { preHandler: [adminGuard] },
    async (req, reply) => {
      const userId = Number(req.params.id);
      const { role } = req.body || {};

      if (!userId || !role) {
        reply.status(400);
        return { error: "User ID and new role are required." };
      }

      const actor = (req as any).user;
      if (actor && typeof actor.id === "number" && actor.id === userId && role !== "admin") {
        reply.status(400);
        return { error: "Cannot demote your own currently active administrator account." };
      }

      const updated = await updateUserRole(userId, role);
      if (!updated) {
        reply.status(404);
        return { error: "User not found or invalid role." };
      }

      // Immediately revoke existing sessions when a user's role changes so
      // privilege changes (especially demotions) take effect without stale sessions.
      if (!actor || actor.id !== userId) {
        await revokeAllUserSessions(userId);
      }

      return { success: true, message: `User role updated to '${role}'.` };
    }
  );

  // 3. Revoke all sessions for a user
  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/revoke-sessions",
    { preHandler: [adminGuard] },
    async (req, reply) => {
      const userId = Number(req.params.id);
      if (!userId) {
        reply.status(400);
        return { error: "Valid User ID is required." };
      }

      await revokeAllUserSessions(userId);
      return { success: true, message: `All active sessions revoked for user ${userId}.` };
    }
  );

  // 4. System statistics
  app.get("/api/admin/stats", { preHandler: [adminGuard] }, async () => {
    const stats = await getSystemUserStats();
    return { success: true, stats };
  });
}
