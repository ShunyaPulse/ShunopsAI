import type { FastifyInstance } from "fastify";
import * as crypto from "node:crypto";
import { runAutonomousAgent } from "../../agent/index.js";
import { autoHealService } from "../../tools/sentinel.js";
import { timingSafeEqualStr } from "../middleware/auth.js";
import { CloudAlertEnvelopeSchema, type CloudAlertEnvelope } from "../schemas/alert.js";

/**
 * Autonomous Webhook Listener (GitHub Issues & Unified Multi-Cloud Alert Envelope).
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // 1. GitHub Webhook Listener (HMAC-SHA256 cryptographic verification)
  app.post("/api/github-webhook", async (req, reply) => {
    const event = req.headers["x-github-event"] as string;
    const payload = (req.body as any) || {};

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = (req.headers["x-hub-signature-256"] as string) || "";
      const rawBody = (req as any).rawBody ?? Buffer.from(JSON.stringify(payload));
      const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (!signature || !timingSafeEqualStr(signature, expected)) {
        reply.status(401);
        return { error: "Invalid webhook signature." };
      }
    } else {
      req.log.warn("[GitHub Webhook] GITHUB_WEBHOOK_SECRET not set — signature verification is disabled.");
    }

    reply.status(202);

    if (event === "issues" && payload.action === "opened") {
      const issueTitle = payload.issue?.title;
      const issueBody = payload.issue?.body;
      const issueNum = payload.issue?.number;
      const repo = payload.repository?.full_name;

      console.log(`\n\x1b[35m[GitHub Webhook]\x1b[0m New Issue #${issueNum} in ${repo}: ${issueTitle}`);

      runAutonomousAgent(
        `GitHub Issue #${issueNum} opened in ${repo}:\nTitle: ${issueTitle}\nDescription: ${issueBody}\nInspect codebase, draft a fix, and verify.`,
        { maxSteps: 10 }
      ).catch(console.error);
    }

    return { received: true, event };
  });

  // 2. Unified Multi-Cloud Alert Envelope Listener (GCP, UptimeRobot, Cloudflare, n8n)
  app.post<{ Body: CloudAlertEnvelope }>(
    "/api/webhook/cloud-alert",
    {
      schema: {
        body: CloudAlertEnvelopeSchema,
      },
    },
    async (req, reply) => {
      const alert = req.body;
      const source = alert.source || "custom";
      const service = alert.service || "all";
      const message = alert.message || "Cloud infrastructure alert received";

      console.log(
        `\n\x1b[33m⚡ [Cloud Alert Webhook]\x1b[0m Source: ${source.toUpperCase()} | Target Service: ${service} | Message: ${message}`
      );

      reply.status(202);

      // Trigger auto-healing asynchronously based on alert envelope
      setTimeout(async () => {
        try {
          if (service === "cloud_run" || service === "redis" || service === "neon" || service === "all") {
            const healReport = await autoHealService(service, `Triggered by ${source} alert: ${message}`);
            console.log(`\x1b[32m[Cloud Alert Healer]\x1b[0m Result:`, healReport);
          } else {
            // General agent task
            await runAutonomousAgent(
              `Resolve cloud infrastructure alert from ${source} for service ${service}: ${message}. Raw payload: ${JSON.stringify(alert.rawAlert || {})}`,
              { maxSteps: 8 }
            );
          }
        } catch (err: any) {
          console.error(`[Cloud Alert Webhook Error]:`, err?.message || err);
        }
      }, 10);

      return {
        received: true,
        source,
        service,
        status: "HEALING_DISPATCHED",
        timestamp: new Date().toISOString(),
      };
    }
  );
}
