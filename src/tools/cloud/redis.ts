import { Redis } from "ioredis";
import { isPrivateHost } from "./net.js";

// Cache one Redis client per connection URL: the server default plus one entry
// per user who connected their own instance, so tenants never share a client.
const redisClients = new Map<string, Redis>();

function getRedisInstance(connectionUrl?: string): Redis | null {
  const redisUrl = connectionUrl || process.env.REDIS_URL;
  if (!redisUrl && !process.env.REDIS_HOST) return null;

  const cacheKey = redisUrl || `${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`;
  const cached = redisClients.get(cacheKey);
  if (cached) return cached;

  try {
    const client = redisUrl
      ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 })
      : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 2,
        });
    redisClients.set(cacheKey, client);
    return client;
  } catch (err: any) {
    console.warn(`[Redis Init Warning]: ${err.message}`);
    return null;
  }
}

/**
 * Only data-access commands are permitted. Administrative / destructive
 * commands (CONFIG, EVAL, SCRIPT, FLUSHALL, SHUTDOWN, ...) are rejected so
 * model- or user-supplied input cannot reconfigure or wipe the instance.
 */
const ALLOWED_REDIS_COMMANDS = new Set<string>([
  "PING", "ECHO", "GET", "SET", "SETEX", "SETNX", "GETSET", "APPEND", "STRLEN",
  "MGET", "MSET", "DEL", "UNLINK", "EXISTS", "TYPE", "TTL", "PTTL", "EXPIRE",
  "PEXPIRE", "PERSIST", "KEYS", "SCAN", "INCR", "DECR", "INCRBY", "DECRBY",
  "HSET", "HGET", "HGETALL", "HDEL", "HEXISTS", "HKEYS", "HVALS", "HLEN", "HINCRBY",
  "LPUSH", "RPUSH", "LPOP", "RPOP", "LRANGE", "LLEN", "LINDEX", "SADD", "SREM",
  "SMEMBERS", "SISMEMBER", "SCARD", "ZADD", "ZREM", "ZRANGE", "ZRANGEBYSCORE",
  "ZCARD", "ZSCORE", "DBSIZE", "INFO", "MEMORY", "COMMAND",
]);

/** Run a permitted command over Upstash REST or a direct Redis connection. */
export async function executeRedisCommand(
  command: string,
  args: string[] = [],
  /** Per-user Redis URL or Upstash REST credentials. When present it is the ONLY instance touched. */
  opts: { url?: string | undefined; upstash?: { url: string; token: string } | undefined } = {}
): Promise<string> {
  const normalizedCommand = command.trim().toUpperCase();
  if (!ALLOWED_REDIS_COMMANDS.has(normalizedCommand)) {
    return `Error: Redis command '${command}' is not permitted. Allowed commands: ${[...ALLOWED_REDIS_COMMANDS].join(", ")}.`;
  }

  const fullCmd = `${command} ${args.join(" ")}`.trim();

  // Upstash Serverless Redis over HTTPS REST API
  const upstashUrl = opts.upstash?.url || (!opts.url && process.env.UPSTASH_REDIS_REST_URL);
  const upstashToken = opts.upstash?.token || (!opts.url && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl && upstashToken) {
    try {
      const parsed = new URL(upstashUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return `Upstash Redis Error: only HTTP(S) REST URLs are supported.`;
      }
      if (isPrivateHost(parsed.hostname)) {
        return `Upstash Redis Error: requests to internal or private network addresses are blocked.`;
      }
      const res = await fetch(parsed.toString(), {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([normalizedCommand, ...args]),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || data?.error) {
        return `Upstash Redis Error (${res.status}): ${data?.error || res.statusText}`;
      }
      return `Redis Result for '${fullCmd}':\n${JSON.stringify(data?.result ?? data, null, 2)}`;
    } catch (err: any) {
      return `Upstash Redis Error: ${err.message}`;
    }
  }

  const redis = getRedisInstance(opts.url);
  if (!redis) {
    return "Error: REDIS_URL or REDIS_HOST is not set in .env. Please configure your OCI Redis connection.";
  }

  try {
    if (redis.status === "wait" || redis.status === "close") {
      await redis.connect();
    }
    const result = await redis.call(normalizedCommand, ...args);
    return `Redis Result for '${fullCmd}':\n${JSON.stringify(result, null, 2)}`;
  } catch (error: any) {
    return `Redis Error: ${error.message}`;
  }
}
