import { neon } from "@neondatabase/serverless";
import { Redis } from "ioredis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// Cache Redis instance
let redisClient: Redis | null = null;

function getRedisInstance(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl && !process.env.REDIS_HOST) return null;

  if (!redisClient) {
    try {
      redisClient = redisUrl
        ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 })
        : new Redis({
            host: process.env.REDIS_HOST || "127.0.0.1",
            port: Number(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            lazyConnect: true,
            maxRetriesPerRequest: 2,
          });
    } catch (err: any) {
      console.warn(`[Redis Init Warning]: ${err.message}`);
      return null;
    }
  }
  return redisClient;
}

/**
 * 1. Neon Postgres Query Tool (Uses HTTP fetch, no WebSockets required)
 */
export async function executeNeonSql(query: string): Promise<string> {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.SARALGATI_DATABASE_URL;
  if (!dbUrl) {
    return "Error: Neither DATABASE_URL nor NEON_DATABASE_URL is set in .env. Please configure your Postgres connection string.";
  }

  try {
    const sql = neon(dbUrl);
    const rows = await (sql as any).query(query);
    return `Neon SQL Result (${rows.length} rows):\n${JSON.stringify(rows, null, 2)}`;
  } catch (error: any) {
    return `Neon SQL Error: ${error.message}`;
  }
}

/**
 * 2. OCI Redis Tool
 *
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

export async function executeRedisCommand(command: string, args: string[] = []): Promise<string> {
  const normalizedCommand = command.trim().toUpperCase();
  if (!ALLOWED_REDIS_COMMANDS.has(normalizedCommand)) {
    return `Error: Redis command '${command}' is not permitted. Allowed commands: ${[...ALLOWED_REDIS_COMMANDS].join(", ")}.`;
  }

  const redis = getRedisInstance();
  if (!redis) {
    return "Error: REDIS_URL or REDIS_HOST is not set in .env. Please configure your OCI Redis connection.";
  }

  const fullCmd = `${command} ${args.join(" ")}`.trim();

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

/**
 * 3. GitHub Operations Tool (Issues, Pull Requests, Code Scanning Alerts, Branches)
 */
export async function manageGitHub(action: {
  operation: "list_issues" | "get_issue" | "create_issue" | "create_pr" | "list_prs" | "code_scanning_alerts" | "list_branches";
  repo?: string; // owner/repo
  issueNumber?: number;
  prNumber?: number;
  title?: string;
  body?: string;
  head?: string;
  base?: string;
}): Promise<string> {
  const token = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;

  // First try gh CLI if available locally (argv form — no shell interpolation)
  try {
    let argv: string[] | null = null;
    const repoArg = action.repo ? ["-R", action.repo] : [];

    switch (action.operation) {
      case "list_issues":
        argv = ["issue", "list", ...repoArg, "--limit", "10"];
        break;
      case "get_issue":
        argv = ["issue", "view", String(action.issueNumber ?? ""), ...repoArg];
        break;
      case "create_issue":
        argv = ["issue", "create", ...repoArg, "--title", action.title || "Bug", "--body", action.body || ""];
        break;
      case "list_prs":
        argv = ["pr", "list", ...repoArg, "--limit", "10"];
        break;
      case "create_pr":
        argv = ["pr", "create", ...repoArg, "--title", action.title || "Fix", "--body", action.body || "", "--base", action.base || "main", "--head", action.head || "HEAD"];
        break;
      case "code_scanning_alerts":
        argv = ["api", "-H", "Accept: application/vnd.github+json", `/repos/${action.repo || "{owner}/{repo}"}/code-scanning/alerts`];
        break;
      case "list_branches":
        argv = ["branch", "-a"];
        break;
    }

    if (argv) {
      const bin = action.operation === "list_branches" ? "git" : "gh";
      const { stdout, stderr } = await execFileAsync(bin, argv, {
        env: { ...process.env, GITHUB_TOKEN: token || process.env.GITHUB_TOKEN },
      });
      return stdout || stderr || `GitHub action '${action.operation}' completed.`;
    }
  } catch (cliErr: any) {
    // If gh CLI fails or is missing, try GitHub REST API if GITHUB_TOKEN and repo are provided
    if (token && action.repo) {
      try {
        const headers = {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "AA-Autonomous-Agent",
        };

        if (action.operation === "list_issues") {
          const res = await fetch(`https://api.github.com/repos/${action.repo}/issues?state=open`, { headers });
          const data = await res.json();
          return JSON.stringify(data, null, 2);
        }

        if (action.operation === "code_scanning_alerts") {
          const res = await fetch(`https://api.github.com/repos/${action.repo}/code-scanning/alerts`, { headers });
          const data = await res.json();
          return JSON.stringify(data, null, 2);
        }
      } catch (apiErr: any) {
        return `GitHub API Error: ${apiErr.message}`;
      }
    }

    return `GitHub Operation Error: ${cliErr.message}. (Ensure 'gh' CLI is installed or GITHUB_TOKEN is set in .env).`;
  }

  return "Unsupported GitHub operation.";
}

