import { Redis } from "ioredis";

let redisClient: Redis | null = null;
let redisInitialized = false;

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (redisInitialized) return null; // Already tried and failed or not configured

  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;

  if (!url && !host) {
    redisInitialized = true;
    return null;
  }

  try {
    redisClient = url
      ? new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 2500,
          enableOfflineQueue: false,
        })
      : new Redis({
          host: host || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 2500,
          enableOfflineQueue: false,
        });

    redisClient.on("error", (err) => {
      // Non-fatal warning; in-memory fallback will handle state
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[Redis Connection Warning]: ${err.message || "Redis unavailable"}`);
      }
    });

    redisClient.connect().catch(() => {});
  } catch (err: any) {
    redisClient = null;
  } finally {
    redisInitialized = true;
  }

  return redisClient;
}

export function isRedisConnected(): boolean {
  return redisClient !== null && redisClient.status === "ready";
}

export async function checkRedisHealth(): Promise<{ ok: boolean; status: string; latencyMs?: number; error?: string }> {
  const client = getRedisClient();
  if (!client) {
    return { ok: false, status: "disabled_or_not_configured" };
  }

  const start = Date.now();
  try {
    const res = await client.ping();
    const latencyMs = Date.now() - start;
    if (res === "PONG") {
      return { ok: true, status: "connected", latencyMs };
    }
    return { ok: false, status: "unexpected_ping_response" };
  } catch (err: any) {
    return { ok: false, status: "error", error: err.message || "Redis ping failed" };
  }
}
