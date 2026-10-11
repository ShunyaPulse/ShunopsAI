import { Redis } from "ioredis";

// Lazy connection to distributed OCI Redis
let redisInstance: Redis | null = null;
let redisHealthy = true;

function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl && !process.env.REDIS_HOST) return null;

  if (!redisInstance) {
    try {
      redisInstance = redisUrl
        ? new Redis(redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
          })
        : new Redis({
            host: process.env.REDIS_HOST || "127.0.0.1",
            port: Number(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
          });

      redisInstance.on("error", () => {
        redisHealthy = false;
      });
      redisInstance.on("connect", () => {
        redisHealthy = true;
      });
    } catch {
      redisHealthy = false;
      return null;
    }
  }
  return redisHealthy ? redisInstance : null;
}

// In-memory sliding window fallback if Redis is unavailable
interface MemoryBucket {
  count: number;
  resetAt: number;
}
const memoryBuckets = new Map<string, MemoryBucket>();

/**
 * Extracts Client IP behind Google Cloud Run, Cloudflare, or local proxies.
 */
export function getClientIp(req: { ip?: string; headers: Record<string, any> }): string {
  // If behind Cloudflare, CF-Connecting-IP is set by the edge and cannot be forged by the client.
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  // On Google Cloud Run or reverse proxies that append client IPs to X-Forwarded-For:
  // Taking the first entry allows spoofing (client sets "X-Forwarded-For: fake-ip").
  // Taking the last entry represents the peer IP as seen by the closest upstream proxy.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      // Return the most reliable hop (last entry appended by edge proxy)
      return lastPart;
    }
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  return req.ip || "unknown";
}

/**
 * Extracts the Subnet / Prefix of the IP (Kanban-Cloud Anti-Rotation Invariant).
 * IPv4: /24 subnet (e.g., 112.79.12.0)
 * IPv6: /48 prefix (e.g., 2402:3a80:159::)
 * Neutralizes dynamic IP rotation (such as mobile airplane mode toggles).
 */
export function getClientSubnet(ip: string): string {
  if (!ip || ip === "unknown" || ip === "127.0.0.1" || ip === "::1") return ip;

  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + "::/48";
  } else if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.slice(0, 3).join(".") + ".0/24";
  }
  return ip;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Distributed Redis Token Bucket with In-Memory fallback.
 */
export async function checkDistributedSubnetQuota(
  subnetKey: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitCheckResult> {
  const redis = getRedis();

  if (redis && redisHealthy) {
    try {
      const key = `ratelimit:subnet:${subnetKey}`;
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }
      const ttl = await redis.ttl(key);

      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
        retryAfterSeconds: Math.max(0, ttl),
      };
    } catch {
      // Degrade gracefully to in-memory fallback
    }
  }

  // Fallback: Local memory sliding window
  const now = Date.now();
  const bucket = memoryBuckets.get(subnetKey);

  // Periodic cleanup
  if (memoryBuckets.size > 10_000) {
    for (const [k, b] of memoryBuckets.entries()) {
      if (b.resetAt <= now) memoryBuckets.delete(k);
    }
  }

  const windowMs = windowSeconds * 1000;
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(subnetKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}
