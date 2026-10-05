import { Router, type Request, type Response } from "express";
import * as crypto from "node:crypto";
import { runAutonomousAgent } from "../../agent/index.js";
import { timingSafeEqualStr } from "../middleware/auth.js";

/**
 * GitHub webhook listener. Triggers asynchronous remediation on new issues.
 *
 * When GITHUB_WEBHOOK_SECRET is configured, the HMAC-SHA256 signature is
 * verified against the raw request body captured by the JSON body parser.
 */
export function webhookRouter(): Router {
  const router = Router();

  router.post("/api/github-webhook", async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"];
    const payload = req.body;

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = (req.headers["x-hub-signature-256"] as string) || "";
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(payload || {}));
      const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (!signature || !timingSafeEqualStr(signature, expected)) {
        res.status(401).json({ error: "Invalid webhook signature." });
        return;
      }
    } else {
      console.warn("[GitHub Webhook] GITHUB_WEBHOOK_SECRET not set — signature verification is disabled.");
    }

    res.status(202).json({ received: true, event });

    if (event === "issues" && payload.action === "opened") {
      const issueTitle = payload.issue?.title;
      const issueBody = payload.issue?.body;
      const issueNum = payload.issue?.number;
      const repo = payload.repository?.full_name;

      console.log(`\n\x1b[35m[GitHub Webhook]\x1b[0m New Issue #${issueNum} in ${repo}: ${issueTitle}`);

      // Trigger agent asynchronously to analyze and draft fix
      runAutonomousAgent(
        `GitHub Issue #${issueNum} opened in ${repo}:\nTitle: ${issueTitle}\nDescription: ${issueBody}\nInspect codebase, draft a fix, and verify.`,
        { maxSteps: 10 }
      ).catch(console.error);
    }
  });

  return router;
}
