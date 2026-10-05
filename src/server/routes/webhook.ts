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

  // 2. Unified Multi-Cloud Alert Envelope Listener (GCP, UptimeRobot, BetterStack, Cloudflare, n8n)
  app.post<{ Body: CloudAlertEnvelope }>(
    "/api/webhook/cloud-alert",
    {
      schema: {
        body: CloudAlertEnvelopeSchema,
      },
    },
    async (req, reply) => {
      const raw = (req.body as any) || {};

      // 1. Auto-detect GCP Cloud Monitoring payload
      let source: CloudAlertEnvelope["source"] = raw.source || "custom";
      let service: CloudAlertEnvelope["service"] = raw.service || "all";
      let message = raw.message || "";
      let targetUrl = raw.targetUrl || "";

      if (raw.incident) {
        source = "gcp";
        const resName = (raw.incident.resource_name || raw.incident.resource_id || "").toLowerCase();
        service = resName.includes("run") || resName.includes("saralgati") || resName.includes("kanban") ? "cloud_run" : "all";
        message = `GCP Incident: ${raw.incident.summary || raw.incident.condition_name || "Cloud Run alert"}`;
        targetUrl = raw.incident.url || "";
      }
      // 2. Auto-detect UptimeRobot payload
      else if (raw.monitorURL || raw.alertTypeFriendlyName) {
        source = "uptimerobot";
        service = "website";
        targetUrl = raw.monitorURL || "";
        message = `UptimeRobot Alert: ${raw.monitorFriendlyName || "Site"} status is ${raw.alertTypeFriendlyName || "Down"}`;
      }
      // 3. Auto-detect BetterStack payload
      else if (raw.data?.attributes?.url) {
        source = "betterstack";
        service = "website";
        targetUrl = raw.data.attributes.url;
        message = `BetterStack Alert: ${raw.data.attributes.name || "Endpoint"} status is ${raw.data.attributes.status || "Degraded"}`;
      }
      // 4. Auto-detect Cloudflare alert
      else if (raw.data?.pool_name || raw.alert_name) {
        source = "cloudflare";
        service = "cloudflare_ai";
        message = `Cloudflare Alert: ${raw.alert_name || raw.data?.pool_name || "Health Check alert"}`;
      }

      if (!message) {
        message = "Cloud infrastructure alert received";
      }

      console.log(
        `\n\x1b[33m⚡ [Cloud Alert Webhook]\x1b[0m Source: ${source?.toUpperCase()} | Target Service: ${service} | Message: ${message}`
      );

      reply.status(202);

      // Trigger auto-healing asynchronously based on alert envelope
      setTimeout(async () => {
        try {
          if (service === "cloud_run" || service === "redis" || service === "neon" || service === "website" || service === "all") {
            const healReport = await autoHealService(service, `Triggered by ${source} alert: ${message}`);
            console.log(`\x1b[32m[Cloud Alert Healer]\x1b[0m Result:`, healReport);
          } else {
            // General agent task
            await runAutonomousAgent(
              `Resolve cloud infrastructure alert from ${source} for service ${service}: ${message}. Target URL: ${targetUrl}. Raw payload: ${JSON.stringify(raw.rawAlert || raw)}`,
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

