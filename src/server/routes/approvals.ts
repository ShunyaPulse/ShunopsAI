import { Router, type Request, type Response, type RequestHandler } from "express";
import { listPendingApprovals, resolveApproval } from "../../tools/safety.js";

export interface ApprovalsRouterDeps {
  requireAuth: RequestHandler;
}

/**
 * Human-in-the-loop approval queue.
 */
export function approvalsRouter({ requireAuth }: ApprovalsRouterDeps): Router {
  const router = Router();

  router.get("/api/pending-approvals", requireAuth, (_req: Request, res: Response) => {
    res.json({ pending: listPendingApprovals() });
  });

  router.post("/api/approve", requireAuth, (req: Request, res: Response) => {
    const { id, approved } = req.body;

    if (!id || typeof approved !== "boolean") {
      res.status(400).json({ error: "Provide 'id' (string) and 'approved' (boolean)." });
      return;
    }

    const success = resolveApproval(id, approved);
    if (success) {
      res.json({ success: true, message: `Request ${id} marked as ${approved ? "APPROVED" : "REJECTED"}.` });
    } else {
      res.status(404).json({ success: false, message: `Request ${id} not found or already resolved.` });
    }
  });

  return router;
}
