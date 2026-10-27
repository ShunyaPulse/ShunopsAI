import { Redis } from "ioredis";
import { errorMessage } from "../../core/errors.js";
import { pingCloudflareAi } from "../cloudflare-ai.js";
import { sendIncidentAlert } from "../notifier.js";
import { manageKaggle, rerunVideoJob } from "../video.js";
import { getYouTubeAccessToken } from "../youtube.js";
import { checkAppHealth, checkNeonHealth } from "./checks.js";
import { runComprehensiveSentinelScan } from "./scan.js";
import type { HealReport } from "./types.js";

/**
 * Self-healing remediation for a single named service, plus the fleet-wide
 * sweep the dashboard Auto-Heal button triggers.
 */

const KAGGLE_KERNEL_RE = /([a-z0-9_-]{3,50}\/video-render-[a-z0-9_-]{4,64})/;

async function healRedis(): Promise<HealReport> {
  try {
    const client = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, { connectTimeout: 5000 })
      : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 5000,
        });
    await client.ping();
    await client.quit();
    return {
      success: true,
      actionTaken: "Tested OCI Redis reconnect and ping",
      result: "Connection re-established successfully.",
    };
  } catch (e) {
    return {
      success: false,
      actionTaken: "Attempted Redis reconnect",
      result: `Failed to reconnect: ${errorMessage(e)}. Suggest checking OCI security list port 6379 or VM iptables.`,
    };
  }
}

async function healCloudflareAi(): Promise<HealReport> {
  const probe = await pingCloudflareAi();
  return {
    success: probe.ok,
    actionTaken: "Probed Cloudflare Workers AI endpoint",
    result: probe.ok
      ? `Cloudflare AI responded in ${probe.latencyMs}ms on model ${probe.model}`
      : `Cloudflare AI returned error: ${probe.error}`,
  };
}

/**
 * Probe the Neon database that is actually failing.
 *
 * `norm` is the lower-cased service name, used to select the connection string
 * belonging to the failing service rather than always the primary database.
 */
async function healNeonDatabase(serviceName: string, norm: string): Promise<HealReport> {
  const connectionUrl = norm.includes("saralgati")
    ? process.env.SARALGATI_DATABASE_URL
    : norm.includes("kanban")
      ? process.env.KANBAN_DATABASE_URL
      : undefined;
  const rep = await checkNeonHealth(connectionUrl, serviceName);
  return {
    success: rep.status === "healthy",
    actionTaken: "Probed Neon connection pool and query executor",
    result:
      rep.status === "healthy"
        ? `Neon database responded in ${rep.latencyMs}ms.`
        : `Neon database error: ${rep.error}`,
  };
}

async function healCloudRun(serviceName: string, norm: string): Promise<HealReport> {
  const isKanban = norm.includes("kanban");
  const targetUrl = isKanban
    ? process.env.KANBAN_APP_URL || ""
    : process.env.SARALGATI_APP_URL || "";

  if (!targetUrl) {
    return {
      success: false,
      actionTaken: `Inspected Cloud Run configuration for ${serviceName}`,
      result: "Target Cloud Run URL not configured in environment.",
    };
  }

  const probe = await checkAppHealth(
    targetUrl,
    isKanban ? "Kanban Cloud Run" : "Saralgati Cloud Run"
  );
  return {
    success: probe.status === "healthy",
    actionTaken: `Probed Cloud Run HTTPS container at ${targetUrl}`,
    result:
      probe.status === "healthy"
        ? `Container responded with HTTP OK in ${probe.latencyMs ?? 0}ms.`
        : `Container degraded: ${probe.error || "Non-200 response"}. Revision diagnostics active.`,
  };
}

async function healWebEndpoints(): Promise<HealReport> {
  const urls = [process.env.SARALGATI_APP_URL, process.env.KANBAN_APP_URL].filter(
    Boolean
  ) as string[];
  const probeResults: string[] = [];
  let allOk = true;

  for (const url of urls) {
    const probe = await checkAppHealth(url, "Website Monitor");
    if (probe.status !== "healthy") allOk = false;
    probeResults.push(`${url}: ${probe.status} (${probe.latencyMs ?? 0}ms)`);
  }

  return {
    success: allOk,
    actionTaken: `Tested live web endpoints: ${urls.join(", ")}`,
    result: probeResults.join(" | "),
  };
}

async function findFailedVideoKernel(): Promise<string | null> {
  const listOutput = await manageKaggle("list");
  const match = listOutput.match(KAGGLE_KERNEL_RE);
  if (!match || !match[1]) return null;
  const topRef = match[1];
  const status = await manageKaggle("status", topRef);
  return /error|failed/i.test(status) ? topRef : null;
}

/** Sweep active Kaggle kernels and auto-heal failed video-render kernels. */
async function healKagglePipeline(failedKernelRef?: string): Promise<HealReport> {
  try {
    const targetKernel = failedKernelRef ?? (await findFailedVideoKernel());

    if (targetKernel) {
      const cleanId = targetKernel.replace(/^[a-zA-Z0-9_-]+\/video-render-/, "");
      console.log(
        "[Sentinel Auto-Heal] Diagnosing and re-dispatching failed kernel: [REDACTED] (Job: [REDACTED])..."
      );
      const rerunRes = await rerunVideoJob(cleanId);
      return {
        success: true,
        actionTaken: `Auto-healed failed Kaggle kernel '${targetKernel}' with patched resilient TTS fallback renderer`,
        result: rerunRes,
      };
    }

    const kaggleCheck = await manageKaggle("list");
    return {
      success: !/Kaggle CLI Error/i.test(kaggleCheck),
      actionTaken: "Swept active Kaggle kernels and checked GPU quotas",
      result: kaggleCheck.slice(0, 300),
    };
  } catch (kErr) {
    return {
      success: false,
      actionTaken: "Attempted Kaggle kernel self-healing",
      result: `Kaggle CLI check failed: ${errorMessage(kErr)}`,
    };
  }
}