/**
 * 4. Google Cloud Run Management Tool
 */
export async function manageCloudRun(subcommand: string, args: string[] = []): Promise<string> {
  // No shell: pass argv directly so user-controlled values cannot inject commands.
  const argv = ["run", ...subcommand.split(/\s+/).filter(Boolean), ...args];
  try {
    const { stdout, stderr } = await execFileAsync("gcloud", argv, { timeout: 45000 });
    return stdout || stderr || "Cloud Run command executed.";
  } catch (err: any) {
    return `Cloud Run Command Error: ${err.message}\n${err.stderr || ""}`;
  }
}

/**
 * 5. Cloudflare Workers & AI Management Tool
 */
export async function manageCloudflare(command: string): Promise<string> {
  // No shell: pass argv directly so user-controlled values cannot inject commands.
  const argv = command.split(/\s+/).filter(Boolean);
  try {
    const { stdout, stderr } = await execFileAsync("wrangler", argv, { timeout: 45000 });
    return stdout || stderr || "Cloudflare command executed.";
  } catch (err: any) {
    return `Cloudflare Command Error: ${err.message}\n${err.stderr || ""}`;
  }
}

/**
 * 6. Website Inspection & Error Diagnostic Tool
 */
const BLOCKED_SSRF_HOSTS = new Set([
  "169.254.169.254", // AWS / Azure / GCP instance metadata
  "metadata.google.internal",
  "100.100.100.200", // Alibaba Cloud metadata
  "::ffff:169.254.169.254",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Returns true when the hostname resolves to a private / loopback / link-local IP. */
function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_SSRF_HOSTS.has(hostname.toLowerCase())) return true;
  // IPv4 private ranges (RFC 1918) + loopback + link-local
  if (/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|169\.254\.\d{1,3}\.\d{1,3})$/.test(hostname)) return true;
  return false;
}

