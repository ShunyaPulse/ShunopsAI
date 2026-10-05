import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { listPendingApprovals, resolveApproval } from "../../tools/safety.js";
import { ApproveRequestSchema, type ApproveRequest } from "../schemas/alert.js";

export interface ApprovalsRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Human-in-the-loop approval queue (Fastify Engine).
 */
export async function approvalsRoutes(app: FastifyInstance, options: ApprovalsRouteOptions): Promise<void> {
  const { requireAuth } = options;

  app.get(
    "/api/pending-approvals",
    {
      preHandler: [requireAuth],
    },
    async () => {
      return { pending: listPendingApprovals() };
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
      const success = resolveApproval(id, approved);
      if (success) {
        return { success: true, message: `Request ${id} marked as ${approved ? "APPROVED" : "REJECTED"}.` };
      }
      reply.status(404);
      return { success: false, message: `Request ${id} not found or already resolved.` };
    }
  );
}
