import { neon } from "@neondatabase/serverless";
import { Redis } from "ioredis";
import * as os from "node:os";
import { errorMessage } from "../../core/errors.js";
import { pingCloudflareAi } from "../cloudflare-ai.js";
import { inspectWebsite, manageComputeEngine } from "../cloud.js";
import { manageKaggle } from "../video.js";
import { getYouTubeAccessToken } from "../youtube.js";
import type { ServiceHealthReport } from "./types.js";

/**
 * Read-only health probes, one per service. Each probe resolves to a report and
 * never throws; `probe()` in ./scan.ts is the last line of defence for the ones
 * that could still reject.
 */

export async function checkNeonHealth(
  connectionUrl?: string,
  label = "Neon Postgres"
): Promise<ServiceHealthReport> {
  const dbUrl =
    connectionUrl ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.SARALGATI_DATABASE_URL;

  const now = new Date().toISOString();

  if (!dbUrl) {
    return {
      service: label,
      category: "database",
      status: "unconfigured",
      error: "DATABASE_URL not configured",
      lastChecked: now,
    };
  }

  const start = Date.now();
  try {
    const sql = neon(dbUrl);
    const rows = (await (sql as any).query(
      "SELECT 1 as ping, current_database() as db_name, version() as version"
    )) as any[];
    const latencyMs = Date.now() - start;

    return {
      service: label,
      category: "database",
      status: "healthy",
      latencyMs,
      details: {
        database: rows[0]?.db_name || "connected",
        version: (rows[0]?.version || "").split(" ")[0] || "PostgreSQL",
      },
      lastChecked: now,
    };
  } catch (err) {
    return {
      service: label,
      category: "database",
      status: "down",
      latencyMs: Date.now() - start,
      error: errorMessage(err),
      lastChecked: now,
    };
  }
}

export async function checkRedisHealth(): Promise<ServiceHealthReport> {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  const now = new Date().toISOString();

  if (!redisUrl && !redisHost) {
    return {
      service: "OCI Redis",
      category: "cache",
      status: "unconfigured",
      error: "REDIS_URL or REDIS_HOST not configured in .env",
      lastChecked: now,
    };
  }

  const start = Date.now();
  let client: Redis | null = null;
  try {
    client = redisUrl
      ? new Redis(redisUrl, { connectTimeout: 6000, maxRetriesPerRequest: 1 })
      : new Redis({
          host: redisHost || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 6000,
          maxRetriesPerRequest: 1,
        });

    const pingRes = await client.ping();
    const info = await client.info("memory");
    const latencyMs = Date.now() - start;

    const usedMemMatch = info.match(/used_memory_human:([^\r\n]+)/);
    const usedMemory = usedMemMatch ? usedMemMatch[1]?.trim() : "unknown";

    await client.quit();

    return {
      service: "OCI Redis",
      category: "cache",
      status: pingRes === "PONG" ? "healthy" : "degraded",
      latencyMs,
      details: {
        ping: pingRes,
        usedMemory,
        host: redisHost || "cloud-instance",
      },
      lastChecked: now,
    };
  } catch (err) {
    if (client) {
      try {
        client.disconnect();
      } catch (_) {}
    }
    return {
      service: "OCI Redis",
      category: "cache",
      status: "down",
      latencyMs: Date.now() - start,
      error: errorMessage(err),
      lastChecked: now,
    };
  }
}

export async function checkCloudflareAiHealth(): Promise<ServiceHealthReport> {
  const now = new Date().toISOString();
  const probe = await pingCloudflareAi();

  if (probe.error && probe.error.includes("Missing")) {
    return {
      service: "Cloudflare Workers AI",
      category: "ai",
      status: "unconfigured",
      error: probe.error,
      lastChecked: now,
    };
  }

  return {
    service: "Cloudflare Workers AI",
    category: "ai",
    status: probe.ok ? "healthy" : "down",
    latencyMs: probe.latencyMs,
    details: { model: probe.model },
    error: probe.error,
    lastChecked: now,
  };
}

export async function checkAppHealth(appUrl: string, label: string): Promise<ServiceHealthReport> {
  const now = new Date().toISOString();
  if (!appUrl) {
    return {
      service: label,
      category: "web",
      status: "unconfigured",
      error: `URL not configured for ${label}`,
      lastChecked: now,
    };
  }

  const raw = await inspectWebsite(appUrl);
  try {
    const parsed = JSON.parse(raw);
    const isOk = parsed.status >= 200 && parsed.status < 400;

    return {
      service: label,
      category: "web",
      status: isOk ? "healthy" : "degraded",
      latencyMs: parsed.latencyMs,
      details: {
        url: appUrl,
        statusCode: parsed.status,
        statusText: parsed.statusText,
      },
      error: isOk ? undefined : `HTTP Status ${parsed.status} ${parsed.statusText}`,
      lastChecked: now,
    };
  } catch {
    return {
      service: label,
      category: "web",
      status: "down",
      details: { url: appUrl },
      error: raw,
      lastChecked: now,
    };
  }
}

