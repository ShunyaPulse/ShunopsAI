import { Redis } from "ioredis";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface AutonomyStatus {
  paused: boolean;
  pausedAt?: string | undefined;
  pausedBy?: string | undefined;
  reason?: string | undefined;
  pm2Status?: string | undefined;
}

const REDIS_KEY = "shunops:autonomy:paused";
const LOCAL_STATE_FILE = path.resolve(process.cwd(), ".autonomy-paused.json");

// In-memory cache with 3-second TTL for ultra-fast checks
let memoryCache: { status: AutonomyStatus; expiresAt: number } | null = null;

function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;

  if (!redisUrl && !redisHost) return null;

  try {
    return redisUrl
      ? new Redis(redisUrl, {
          connectTimeout: 4000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        })
      : new Redis({
          host: redisHost || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 4000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
  } catch {
    return null;
  }
}

/**
 * Reads local fallback state file synchronously or asynchronously
 */
function readLocalState(): AutonomyStatus {
  try {
    if (fsSync.existsSync(LOCAL_STATE_FILE)) {
      const raw = fsSync.readFileSync(LOCAL_STATE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return { paused: false };
}

/**
 * Check if all background automatic and AI-driven operations are currently paused.
 */
export async function isAutonomyPaused(): Promise<boolean> {
  const status = await getAutonomyStatus();
  return status.paused;
}

/**
 * Fetch full autonomy status (checking in-memory, OCI Redis, and local file fallback).
 */
export async function getAutonomyStatus(): Promise<AutonomyStatus> {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.status;
  }

  // 1. Try Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      const raw = await redis.get(REDIS_KEY);
      await redis.quit();

      if (raw) {
        const parsed: AutonomyStatus = JSON.parse(raw);
        memoryCache = { status: parsed, expiresAt: now + 4000 };
        return parsed;
      }
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  // 2. Fallback to local state file
  const local = readLocalState();
  memoryCache = { status: local, expiresAt: now + 4000 };
  return local;
}

/**
 * Toggle or set the master Autonomy Killswitch.
 * When paused, all scheduled crons, autonomous repo healing, and background AI calls abort immediately.
 */
export async function setAutonomyPaused(
  paused: boolean,
  pausedBy = "dashboard_user",
  reason = "User triggered master pause killswitch"
): Promise<AutonomyStatus> {
  const status: AutonomyStatus = {
    paused,
    pausedAt: paused ? new Date().toISOString() : undefined,
    pausedBy: paused ? pausedBy : undefined,
    reason: paused ? reason : undefined,
  };

  // Manage PM2 daily-autopilot process if available
  let pm2Message = "";
  try {
    if (paused) {
      execFileSync("pm2", ["stop", "daily-autopilot"], { stdio: "ignore" });
      pm2Message = "PM2 daily-autopilot stopped.";
    } else {
      execFileSync("pm2", ["restart", "daily-autopilot"], { stdio: "ignore" });
      pm2Message = "PM2 daily-autopilot resumed.";
    }
  } catch {
    // PM2 may not be running locally in dev, ignore gracefully
    pm2Message = "PM2 process managed via state guardrail.";
  }
  status.pm2Status = pm2Message;

  // 1. Update local file
  try {
    await fs.writeFile(LOCAL_STATE_FILE, JSON.stringify(status, null, 2), "utf-8");
  } catch (err: any) {
    console.warn(`[AutonomyState] Could not write local state file: ${err.message}`);
  }

  // 2. Update OCI Redis for distributed runners & GitHub Actions
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      if (paused) {
        await redis.set(REDIS_KEY, JSON.stringify(status));
      } else {
        await redis.del(REDIS_KEY);
      }
      await redis.quit();
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  // Clear memory cache so all subsequent calls reflect the new status
  memoryCache = { status, expiresAt: Date.now() + 4000 };
  return status;
}
