import type {
  McpServerConfig,
  McpToolsListResult,
  McpCallToolResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
} from "./types.js";

/**
 * Lightweight, zero-dependency MCP HTTP Client.
 * Connects to remote or local HTTP MCP servers using standard JSON-RPC 2.0.
 * Memory footprint: ~1MB.
 */

/** Rejected by the outbound MCP URL policy (protocol, host, or shape). */
export class McpUrlError extends Error {}

/**
 * True while running as a developer/test process, where pointing at a local
 * bridge (127.0.0.1 / localhost) is a legitimate MCP target. Production never is.
 */
export function isDevOrTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development" ||
    !process.env.NODE_ENV
  );
}

/** Canonical form used as the key of the allowed-endpoint directory. */
export function normalizeMcpEndpoint(rawUrl: string): string {
  let normalized = rawUrl.trim();
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Endpoint of the built-in sovereign MCP server, served by this same app. */
export const BUILT_IN_MCP_ENDPOINT = "/api/mcp";

/**
 * The built-in server is not an outbound call: it is a route on this app, so it
 * is never validated or registered as an external target.
 */
export function isBuiltInMcpEndpoint(rawUrl: string): boolean {
  const normalized = normalizeMcpEndpoint(rawUrl);
  return normalized === BUILT_IN_MCP_ENDPOINT || normalized.endsWith(BUILT_IN_MCP_ENDPOINT);
}

function isPrivateOrSpecialIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 192 && b === 168) || // RFC1918
    (a === 172 && b >= 16 && b <= 31) // RFC1918
  );
}

function isDisallowedIpv6Literal(hostname: string): boolean {
  // URL.hostname for IPv6 literals is typically bracketed, e.g. "[::1]"
  const normalized = hostname.toLowerCase();
  if (!(normalized.startsWith("[") && normalized.endsWith("]"))) return false;
  const v6 = normalized.slice(1, -1);
  return (
    v6 === "::1" || // loopback
    v6.startsWith("fe80:") || // link-local
    v6.startsWith("fc") || // unique local
    v6.startsWith("fd") // unique local
  );
}

export const DEFAULT_ALLOWED_MCP_HOSTS: readonly string[] = [
  "mcp.wikipedia.org",
  "mcp.firecrawl.dev",
  "mcp.browserbase.com",
  "mcp.arxiv.org",
  "mcp.exa.ai",
  "mcp.slack.com",
  "mcp.linear.app",
  "mcp.context7.com",
  "brave.mcp.example.com",
  "neon.mcp.example.com",
  "mcp.example.com",
  "api.mcp.example.com",
];

export function getAllowedMcpHosts(): string[] {
  const hosts = [...DEFAULT_ALLOWED_MCP_HOSTS];
  if (isDevOrTestEnvironment()) {
    hosts.push("127.0.0.1", "localhost");
  }
  const custom = process.env.ALLOWED_MCP_HOSTS;
  if (custom) {
    for (const h of custom.split(",")) {
      const clean = h.trim().toLowerCase();
      if (clean && !hosts.includes(clean)) {
        hosts.push(clean);
      }
    }
  }
  return hosts;
}

/**
 * Validate an outbound MCP server URL and return it in canonical form.
 *
 * This is the single gate for every MCP destination a user can configure:
 * the connect form, the "test connection" probe, and the run-time registry all
 * call it, so a URL that fails here can never be stored as a working
 * connection. When it passes, the caller registers the exact returned endpoint
 * in `ALLOWED_MCP_TARGET_ENDPOINTS`, which is the only thing `fetch` is allowed
 * to send to — there is no dynamic fallback destination anywhere in the client.
 */
export function assertAllowedMcpUrl(rawUrl: string): string {
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    throw new McpUrlError(`Invalid MCP server URL: ${rawUrl}`);
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new McpUrlError(`Disallowed protocol: ${targetUrl.protocol}`);
  }

  if (targetUrl.username || targetUrl.password) {
    throw new McpUrlError("Disallowed URL credentials in MCP server URL.");
  }

  if (targetUrl.hash) {
    throw new McpUrlError("Disallowed URL fragment in MCP server URL.");
  }

  const hostname = targetUrl.hostname.toLowerCase().replace(/\.$/, "");
  const devOrTest = isDevOrTestEnvironment();

  const blockedHosts = new Set([
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.platform",
  ]);

  if (!devOrTest) {
    blockedHosts.add("localhost");
    blockedHosts.add("127.0.0.1");
    blockedHosts.add("::1");
    blockedHosts.add("[::1]");
  }

  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost") ||
    (!devOrTest && (isPrivateOrSpecialIpv4(hostname) || isDisallowedIpv6Literal(hostname)))
  ) {
    throw new McpUrlError(`Disallowed internal or private host: ${targetUrl.hostname}`);
  }

  const matchedHost = getAllowedMcpHosts().find((h) => h.toLowerCase() === hostname);
  if (!matchedHost) {
    throw new McpUrlError(
      `Disallowed MCP host: ${targetUrl.hostname}. Host must be registered in the allowed MCP hosts list.`
    );
  }

  return normalizeMcpEndpoint(targetUrl.toString());
}