export async function inspectWebsite(url: string): Promise<string> {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;

  // SSRF guard: the agent must never be steered to cloud metadata services
  // or internal network hosts.
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Website Inspection blocked: only http(s) URLs are permitted.`;
    }
    if (isPrivateHost(parsed.hostname)) {
      return `Website Inspection blocked: requests to internal or cloud metadata endpoints are not permitted.`;
    }
  } catch {
    return `Website Inspection Failed: the provided URL is not valid.`;
  }

  const start = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: { "User-Agent": "AutonomousAgent/1.0 (HealthCheck)" },
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    const bodyText = await res.text();
    const snippet = bodyText.slice(0, 400).replace(/\s+/g, " ");

    return JSON.stringify({
      url: targetUrl,
      status: res.status,
      statusText: res.statusText,
      latencyMs: latency,
      contentLength: bodyText.length,
      htmlPreview: snippet,
    }, null, 2);
  } catch (err: any) {
    const safeMsg = (err.message || "Unknown error").replace(/[\n\r]/g, " ").slice(0, 200);
    return `Website Inspection Failed: ${safeMsg}`;
  }
}

// ==========================================
// 7. GCP Compute Engine Diagnostics (over SSH)
// ==========================================

const SAFE_SSH_TOKEN = /^[A-Za-z0-9_.@:-]+$/;

/** Cross-platform local host diagnostics (no reliance on Linux-only binaries). */
async function localDiagnostics(action: "metrics" | "services" | "disk"): Promise<string> {
  if (action === "metrics") {
    const cpus = os.cpus();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(", ");
    const mb = (n: number) => Math.round(n / 1024 / 1024);
    return [
      `platform: ${os.platform()} ${os.arch()}`,
      `uptime:   ${Math.round(os.uptime() / 60)} min`,
      `cpu:      ${cpus.length}x ${cpus[0]?.model ?? "unknown"}`,
      `load avg: ${load}`,
      `memory:   ${mb(os.totalmem() - os.freemem())} MB used / ${mb(os.totalmem())} MB total`,
    ].join("\n");
  }

  if (action === "disk") {
    try {
      const st = await fs.promises.statfs(os.homedir());
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      return `disk (${os.homedir()}): ${gb(total - free)} GB used / ${gb(total)} GB total (${gb(free)} GB free)`;
    } catch (err: any) {
      return `Disk diagnostics unavailable: ${err.message}`;
    }
  }

  // services
  const results: string[] = [];
  for (const [label, bin, argv] of [
    ["pm2", "pm2", ["status"]],
    ["docker", "docker", ["ps", "--format", "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"]],
  ] as const) {
    try {
      const { stdout, stderr } = await execFileAsync(bin, [...argv], { timeout: 15000 });
      results.push(`--- ${label} ---\n${stdout || stderr || "(no output)"}`);
    } catch (err: any) {
      results.push(`--- ${label} ---\nnot available (${err.code === "ENOENT" ? "not installed" : err.message})`);
    }
  }
  return results.join("\n\n");
}

/** Expand a leading ~ and $HOME in a configured key path. */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p.replace(/^\$HOME/, os.homedir());
}

interface GceTarget {
  host: string;
  user: string;
  keyPath: string | undefined;
  port: string | undefined;
  zone: string | undefined;
  instance: string | undefined;
}

/** Resolve the GCE SSH target from environment, or null if not configured. */
function resolveGceTarget(): GceTarget | { error: string } {
  const host = process.env.GCE_SSH_HOST || process.env.GCE_EXTERNAL_IP || process.env.GCE_INTERNAL_IP || "";
  if (!host) return { error: "GCE target not configured (set GCE_SSH_HOST or GCE_EXTERNAL_IP)." };

  const user = process.env.GCE_USER || "";
  if (!user) return { error: "GCE_USER is not set." };

  // Reject anything that could be interpreted as an ssh flag or shell metachar.
  if (!SAFE_SSH_TOKEN.test(host)) return { error: `Unsafe GCE_SSH_HOST value.` };
  if (!/^[A-Za-z0-9_.-]+$/.test(user)) return { error: `Unsafe GCE_USER value.` };

  const port = process.env.GCE_SSH_PORT || "";
  if (port && !/^\d{1,5}$/.test(port)) return { error: `Unsafe GCE_SSH_PORT value.` };

  const rawKey = process.env.GCE_SSH_KEY || "";
  const keyPath = rawKey ? expandHome(rawKey) : undefined;
  if (keyPath && !fs.existsSync(keyPath)) {
    return { error: `GCE_SSH_KEY path does not exist: ${keyPath}` };
  }

  return {
    host,
    user,
    keyPath,
    port: port || undefined,
    zone: process.env.GCE_ZONE || undefined,
    instance: process.env.GCE_INSTANCE_NAME || undefined,
  };
}

/** Fixed, read-only remote commands per diagnostic action (no user input). */
function remoteCommandFor(action: "metrics" | "services" | "disk"): string {
  switch (action) {
    case "services":
      return "echo '--- pm2 ---'; (pm2 status 2>/dev/null || echo 'pm2 not installed'); " +
        "echo; echo '--- docker ---'; (docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'docker not available')";
    case "disk":
      return "df -h /";
    case "metrics":
    default:
      return "echo '--- uptime/load ---'; uptime; echo; echo '--- cpu count ---'; nproc 2>/dev/null || echo n/a; " +
        "echo; echo '--- memory (MB) ---'; free -m; echo; echo '--- top processes ---'; top -bn1 | head -n 12";
  }
}

/**
 * Run a read-only diagnostic command on the configured GCE VM over SSH.
 * Falls back to the LOCAL host only when GCE is unconfigured, and labels it clearly.
 */
export async function manageComputeEngine(action: "metrics" | "services" | "disk"): Promise<string> {
  const target = resolveGceTarget();

  if ("error" in target) {
    // Not configured: report the LOCAL host, clearly labelled, using cross-platform APIs.
    return `[LOCAL HOST — GCE not configured: ${target.error}]\n${await localDiagnostics(action)}`;
  }

  const sshArgs = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
  ];
  if (target.keyPath) sshArgs.push("-i", target.keyPath);
  if (target.port) sshArgs.push("-p", target.port);
  sshArgs.push(`${target.user}@${target.host}`, remoteCommandFor(action));

  const label = target.instance
    ? `${target.instance}${target.zone ? ` (${target.zone})` : ""}`
    : target.host;

  try {
    const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
      timeout: 45000,
      maxBuffer: 1024 * 1024 * 5,
    });
    return `[GCE VM: ${label}]\n${stdout || stderr || "(no output)"}`;
  } catch (err: any) {
    return `GCE SSH Error for ${label}: ${err.message}\n${err.stderr || ""}\n(Hint: verify GCE_SSH_KEY, GCE_USER and that the VM firewall allows SSH.)`;
  }
}

