import { execSync } from "node:child_process";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "sage-webbing-422513-q0";
const N8N_WEBHOOK_URL = "http://127.0.0.1:5678/webhook/autonomous-agent";
const SHUNOPS_DIRECT_URL = "http://127.0.0.1:8080/api/webhook/cloud-alert?secret=REDACTED_WEBHOOK_SECRET";

interface GCPNotificationChannel {
  name: string;
  type: string;
  displayName: string;
  labels?: { url?: string };
  enabled?: boolean;
}

interface GCPAlertPolicy {
  name: string;
  displayName: string;
  enabled?: boolean;
  notificationChannels?: string[];
}

/**
 * Get active GCP OAuth2 access token via gcloud CLI.
 */
function getGcpAccessToken(): string {
  try {
    return execSync("gcloud auth print-access-token", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch (err: any) {
    throw new Error(`Failed to retrieve GCP access token: ${err.message}`);
  }
}

/**
 * Wire GCP Cloud Monitoring notification channels and alert policies.
 */
export async function wireGcpMonitoring(): Promise<{
  channels: GCPNotificationChannel[];
  policy: GCPAlertPolicy | null;
}> {
  const token = getGcpAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  console.log(`\x1b[36m[GCP Wire]\x1b[0m Inspecting GCP Notification Channels in project: ${PROJECT_ID}...`);

  // 1. Fetch existing channels
  const channelsRes = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`,
    { headers }
  );
  const channelsData = (await channelsRes.json()) as { notificationChannels?: GCPNotificationChannel[] };
  const existingChannels = channelsData.notificationChannels || [];

  // Find or create n8n channel
  let n8nChannel = existingChannels.find((c) => c.labels?.url === N8N_WEBHOOK_URL);
  if (!n8nChannel) {
    console.log(`\x1b[33m[GCP Wire]\x1b[0m Creating n8n Webhook Notification Channel...`);
    const createRes = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "webhook_tokenauth",
          displayName: "ShunopsAI n8n Webhook Listener",
          description: "Dispatches GCP incidents directly to ShunopsAI n8n orchestrator",
          labels: { url: N8N_WEBHOOK_URL },
        }),
      }
    );
    n8nChannel = (await createRes.json()) as GCPNotificationChannel;
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Created n8n Channel: ${n8nChannel.name}`);
  } else {
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Found existing n8n Channel: ${n8nChannel.name}`);
  }

  // Find or create Direct Sentinel channel
  let directChannel = existingChannels.find((c) => c.labels?.url === SHUNOPS_DIRECT_URL);
  if (!directChannel) {
    console.log(`\x1b[33m[GCP Wire]\x1b[0m Creating Direct Sentinel Webhook Notification Channel...`);
    const createRes = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "webhook_tokenauth",
          displayName: "ShunopsAI Direct Sentinel Webhook",
          description: "Dispatches GCP incidents directly to ShunopsAI Fastify backend on port 8080",
          labels: { url: SHUNOPS_DIRECT_URL },
        }),
      }
    );
    directChannel = (await createRes.json()) as GCPNotificationChannel;
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Created Direct Sentinel Channel: ${directChannel.name}`);
  } else {
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Found existing Direct Sentinel Channel: ${directChannel.name}`);
  }

  // 2. Fetch existing Alert Policies
  console.log(`\x1b[36m[GCP Wire]\x1b[0m Checking Alert Policies in project: ${PROJECT_ID}...`);
  const policiesRes = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`,
    { headers }
  );
  const policiesData = (await policiesRes.json()) as { alertPolicies?: GCPAlertPolicy[] };
  const existingPolicies = policiesData.alertPolicies || [];

  let run5xxPolicy = existingPolicies.find((p) =>
    p.displayName?.includes("Cloud Run 5xx")
  );

  const channelNames = [n8nChannel.name, directChannel.name].filter(Boolean);

  if (!run5xxPolicy) {
    console.log(`\x1b[33m[GCP Wire]\x1b[0m Creating Cloud Run 5xx Server Error Alert Policy...`);
    const createPolicyRes = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "Cloud Run 5xx Server Errors (SaralGati & Kanban)",
          documentation: {
            content:
              "Cloud Run service is returning 5xx server errors. Auto-heal dispatched to ShunopsAI sentinel.",
            mimeType: "text/markdown",
          },
          conditions: [
            {
              displayName: "Cloud Run 5xx error rate > 0",
              conditionThreshold: {
                filter:
                  'resource.type = "cloud_run_revision" AND metric.type = "run.googleapis.com/request_count" AND metric.labels.response_code_class = "5xx"',
                aggregations: [
                  {
                    alignmentPeriod: "60s",
                    perSeriesAligner: "ALIGN_RATE",
                  },
                ],
                comparison: "COMPARISON_GT",
                thresholdValue: 0.01,
                duration: "60s",
                trigger: {
                  count: 1,
                },
              },
            },
          ],
          combiner: "OR",
          enabled: true,
          notificationChannels: channelNames,
        }),
      }
    );
    run5xxPolicy = (await createPolicyRes.json()) as GCPAlertPolicy;
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Created Alert Policy: ${run5xxPolicy.name}`);
  } else {
    console.log(`\x1b[32m[GCP Wire]\x1b[0m Found existing Alert Policy: ${run5xxPolicy.name}`);
  }

  return {
    channels: [n8nChannel, directChannel],
    policy: run5xxPolicy,
  };
}

/**
 * Inspect and wire Cloudflare notifications & health check webhooks.
 */
export async function wireCloudflareNotifications(): Promise<any> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !token) {
    console.log(`[Cloudflare Wire] Skipping: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not configured.`);
    return null;
  }

  console.log(`\x1b[36m[Cloudflare Wire]\x1b[0m Inspecting Cloudflare alert webhooks...`);

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/alerting/v3/destinations/webhooks`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = (await res.json()) as any;
    console.log(`\x1b[32m[Cloudflare Wire]\x1b[0m Existing Destinations:`, data.result || data);
    return data;
  } catch (err: any) {
    console.warn(`[Cloudflare Wire] Failed to query Cloudflare destinations:`, err.message);
    return null;
  }
}

/**
 * CLI Entrypoint
 */
async function main() {
  console.log("=================================================");
  console.log("⚡ ShunopsAI Multi-Cloud Webhook Auto-Wiring Tool");
  console.log("=================================================\n");

  try {
    const gcp = await wireGcpMonitoring();
    console.log("\n✅ GCP Cloud Monitoring Wiring Complete:");
    console.log("  - Channels:", gcp.channels.map((c) => `${c.displayName} -> ${c.name}`).join("\n  - "));
    console.log(`  - Policy: ${gcp.policy?.displayName} -> ${gcp.policy?.name}`);
  } catch (err: any) {
    console.error("❌ GCP Wiring Error:", err.message);
  }

  try {
    await wireCloudflareNotifications();
  } catch (err: any) {
    console.error("❌ Cloudflare Wiring Error:", err.message);
  }

  console.log("\n=================================================");
  console.log("📡 Active Webhook Endpoints for Cloud Monitors:");
  console.log(`1. n8n Orchestrator Webhook:`);
  console.log(`   POST ${N8N_WEBHOOK_URL}`);
  console.log(`2. ShunopsAI Direct Sentinel Webhook:`);
  console.log(`   POST ${SHUNOPS_DIRECT_URL}`);
  console.log("=================================================");
}

if (process.argv[1]?.endsWith("wire-cloud-webhooks.ts")) {
  main().catch(console.error);
}
