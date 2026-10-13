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
      const targetUrl = new URL(this.config.url);
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        throw new Error(`Invalid MCP URL protocol: ${targetUrl.protocol}`);
      }
      const blockedHosts = [
        "169.254.169.254",
        "metadata.google.internal",
        "metadata.platform",
      ];
      if (blockedHosts.includes(targetUrl.hostname) || targetUrl.hostname.endsWith(".internal")) {
        throw new Error(`Disallowed internal metadata host: ${targetUrl.hostname}`);
      }

      const res = await fetch(targetUrl.toString(), {
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