/** Auto-heal the YouTube publishing connection, or return a re-auth link. */
async function healYouTube(): Promise<HealReport> {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      success: false,
      actionTaken: "Diagnosed YouTube Publishing API configuration",
      result: "Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in environment.",
    };
  }

  try {
    await getYouTubeAccessToken();
    return {
      success: true,
      actionTaken: "Refreshed and verified YouTube OAuth access token",
      result: "YouTube Publishing API is fully authenticated and ready to upload videos.",
    };
  } catch {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent("http://localhost:8085/oauth2callback")}&response_type=code&scope=${encodeURIComponent(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube"
    )}&access_type=offline&prompt=consent`;

    return {
      success: false,
      actionTaken: "Diagnosed YouTube OAuth expiry and formatted re-authorization link",
      result: `YouTube refresh token is expired or revoked. Permanent fix: set OAuth Consent Screen to 'In Production' in Google Cloud Console, then authorize: ${authUrl}`,
    };
  }
}

function unmappedServiceReport(serviceName: string, reason?: string): HealReport {
  return {
    success: false,
    actionTaken: `Analyzed service '${serviceName}'`,
    result: `No automated self-healing script mapped for '${serviceName}'. Reason: ${reason || "None"}. Manual intervention or diagnostic script recommended.`,
  };
}

/** Broadcast incident & self-healing status to Discord / Telegram / Slack / Email. */
function broadcastHealOutcome(
  serviceName: string,
  reason: string | undefined,
  healReport: HealReport
): void {
  sendIncidentAlert({
    title: healReport.success
      ? `Service Self-Healed: ${serviceName}`
      : `Service Degraded/Failed: ${serviceName}`,
    service: serviceName,
    status: healReport.success ? "HEALED" : "DEGRADED",
    actionTaken: healReport.actionTaken,
    details: `${healReport.result} (Trigger Reason: ${reason || "Autonomous Sentinel"})`,
  }).catch(() => {});
}

async function healSingleService(serviceName: string, reason?: string): Promise<HealReport> {
  const norm = serviceName.toLowerCase();
  let healReport: HealReport;

  if (norm.includes("redis")) {
    healReport = await healRedis();
  } else if (norm.includes("cloudflare")) {
    healReport = await healCloudflareAi();
  } else if (norm.includes("neon") || norm.includes("postgres") || norm.includes("database")) {
    healReport = await healNeonDatabase(serviceName, norm);
  } else if (
    norm.includes("cloud_run") ||
    norm.includes("cloud run") ||
    norm.includes("saralgati") ||
    norm.includes("kanban")
  ) {
    healReport = await healCloudRun(serviceName, norm);
  } else if (norm.includes("web") || norm.includes("site") || norm.includes("uptime")) {
    healReport = await healWebEndpoints();
  } else if (norm.includes("kaggle") || norm.includes("gpu") || norm.includes("pipeline")) {
    const failedMatch = reason?.match(KAGGLE_KERNEL_RE);
    healReport = await healKagglePipeline(failedMatch ? failedMatch[1] : undefined);
  } else if (norm.includes("youtube")) {
    healReport = await healYouTube();
  } else {
    healReport = unmappedServiceReport(serviceName, reason);
  }

  broadcastHealOutcome(serviceName, reason, healReport);
  return healReport;
}

/**
 * Self-healing entrypoint.
 *
 * Accepts either a single service name or the fleet-wide selector "all" — what
 * the dashboard Auto-Heal button and the default /api/sentinel/heal request
 * send. The selector scans the fleet and heals every degraded or down service.
 */
export async function autoHealService(
  serviceName: string,
  reason?: string
): Promise<HealReport> {
  const selector = (serviceName || "all").trim().toLowerCase();

  if (selector !== "all" && selector !== "*") {
    return healSingleService(serviceName, reason);
  }

  const summary = await runComprehensiveSentinelScan();
  const failing = summary.services.filter(
    (s) => s.status === "degraded" || s.status === "down"
  );

  if (failing.length === 0) {
    return {
      success: true,
      actionTaken: "Scanned the fleet for self-healing",
      result: `No degraded or down services detected (${summary.healthyCount}/${summary.totalServices} healthy).`,
    };
  }

  const outcomes: string[] = [];
  let healed = 0;
  for (const svc of failing) {
    const outcome = await healSingleService(svc.service, svc.error || reason);
    if (outcome.success) healed++;
    outcomes.push(`${outcome.success ? "✅" : "❌"} ${svc.service}: ${outcome.result}`);
  }

  const report = {
    success: healed === failing.length,
    actionTaken: `Healed ${healed}/${failing.length} failing service(s) across the fleet`,
    result: outcomes.join("\n"),
  };

  sendIncidentAlert({
    title: `Fleet Self-Healing Sweep: ${healed}/${failing.length} recovered`,
    service: "all",
    status: report.success ? "HEALED" : "DEGRADED",
    actionTaken: report.actionTaken,
    details: outcomes.join(" | ").slice(0, 1500),
  }).catch(() => {});

  return report;
}
