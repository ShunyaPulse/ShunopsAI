import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Redis } from "ioredis";
import type { RepoAuditState } from "./types.js";

// ==========================================
// Audit state persistence (Redis + local file)
// ==========================================

export const AUDIT_STATE_FILE = path.resolve(process.cwd(), ".auditor-state.json");
const AUDIT_STATE_TTL_SECONDS = 60 * 60 * 24 * 30;

function getAuditorRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  if (!redisUrl && !redisHost) return null;
  try {
    return redisUrl
      ? new Redis(redisUrl, { connectTimeout: 3000, lazyConnect: true, maxRetriesPerRequest: 1 })
      : new Redis({
          host: redisHost || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 3000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
  } catch {
    return null;
  }
}

/** Read a repo's audit state from Redis, or `null` when unavailable. */
async function readAuditorStateFromRedis(repoSlug: string): Promise<RepoAuditState | null> {
  const redis = getAuditorRedis();
  if (!redis) return null;
  try {
    await redis.connect();
    const raw = await redis.get(`shunops:auditor:state:${repoSlug}`);
    await redis.quit();
    if (raw) return JSON.parse(raw);
  } catch {
    try {
      redis.disconnect();
    } catch {}
  }
  return null;
}

/** Persist a repo's audit state to Redis; best-effort only. */
async function writeAuditorStateToRedis(repoSlug: string, state: RepoAuditState): Promise<void> {
  const redis = getAuditorRedis();
  if (!redis) return;
  try {
    await redis.connect();
    await redis.set(
      `shunops:auditor:state:${repoSlug}`,
      JSON.stringify(state),
      "EX",
      AUDIT_STATE_TTL_SECONDS
    );
    await redis.quit();
  } catch {
    try {
      redis.disconnect();
    } catch {}
  }
}

/** Read the local audit-state file; an unreadable file yields an empty map. */
async function readAuditorStateFile(): Promise<Record<string, RepoAuditState>> {
  try {
    const raw = await fs.readFile(AUDIT_STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getAuditorState(repoSlug: string): Promise<RepoAuditState | null> {
  const fromRedis = await readAuditorStateFromRedis(repoSlug);
  if (fromRedis) return fromRedis;

  const data = await readAuditorStateFile();
  return data[repoSlug] || null;
}

export async function saveAuditorState(repoSlug: string, state: RepoAuditState): Promise<void> {
  await writeAuditorStateToRedis(repoSlug, state);

  try {
    const data = await readAuditorStateFile();
    data[repoSlug] = state;
    await fs.writeFile(AUDIT_STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}
