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

function validateOutboundMcpUrl(rawUrl: string): URL {
  const targetUrl = new URL(rawUrl);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error(`Disallowed protocol: ${targetUrl.protocol}`);
  }

  if (targetUrl.username || targetUrl.password) {
    throw new Error("Disallowed URL credentials in MCP server URL.");
  }

  const hostname = targetUrl.hostname.toLowerCase().replace(/\.$/, "");
  const blockedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.platform",
  ]);

  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith(".internal") ||
    isPrivateOrSpecialIpv4(hostname) ||
    isDisallowedIpv6Literal(hostname)
  ) {
    throw new Error(`Disallowed internal or private host: ${targetUrl.hostname}`);
  }

  return targetUrl;
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
      const targetUrl = validateOutboundMcpUrl(this.config.url);
    // Ensure the URL points to an allowed MCP host to prevent SSRF
    const allowedHosts = ["mcp.example.com", "api.mcp.example.com"]; // TODO: populate with real allowed hosts
    if (!allowedHosts.includes(targetUrl.hostname)) {
      throw new Error(`Disallowed MCP host: ${targetUrl.hostname}`);
    }
      if (targetUrl.protocol !== 'https:') { throw new Error(`Disallowed protocol: ${targetUrl.protocol}`); } const res = await fetch(targetUrl.href, {
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
