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
  app.post<{ Body: CloudAlertEnvelope; Querystring: { token?: string; secret?: string } }>(
    "/api/webhook/cloud-alert",
    {
      schema: {
        body: CloudAlertEnvelopeSchema,
      },
    },
    async (req, reply) => {
      // Optional Secret Verification (Bearer Header, X-Webhook-Secret, or query param ?token=... / ?secret=...)
      const configuredSecret = process.env.API_SECRET || process.env.AUTH_SECRET;
      const inboundSecret =
        req.query.secret ||
        req.query.token ||
        (req.headers["x-webhook-secret"] as string) ||
        (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : undefined);

      if (configuredSecret && inboundSecret) {
        if (!timingSafeEqualStr(inboundSecret, configuredSecret)) {
          reply.status(401);
          return { error: "Invalid webhook secret or token." };
        }
      } else if (process.env.REQUIRE_WEBHOOK_AUTH === "true" && configuredSecret && !inboundSecret) {
        reply.status(401);
        return { error: "Authorization required for webhook." };
      }

      const raw = (req.body as any) || {};

      // 1. Auto-detect GCP Cloud Monitoring payload
      let source: CloudAlertEnvelope["source"] = raw.source || "custom";
      let service: CloudAlertEnvelope["service"] = raw.service || "all";
      let message = raw.message || "";
      let targetUrl = raw.targetUrl || "";
      let isRecovery = false;

      if (raw.incident) {
        source = "gcp";
        const resName = (raw.incident.resource_name || raw.incident.resource_id || "").toLowerCase();
        service = resName.includes("run") || resName.includes("saralgati") || resName.includes("kanban") ? "cloud_run" : "all";
        const state = (raw.incident.state || "").toLowerCase();
        isRecovery = state === "closed";
        message = `GCP Incident [${state.toUpperCase() || "ALERT"}]: ${raw.incident.summary || raw.incident.condition_name || "Cloud Run alert"}`;
        targetUrl = raw.incident.url || "";
      }
      // 2. Auto-detect UptimeRobot payload
      else if (raw.monitorURL || raw.alertTypeFriendlyName || raw.alertType) {
        source = "uptimerobot";
        targetUrl = raw.monitorURL || "";
        const alertType = String(raw.alertType || raw.alertTypeFriendlyName || "").toLowerCase();
        isRecovery = alertType.includes("up") || alertType === "2";
        service = targetUrl.includes("run.app") || targetUrl.includes("saralgati") || targetUrl.includes("kanban") ? "cloud_run" : "website";
        message = `UptimeRobot [${isRecovery ? "UP" : "DOWN"}]: ${raw.monitorFriendlyName || targetUrl || "Site"}`;
      }
      // 3. Auto-detect BetterStack payload
      else if (raw.data?.attributes?.url || (raw.data && raw.data.type === "incident")) {
        source = "betterstack";
        const attrs = raw.data.attributes || {};
        targetUrl = attrs.url || "";
        const status = (attrs.status || "").toLowerCase();
        isRecovery = status === "resolved" || status === "up";
        service = targetUrl.includes("run.app") || targetUrl.includes("saralgati") || targetUrl.includes("kanban") ? "cloud_run" : "website";
        message = `BetterStack Alert [${status.toUpperCase()}]: ${attrs.name || targetUrl || "Endpoint"} - ${attrs.cause || "Check triggered"}`;
      }
      // 4. Auto-detect Cloudflare alert
      else if (raw.data?.pool_name || raw.alert_name || raw.text) {
        source = "cloudflare";
        service = "cloudflare_ai";
        message = `Cloudflare Alert: ${raw.alert_name || raw.data?.pool_name || raw.text || "Health Check alert"}`;
      }

      if (!message) {
        message = "Cloud infrastructure alert received";
      }

      console.log(
        `\n\x1b[33m⚡ [Cloud Alert Direct Webhook]\x1b[0m Source: ${source?.toUpperCase()} | Service: ${service} | Recovery: ${isRecovery} | Message: [REDACTED]`
      );

      reply.status(202);

      // Trigger auto-healing asynchronously based on alert envelope
      setTimeout(async () => {
        try {
          if (service === "cloud_run" || service === "redis" || service === "neon" || service === "website" || service === "all") {
            const healReport = await autoHealService(service, `${isRecovery ? "Post-incident verification" : "Immediate auto-heal"} for ${source}: ${message}`);
            console.log(`\x1b[32m[Cloud Alert Healer]\x1b[0m Result:`, "[REDACTED]");
          } else {
            await runAutonomousAgent(
              `Resolve cloud infrastructure alert from ${source} for service ${service}: ${message}. Target URL: ${targetUrl}. Raw payload: [REDACTED]`,
              { maxSteps: 6 }
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
        isRecovery,
        status: isRecovery ? "VERIFICATION_DISPATCHED" : "HEALING_DISPATCHED",
        timestamp: new Date().toISOString(),
      };
    }
  );
}

