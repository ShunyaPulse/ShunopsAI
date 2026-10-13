import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { listPendingApprovals, resolveApproval } from "../../tools/safety.js";
import { isAdminUser, tenantUserId, type AuthenticatedUser } from "../scope.js";
import { ApproveRequestSchema, type ApproveRequest } from "../schemas/alert.js";

export interface ApprovalsRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Human-in-the-loop approval queue (Fastify Engine).
 *
 * Tenant isolation: a signed-in user only ever sees and resolves the approval
 * requests raised by their OWN agent runs. Operator (admin/master) callers keep
 * the full queue.
 */
export async function approvalsRoutes(app: FastifyInstance, options: ApprovalsRouteOptions): Promise<void> {
  const { requireAuth } = options;

  const viewer = (req: any): { userId: number; isAdmin: boolean } => {
    const user = req.user as AuthenticatedUser | undefined;
    return { userId: tenantUserId(user), isAdmin: isAdminUser(user) };
  };

  app.get(
    "/api/pending-approvals",
    {
      preHandler: [requireAuth],
    },
    async (req) => {
      const { userId, isAdmin } = viewer(req);
      return {
        success: true,
        scope: isAdmin ? "operator" : "account",
        pending: isAdmin ? listPendingApprovals() : listPendingApprovals(userId),
      };
    }
  );

  app.post<{ Body: ApproveRequest }>(
    "/api/approve",
    {
      preHandler: [requireAuth],
      schema: {
        body: ApproveRequestSchema,
      },
    },
    async (req, reply) => {
      const { id, approved } = req.body;
      const { userId, isAdmin } = viewer(req);

      const success = resolveApproval(id, approved, isAdmin ? { isAdmin: true } : { userId });
      if (success) {
        return { success: true, message: `Request ${id} marked as ${approved ? "APPROVED" : "REJECTED"}.` };
      }
      reply.status(404);
      return {
        success: false,
        message: `Request ${id} not found, already resolved, or not raised by your account.`,
      };
    }
  );
}