/**
 * Directory of endpoints `fetch` may reach, keyed by canonical URL so the
 * client never builds a destination from a raw user string by itself.
 */
export const ALLOWED_MCP_TARGET_ENDPOINTS: Record<string, string> = {
  "https://mcp.wikipedia.org/v1": "https://mcp.wikipedia.org/v1",
  "https://mcp.firecrawl.dev/v1": "https://mcp.firecrawl.dev/v1",
  "https://mcp.browserbase.com/v1": "https://mcp.browserbase.com/v1",
  "https://mcp.arxiv.org/v1": "https://mcp.arxiv.org/v1",
  "https://mcp.exa.ai/v1": "https://mcp.exa.ai/v1",
  "https://mcp.slack.com/v1": "https://mcp.slack.com/v1",
  "https://mcp.linear.app/v1": "https://mcp.linear.app/v1",
  "https://mcp.context7.com/mcp": "https://mcp.context7.com/mcp",
  "https://brave.mcp.example.com": "https://brave.mcp.example.com",
  "https://neon.mcp.example.com": "https://neon.mcp.example.com",
  "https://mcp.example.com": "https://mcp.example.com",
  "https://api.mcp.example.com": "https://api.mcp.example.com",
  "http://127.0.0.1:8000/sse": "http://127.0.0.1:8000/sse",
};

/** Register an already-validated endpoint, returning its canonical form. */
export function registerAllowedMcpEndpoint(url: string): string {
  const clean = normalizeMcpEndpoint(url);
  ALLOWED_MCP_TARGET_ENDPOINTS[clean] = clean;
  return clean;
}

/** Validate and register in one step; the only correct way to add a target. */
export function allowMcpEndpoint(rawUrl: string): string {
  return registerAllowedMcpEndpoint(assertAllowedMcpUrl(rawUrl));
}

export class McpHttpClient {
  private config: McpServerConfig;
  private requestId = 1;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  private async jsonRpcCall<T>(method: string, params?: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
    if (!this.config.url) {
      throw new Error(`MCP Server [${this.config.name}] has no endpoint URL configured.`);
    }

    const payload: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method,
      params,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.config.headers || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // The destination is only ever a value from the validated directory.
      const destinationUrl =
        ALLOWED_MCP_TARGET_ENDPOINTS[normalizeMcpEndpoint(this.config.url)];

      if (!destinationUrl) {
        throw new Error(
          `Disallowed MCP endpoint: ${this.config.url}. Endpoint must be registered in allowed MCP targets.`
        );
      }

      const url = new URL(destinationUrl);
if (!['https:', 'http:'].includes(url.protocol)) {
  throw new Error(`Invalid protocol for MCP endpoint: ${url.protocol}`);
}
const allowedHosts = Object.values(ALLOWED_MCP_TARGET_ENDPOINTS).map(u => new URL(u).hostname);
if (!allowedHosts.includes(url.hostname)) {
  throw new Error(`Disallowed MCP endpoint hostname: ${url.hostname}`);
}
const res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`MCP HTTP error ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as McpJsonRpcResponse<T>;

      if (body.error) {
        throw new Error(`MCP Error [code ${body.error.code}]: ${body.error.message}`);
      }

      return body.result as T;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`MCP Server [${this.config.name}] call timed out after ${timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Discovers tools supported by the remote MCP server.
   */
  async listTools(): Promise<McpToolsListResult> {
    return this.jsonRpcCall<McpToolsListResult>("tools/list");
  }

  /**
   * Executes a tool via standard MCP JSON-RPC.
   */
  async callTool(name: string, argumentsObj: Record<string, unknown> = {}): Promise<McpCallToolResult> {
    return this.jsonRpcCall<McpCallToolResult>("tools/call", {
      name,
      arguments: argumentsObj,
    });
  }
}
