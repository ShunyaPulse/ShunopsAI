import { neon } from "@neondatabase/serverless";
import { Redis } from "ioredis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

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
 * 1. Neon / Supabase Postgres Query Tool (Uses HTTP fetch)
 */
export async function executeNeonSql(
  query: string,
  /** Per-user connection string. When present it is the ONLY database touched. */
  opts: { connectionString?: string } = {}
): Promise<string> {
  const dbUrl =
    opts.connectionString ||
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
 * 2. OCI Redis & Upstash Serverless REST Redis Tool
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

/**
 * 3. GitHub Operations Tool (Issues, Pull Requests, Code Scanning Alerts, Branches)
 */
export async function manageGitHub(action: {
  operation: "list_issues" | "get_issue" | "create_issue" | "create_pr" | "list_prs" | "code_scanning_alerts" | "list_branches" | "list_repos";
  repo?: string; // owner/repo
  issueNumber?: number;
  prNumber?: number;
  title?: string;
  body?: string;
  head?: string;
  base?: string;
},
  /** Per-user token. When present it is the ONLY identity used, never the operator's. */
  opts: { token?: string } = {}
): Promise<string> {
  const token = opts.token || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  let rawRepo = (action.repo || "").trim();
  let targetRepo = rawRepo;

  // When a token is available, execute directly via GitHub REST API (works in bare Docker, Cloud Run, and serverless without gh CLI or git)
  if (token) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ShunopsAI-Autonomous-Agent",
      };

      // Helper to dynamically get authenticated user's login username from their token
      const getAuthUsername = async (): Promise<string | null> => {
        try {
          const userRes = await fetch("https://api.github.com/user", { headers });
          if (userRes.ok) {
            const userData: any = await userRes.json();
            return userData?.login || null;
          }
        } catch {}
        return null;
      };

      // If repo does not include owner ("owner/repo"), dynamically resolve using the user's authenticated username
      if (rawRepo && !rawRepo.includes("/")) {
        const username = await getAuthUsername();
        targetRepo = username ? `${username}/${rawRepo}` : rawRepo;
      } else if (!rawRepo) {
        // If no repo provided at all, find the first accessible repository for this user
        try {
          const reposRes = await fetch("https://api.github.com/user/repos?per_page=1&sort=updated", { headers });
          if (reposRes.ok) {
            const reposData: any = await reposRes.json();
            if (Array.isArray(reposData) && reposData[0]?.full_name) {
              targetRepo = reposData[0].full_name;
            }
          }
        } catch {}
      }

      if (action.operation === "list_repos") {
        const username = await getAuthUsername();
        const reposRes = await fetch("https://api.github.com/user/repos?per_page=30&sort=updated", { headers });
        if (!reposRes.ok) {
          const errData = (await reposRes.json().catch(() => ({}))) as any;
          return `GitHub API Error (${reposRes.status}): ${errData?.message || reposRes.statusText}`;
        }
        const repos = (await reposRes.json()) as any[];
        const repoList = Array.isArray(repos)
          ? repos.map((r: any) => `• ${r.full_name} (${r.private ? "private" : "public"}, default branch: ${r.default_branch})`).join("\n")
          : "No repositories found.";
        return `Connected GitHub User: @${username || "user"}\nAccessible Repositories (${Array.isArray(repos) ? repos.length : 0}):\n${repoList}`;
      }

      if (action.operation === "list_branches") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/branches?per_page=30`, { headers });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText} for repo "${targetRepo}". Tip: Use operation "list_repos" to see all accessible repositories.`;
        }
        const data = (await res.json()) as any;
        const branchList = Array.isArray(data)
          ? data.map((b: any) => `• ${b.name} (${b.commit?.sha?.slice(0, 7) || "unknown"})`).join("\n")
          : "No branches found.";
        return `GitHub branches for ${targetRepo} (${Array.isArray(data) ? data.length : 0}):\n${branchList}`;
      }

      if (action.operation === "list_issues") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/issues?state=open&per_page=10`, { headers });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return Array.isArray(data)
          ? `Open issues in ${targetRepo} (${data.length}):\n` +
              data.map((i: any) => `#${i.number} [${i.title}] by @${i.user?.login || "unknown"}`).join("\n")
          : JSON.stringify(data, null, 2);
      }

      if (action.operation === "get_issue") {
        const issueNum = action.issueNumber;
        if (!issueNum) return "Error: issueNumber is required for get_issue.";
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/issues/${issueNum}`, { headers });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return `Issue #${data.number}: ${data.title}\nState: ${data.state}\nAuthor: @${data.user?.login}\n\n${data.body || "(No description)"}`;
      }

      if (action.operation === "create_issue") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/issues`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ title: action.title || "New Issue", body: action.body || "" }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return `Successfully created Issue #${data.number}: ${data.title} (${data.html_url})`;
      }

      if (action.operation === "list_prs") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/pulls?state=open&per_page=10`, { headers });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return Array.isArray(data)
          ? `Open PRs in ${targetRepo} (${data.length}):\n` +
              data.map((p: any) => `#${p.number} [${p.title}] (${p.head?.ref} -> ${p.base?.ref}) by @${p.user?.login || "unknown"}`).join("\n")
          : JSON.stringify(data, null, 2);
      }

      if (action.operation === "create_pr") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/pulls`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            title: action.title || "Fix",
            body: action.body || "",
            head: action.head || "HEAD",
            base: action.base || "main",
          }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return `Successfully created PR #${data.number}: ${data.title} (${data.html_url})`;
      }

      if (action.operation === "code_scanning_alerts") {
        const res = await fetch(`https://api.github.com/repos/${targetRepo}/code-scanning/alerts`, { headers });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          return `GitHub API Error (${res.status}): ${errData?.message || res.statusText}`;
        }
        const data = (await res.json()) as any;
        return JSON.stringify(data, null, 2);
      }
    } catch (apiErr: any) {
      return `GitHub REST API Error: ${apiErr.message}`;
    }
  }

  // Fallback to gh / git CLI if no token provided or on workstation with gh CLI
  try {
    let argv: string[] | null = null;
    const repoArg = targetRepo ? ["-R", targetRepo] : [];

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
        argv = ["api", "-H", "Accept: application/vnd.github+json", `/repos/${targetRepo}/code-scanning/alerts`];
        break;
      case "list_branches":
        argv = ["branch", "-a"];
        break;
    }

    if (argv) {
      const bin = action.operation === "list_branches" ? "git" : "gh";
      const { stdout, stderr } = await execFileAsync(bin, argv, {
        env: {
          ...process.env,
          GITHUB_TOKEN: token || process.env.GITHUB_TOKEN,
          ...(opts.token ? { GH_TOKEN: opts.token } : {}),
        },
      });
      return stdout || stderr || `GitHub action '${action.operation}' completed.`;
    }
  } catch (cliErr: any) {
    return `GitHub Operation Error: ${cliErr.message}. Ensure GitHub token is connected in Account Settings → Platform Connections.`;
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
  "metadata.platform",
  "100.100.100.200", // Alibaba Cloud metadata
  "::ffff:169.254.169.254",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Returns true when the hostname resolves to a private / loopback / link-local IP or internal domain. */
export function isPrivateHost(hostname: string): boolean {
  // Strip trailing DNS dot and IPv6 brackets
  const clean = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (BLOCKED_SSRF_HOSTS.has(clean)) return true;
  if (
    clean.endsWith(".internal") ||
    clean.endsWith(".local") ||
    clean.endsWith(".localhost") ||
    clean.endsWith(".arpa")
  ) {
    return true;
  }

  // IPv6 loopback, unspecified, link-local, unique-local, or IPv4-mapped IPv6
  if (
    clean === "::1" ||
    clean === "::" ||
    clean === "0:0:0:0:0:0:0:1" ||
    clean === "0:0:0:0:0:0:0:0" ||
    clean.startsWith("fe80:") ||
    clean.startsWith("fc") ||
    clean.startsWith("fd") ||
    clean.startsWith("::ffff:")
  ) {
    return true;
  }

  // IPv4 private ranges (RFC 1918) + loopback + link-local + CGNAT (100.64.0.0/10) + 0.0.0.0/8
  if (
    /^(0\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/.test(
      clean
    )
  ) {
    return true;
  }

  // Block integer/hex/octal single-number IPv4 representations (e.g. 2130706433 or 0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(clean)) {
    return true;
  }

  return false;
}

export async function inspectWebsite(url: string, focusQuery?: string): Promise<string> {
  let currentUrl = url.startsWith("http") ? url : `https://${url}`;

  const start = Date.now();
  const maxRedirects = 3;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return `Website Inspection Failed: the provided URL is not valid.`;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `Website Inspection blocked: only http(s) URLs are permitted.`;
      }
      if (isPrivateHost(parsed.hostname)) {
        return `Website Inspection blocked: requests to internal or cloud metadata endpoints are not permitted.`;
      }

      // Use manual redirect handling so every redirect target is validated against SSRF rules
      const res = await fetch(parsed.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "AutonomousAgent/1.0 (HealthCheck)" },
        signal: AbortSignal.timeout(15000),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return JSON.stringify({
            url: currentUrl,
            status: res.status,
            statusText: res.statusText,
            latencyMs: Date.now() - start,
            contentLength: 0,
            htmlPreview: "(Redirect response without Location header)",
          }, null, 2);
        }
        if (hop === maxRedirects) {
          return `Website Inspection blocked: exceeded maximum redirect hops (${maxRedirects}).`;
        }
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      const latency = Date.now() - start;
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const bodyText = await res.text();

      // If response is JSON, return parsed/formatted JSON preview
      if (contentType.includes("application/json")) {
        return JSON.stringify({
          url: currentUrl,
          status: res.status,
          statusText: res.statusText,
          contentType,
          latencyMs: latency,
          contentLength: bodyText.length,
          jsonContent: bodyText.slice(0, 6000),
        }, null, 2);
      }

      // Extract title, meta description, headings, and clean readable text from HTML
      const titleMatch = bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const pageTitle = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
      const descMatch = bodyText.match(/<meta[^>]+name=["\x27]description["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i);
      const metaDescription = descMatch && descMatch[1] ? descMatch[1].trim() : "";

      const headings = Array.from(bodyText.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
        .map((m) => (m && m[1] ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : ""))
        .filter(Boolean)
        .slice(0, 15);

      const readableText = bodyText
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);

      let focusedExcerpts: string[] = [];
      if (focusQuery && typeof focusQuery === "string" && focusQuery.trim()) {
        const terms = focusQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        const blocks = readableText.split(/\n\n+/).map((b) => b.trim()).filter((b) => b.length > 30);
        for (const block of blocks) {
          const bLow = block.toLowerCase();
          if (terms.some((t) => bLow.includes(t))) {
            focusedExcerpts.push(block.slice(0, 450));
            if (focusedExcerpts.length >= 6) break;
          }
        }
      }

      return JSON.stringify({
        url: currentUrl,
        status: res.status,
        statusText: res.statusText,
        latencyMs: latency,
        contentLength: bodyText.length,
        title: pageTitle,
        metaDescription,
        headings,
        ...(focusedExcerpts.length > 0 ? { focusedExcerpts } : {}),
        readableText,
        htmlPreview: bodyText.slice(0, 400).replace(/\s+/g, " "),
      }, null, 2);
    }
    return `Website Inspection blocked: redirect loop detected.`;
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

