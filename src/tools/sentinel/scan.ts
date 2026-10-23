import { errorMessage } from "../../core/errors.js";
import {
  checkAppHealth,
  checkCloudflareAiHealth,
  checkKaggleHealth,
  checkNeonHealth,
  checkRedisHealth,
  checkSystemHealth,
  checkYouTubeHealth,
} from "./checks.js";
import type { SentinelStatusSummary, ServiceHealthReport } from "./types.js";

/**
 * Run a single health probe, converting an unexpected throw into an explicit
 * `down` report. Without this, a crashing probe would silently disappear from
 * the summary and the fleet could still be reported as fully operational.
 */
async function probe(
  service: string,
  category: ServiceHealthReport["category"],
  run: () => Promise<ServiceHealthReport>
): Promise<ServiceHealthReport> {
  try {
    return await run();
  } catch (err) {
    return {
      service,
      category,
      status: "down",
      error: `Health probe threw: ${errorMessage(err)}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

function buildChecks(): Array<Promise<ServiceHealthReport>> {
  return [
    probe("Neon Primary DB", "database", () =>
      checkNeonHealth(process.env.DATABASE_URL, "Neon Primary DB")
    ),
    ...(process.env.SARALGATI_DATABASE_URL
      ? [
          probe("Neon Saralgati DB", "database", () =>
            checkNeonHealth(process.env.SARALGATI_DATABASE_URL, "Neon Saralgati DB")
          ),
        ]
      : []),
    ...(process.env.KANBAN_DATABASE_URL
      ? [
          probe("Neon Kanban DB", "database", () =>
            checkNeonHealth(process.env.KANBAN_DATABASE_URL, "Neon Kanban DB")
          ),
        ]
      : []),
    probe("OCI Redis", "cache", checkRedisHealth),
    probe("Cloudflare Workers AI", "ai", checkCloudflareAiHealth),
    probe("Saralgati Cloud Run App", "web", () =>
      checkAppHealth(process.env.SARALGATI_APP_URL || "", "Saralgati Cloud Run App")
    ),
    probe("Kanban Cloud Run App", "web", () =>
      checkAppHealth(process.env.KANBAN_APP_URL || "", "Kanban Cloud Run App")
    ),
    probe("Kaggle GPU Pipeline", "pipeline", checkKaggleHealth),
    probe("YouTube Publishing API", "pipeline", checkYouTubeHealth),
    probe("Compute Host / OS", "compute", checkSystemHealth),
  ];
}

function summarizeHealthReports(
  reports: ServiceHealthReport[],
  timestamp = new Date().toISOString()
): SentinelStatusSummary {
  const healthyCount = reports.filter((r) => r.status === "healthy").length;
  const degradedCount = reports.filter((r) => r.status === "degraded").length;
  const downCount = reports.filter((r) => r.status === "down").length;

  let overallStatus: SentinelStatusSummary["overallStatus"] = "all_systems_operational";
  if (downCount > 0) {
    overallStatus = "critical";
  } else if (degradedCount > 0) {
    overallStatus = "degraded";
  }

  return {
    timestamp,
    overallStatus,
    totalServices: reports.length,
    healthyCount,
    degradedCount,
    downCount,
    services: reports,
  };
}

/**
 * Master comprehensive sentinel scan: checks all registered cloud services
 * concurrently. Every entry is wrapped in `probe`, which never rejects, so a
 * failing check is always represented in the report instead of being dropped.
 */
export async function runComprehensiveSentinelScan(): Promise<SentinelStatusSummary> {
  const reports = await Promise.all(buildChecks());
  return summarizeHealthReports(reports);
}