export async function checkKaggleHealth(): Promise<ServiceHealthReport> {
  const now = new Date().toISOString();
  const hasCreds = Boolean(
    process.env.KAGGLE_USERNAME &&
      (process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN || process.env.VIDEO_TOKEN)
  );

  if (!hasCreds) {
    return {
      service: "Kaggle GPU Pipeline",
      category: "pipeline",
      status: "unconfigured",
      error: "KAGGLE_USERNAME or KAGGLE_KEY not found in .env",
      lastChecked: now,
    };
  }

  const start = Date.now();

  try {
    const listResult = await manageKaggle("list");
    const latencyMs = Date.now() - start;

    // manageKaggle reports failures as text instead of throwing. Any CLI error
    // (missing binary, bad credentials, quota) means the pipeline is unusable,
    // so it must never be scored as healthy.
    if (/Kaggle CLI Error/i.test(listResult)) {
      return {
        service: "Kaggle GPU Pipeline",
        category: "pipeline",
        status: listResult.includes("ENOENT") ? "down" : "degraded",
        latencyMs,
        error: listResult.slice(0, 200),
        lastChecked: now,
      };
    }

    const lines = listResult.trim().split("\n").filter(Boolean);

    // Deep kernel inspection: check whether the latest video-render kernel failed.
    let latestFailedKernel: string | null = null;
    let latestFailedStatus = "";
    const topKernelMatch = listResult.match(/([a-z0-9_-]{3,50}\/video-render-[a-z0-9]{4,32})/);
    if (topKernelMatch && topKernelMatch[1]) {
      const topKernel = topKernelMatch[1];
      try {
        const statusStr = await manageKaggle("status", topKernel);
        if (/error|failed/i.test(statusStr)) {
          latestFailedKernel = topKernel;
          latestFailedStatus = statusStr.trim();
        }
      } catch {}
    }

    if (latestFailedKernel) {
      return {
        service: "Kaggle GPU Pipeline",
        category: "pipeline",
        status: "degraded",
        latencyMs,
        error: `Active video render kernel failed: ${latestFailedKernel} (${latestFailedStatus})`,
        details: {
          failedKernel: latestFailedKernel,
          status: latestFailedStatus,
          totalKernelsFound: Math.max(0, lines.length - 1),
        },
        lastChecked: now,
      };
    }

    return {
      service: "Kaggle GPU Pipeline",
      category: "pipeline",
      status: "healthy",
      latencyMs,
      details: {
        totalKernelsFound: Math.max(0, lines.length - 1),
        latestOutputPreview: lines.slice(0, 3).join(" | "),
      },
      lastChecked: now,
    };
  } catch (err) {
    return {
      service: "Kaggle GPU Pipeline",
      category: "pipeline",
      status: "down",
      latencyMs: Date.now() - start,
      error: errorMessage(err),
      lastChecked: now,
    };
  }
}

export async function checkYouTubeHealth(): Promise<ServiceHealthReport> {
  const now = new Date().toISOString();
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      service: "YouTube Publishing API",
      category: "pipeline",
      status: "unconfigured",
      error:
        "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, or YOUTUBE_REFRESH_TOKEN not configured in environment",
      lastChecked: now,
    };
  }

  const start = Date.now();
  try {
    const accessToken = await getYouTubeAccessToken();
    const latencyMs = Date.now() - start;

    return {
      service: "YouTube Publishing API",
      category: "pipeline",
      status: "healthy",
      latencyMs,
      details: {
        tokenStatus: "active",
        tokenObtained: Boolean(accessToken),
      },
      lastChecked: now,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isTokenExpired = /invalid_grant|expired|revoked/i.test(message);
    return {
      service: "YouTube Publishing API",
      category: "pipeline",
      status: isTokenExpired ? "down" : "degraded",
      latencyMs: Date.now() - start,
      error: isTokenExpired
        ? "YouTube OAuth Refresh Token expired or revoked (invalid_grant). Ensure Google OAuth Consent Screen is set to 'In Production' and re-authorize."
        : message || "YouTube API health check failed",
      details: {
        reauthRequired: isTokenExpired,
      },
      lastChecked: now,
    };
  }
}

export async function checkSystemHealth(): Promise<ServiceHealthReport> {
  const now = new Date().toISOString();
  const start = Date.now();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const details: Record<string, any> = {
    memoryUsagePercent: `${memUsagePct}%`,
    freeMemoryMb: Math.round(freeMem / 1024 / 1024),
    totalMemoryMb: Math.round(totalMem / 1024 / 1024),
    platform: `${os.platform()} (${os.arch()})`,
    uptimeMinutes: Math.round(os.uptime() / 60),
  };

  let probeOutput: string;
  try {
    probeOutput = await manageComputeEngine("metrics");
  } catch (err) {
    return {
      service: "Compute Host / OS",
      category: "compute",
      status: "down",
      error: errorMessage(err),
      lastChecked: now,
    };
  }

  // manageComputeEngine returns diagnostics (and errors) as text rather than
  // throwing, so a failed GCE SSH probe must be detected from the output —
  // otherwise this check would keep reporting "healthy" for an unreachable VM.
  const probeHead = probeOutput.split("\n")[0]?.trim() ?? "";
  const gceProbeFailed = /^GCE SSH Error/i.test(probeHead);
  details.computeProbe = probeHead;

  return {
    service: "Compute Host / OS",
    category: "compute",
    status: gceProbeFailed || memUsagePct > 95 ? "degraded" : "healthy",
    latencyMs: Date.now() - start,
    details,
    error: gceProbeFailed ? probeHead : undefined,
    lastChecked: now,
  };
}