/**
 * 8. Native Web Search Tool (Tavily AI Search & Brave Web Search)
 */
export async function executeWebSearch(
  query: string,
  opts: {
    provider?: "tavily" | "brave" | undefined;
    apiKey?: string | undefined;
    maxResults?: number | undefined;
  } = {}
): Promise<string> {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return "Error: Search query cannot be empty.";

  const count = Math.min(Math.max(Number(opts.maxResults) || 5, 1), 10);
  const tavilyKey =
    opts.provider === "tavily" ? opts.apiKey : (!opts.provider ? process.env.TAVILY_API_KEY : undefined);
  const braveKey =
    opts.provider === "brave" ? opts.apiKey : (!opts.provider ? process.env.BRAVE_API_KEY : undefined);

  if (tavilyKey) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tavilyKey}`,
        },
        body: JSON.stringify({
          query: cleanQuery,
          max_results: count,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return `Tavily Search Error (${res.status}): ${res.statusText}`;
      }
      const data = (await res.json()) as any;
      const items = (data?.results || []).map((r: any, idx: number) =>
        `${idx + 1}. [${r.title || "Result"}](${r.url || ""})\n   ${String(r.content || "").slice(0, 300)}`
      );
      return [
        data?.answer ? `Direct Answer: ${data.answer}\n` : "",
        `Tavily Search Results for "${cleanQuery}":`,
        items.join("\n\n") || "No results found.",
      ]
        .filter(Boolean)
        .join("\n");
    } catch (err: any) {
      return `Tavily Search Error: ${err.message}`;
    }
  }

  if (braveKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(cleanQuery)}&count=${count}`;
      const res = await fetch(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": braveKey,
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return `Brave Search Error (${res.status}): ${res.statusText}`;
      }
      const data = (await res.json()) as any;
      const results = data?.web?.results || [];
      const items = results.map((r: any, idx: number) =>
        `${idx + 1}. [${r.title || "Result"}](${r.url || ""})\n   ${String(r.description || "").slice(0, 300)}`
      );
      return `Brave Search Results for "${cleanQuery}":\n${items.join("\n\n") || "No results found."}`;
    } catch (err: any) {
      return `Brave Search Error: ${err.message}`;
    }
  }

  // Zero-Key Multi-Source Live Web Search Engine (Wikipedia + DuckDuckGo Instant Answer + HackerNews Algolia)
  const resultsOut: string[] = [];

  const [ddgRes, wikiRes, hnRes] = await Promise.allSettled([
    fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "ShunopsAI-Agent/1.0" },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),

    fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&srlimit=${Math.min(count, 5)}`, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "ShunopsAI-Agent/1.0" },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),

    fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(cleanQuery)}&hitsPerPage=${Math.min(count, 5)}`, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "ShunopsAI-Agent/1.0" },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  if (ddgRes.status === "fulfilled" && ddgRes.value) {
    const ddg: any = ddgRes.value;
    if (ddg.AbstractText) {
      resultsOut.push(`• [DuckDuckGo Instant Answer: ${ddg.Heading || cleanQuery}](${ddg.AbstractURL || "https://duckduckgo.com"})
  ${ddg.AbstractText}`);
    }
    if (Array.isArray(ddg.RelatedTopics)) {
      for (const topic of ddg.RelatedTopics.slice(0, 4)) {
        if (topic && topic.Text && topic.FirstURL) {
          resultsOut.push(`• [${topic.Text.slice(0, 90)}](${topic.FirstURL})
  ${topic.Text}`);
        }
      }
    }
  }

  if (wikiRes.status === "fulfilled" && wikiRes.value) {
    const wikiVal: any = wikiRes.value;
    const wikiItems: any[] = wikiVal?.query?.search || [];
    for (const item of wikiItems.slice(0, 4)) {
      const cleanSnippet = String(item.snippet || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "").replace(/\s+/g, "_"))}`;
      resultsOut.push(`• [Wikipedia: ${item.title}](${url})
  ${cleanSnippet}`);
    }
  }

  if (hnRes.status === "fulfilled" && hnRes.value) {
    const hnVal: any = hnRes.value;
    const hits: any[] = hnVal?.hits || [];
    for (const hit of hits.slice(0, 4)) {
      if (hit && hit.title) {
        const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        resultsOut.push(`• [HackerNews: ${hit.title}](${url}) (points: ${hit.points || 0}, comments: ${hit.num_comments || 0})`);
      }
    }
  }

  if (resultsOut.length > 0) {
    return `Live Web Search Results for "${cleanQuery}" (Zero-Key Multi-Source Engine):\n\n${resultsOut.slice(0, count + 3).join("\n\n")}`;
  }

  return `No live web search results found for "${cleanQuery}". Try refining your search keywords or use inspect_website with a direct URL.`;
}

/**
 * 9. Tenant-Scoped Google Cloud Platform (GCP) REST Inspector
 * Inspects Cloud Run services, queries BigQuery SQL, or reads Cloud Logging using the caller's GCP token.
 */
export async function inspectGcpCloud(
  action: {
    operation: "list_cloud_run_services" | "query_bigquery" | "list_logs";
    region?: string | undefined;
    sqlQuery?: string | undefined;
    logFilter?: string | undefined;
  },
  opts: { projectId?: string | undefined; token?: string | undefined } = {}
): Promise<string> {
  const projectId = (opts.projectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "").trim();
  const rawToken = (opts.token || process.env.GCP_ACCESS_TOKEN || "").trim();

  if (!projectId || !rawToken) {
    return "Error: GCP Project ID and OAuth/Access Token are required. Connect Google Cloud Platform (GCP) under Account Settings → Platform Connections.";
  }

  if (!/^[a-z0-9:-]{4,64}$/i.test(projectId)) {
    return "Error: Invalid GCP Project ID format.";
  }

  const headers: Record<string, string> = {
    Authorization: rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    if (action.operation === "list_cloud_run_services") {
      const location = (action.region || "-").replace(/[^a-z0-9-]/gi, "");
      const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/services`;
      const res = await fetch(url, { method: "GET", redirect: "error", headers, signal: AbortSignal.timeout(12000) });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP Cloud Run API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      const services = Array.isArray(data?.services) ? data.services : [];
      return `GCP Cloud Run Services in project "${projectId}" (${services.length}):\n` +
        (services.map((s: any) => `• ${s.name} -> ${s.uri || "no-uri"} (updated: ${s.updateTime || "unknown"})`).join("\n") || "No services found.");
    }

    if (action.operation === "query_bigquery") {
      if (!action.sqlQuery) return "Error: sqlQuery is required for query_bigquery.";
      const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({ query: action.sqlQuery, useLegacySql: false, maxResults: 50 }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP BigQuery API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      return `GCP BigQuery Result (${data?.totalRows || 0} rows):\n${JSON.stringify(data?.rows || [], null, 2)}`;
    }

    if (action.operation === "list_logs") {
      const url = `https://logging.googleapis.com/v2/entries:list`;
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({
          resourceNames: [`projects/${projectId}`],
          filter: action.logFilter || "severity>=ERROR",
          pageSize: 20,
          orderBy: "timestamp desc",
        }),
        signal: AbortSignal.timeout(12000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP Cloud Logging API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      return `GCP Cloud Logging Entries (${(data?.entries || []).length}):\n${JSON.stringify(data?.entries || [], null, 2)}`;
    }

    return `Unsupported GCP operation: ${action.operation}`;
  } catch (err: any) {
    return `GCP API Error: ${err.message}`;
  }
}
