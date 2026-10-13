/**
 * Model Context Protocol (MCP) Client Specification & Protocol Types
 * Standard JSON-RPC 2.0 implementation for connecting to local & remote MCP Servers.
 */

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown> | undefined;
}

export interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T | undefined;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  } | undefined;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpToolsListResult {
  tools: McpToolSchema[];
  nextCursor?: string;
}

export interface McpCallToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}
