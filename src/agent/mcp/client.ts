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
function isPrivateOrSpecialIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  return (
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
  const isDevOrTest =
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development" ||
    !process.env.NODE_ENV;
  if (isDevOrTest) {
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

function validateOutboundMcpUrl(rawUrl: string): URL {
  const targetUrl = new URL(rawUrl);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error(`Disallowed protocol: ${targetUrl.protocol}`);
  }

  if (targetUrl.username || targetUrl.password) {
    throw new Error("Disallowed URL credentials in MCP server URL.");
  }

  const hostname = targetUrl.hostname.toLowerCase().replace(/\.$/, "");
  const isDevOrTest =
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development" ||
    !process.env.NODE_ENV;

  const blockedHosts = new Set([
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.platform",
  ]);

  if (!isDevOrTest) {
    blockedHosts.add("localhost");
    blockedHosts.add("127.0.0.1");
    blockedHosts.add("::1");
  }

  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith(".internal") ||
    (!isDevOrTest && (isPrivateOrSpecialIpv4(hostname) || isDisallowedIpv6Literal(hostname)))
  ) {
    throw new Error(`Disallowed internal or private host: ${targetUrl.hostname}`);
  }

  const allowedHosts = getAllowedMcpHosts();
  const matchedHost = allowedHosts.find((h) => h.toLowerCase() === hostname);
  if (!matchedHost) {
    throw new Error(`Disallowed MCP host: ${targetUrl.hostname}. Host must be registered in allowed MCP hosts list.`);
  }

  return targetUrl;
}

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
};

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
      const isDevOrTest =
        process.env.NODE_ENV === "test" ||
        process.env.NODE_ENV === "development" ||
        !process.env.NODE_ENV;

      const raw = this.config.url.trim().replace(/\/+$/, "");
      const matchedEndpoint =
        ALLOWED_MCP_TARGET_ENDPOINTS[raw] ||
        ALLOWED_MCP_TARGET_ENDPOINTS[this.config.url];

      let destinationUrl: string;
      if (matchedEndpoint) {
        destinationUrl = matchedEndpoint;
      } else if (isDevOrTest && (raw.startsWith("http://127.0.0.1:") || raw.startsWith("http://localhost:"))) {
        destinationUrl = raw;
      } else {
        const targetUrl = validateOutboundMcpUrl(this.config.url);
        const allowedHosts = getAllowedMcpHosts();
        const matchedHost = allowedHosts.find((h) => h.toLowerCase() === targetUrl.hostname.toLowerCase());
        if (!matchedHost) {
          throw new Error(`Disallowed MCP host: ${targetUrl.hostname}`);
        }

        const safePort = targetUrl.port ? `:${targetUrl.port}` : "";
        const safeOrigin = `${targetUrl.protocol}//${matchedHost}${safePort}`;
        const safeUrl = new URL(targetUrl.pathname + targetUrl.search, safeOrigin);
        destinationUrl = safeUrl.href;
      }

      const res = await fetch(destinationUrl, {
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
