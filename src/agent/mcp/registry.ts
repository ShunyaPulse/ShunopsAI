import OpenAI from "openai";
import { McpHttpClient } from "./client.js";
import type { McpServerConfig, McpToolSchema } from "./types.js";
import type { ToolScope } from "../scope.js";

export interface DynamicMcpTool {
  name: string;
  originalName: string;
  serverId: string;
  serverName: string;
  schema: OpenAI.ChatCompletionTool;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * In-memory registry for active MCP Servers.
 * Handles auto-discovery and translates MCP schemas to OpenAI Function Calling format.
 */
class McpRegistryManager {
  private servers: Map<string, McpServerConfig> = new Map();
  private clients: Map<string, McpHttpClient> = new Map();
  private cachedTools: Map<string, DynamicMcpTool[]> = new Map();

  /**
   * Register a new MCP Server (e.g. from environment or user workspace).
   */
  registerServer(config: McpServerConfig): void {
    this.servers.set(config.id, config);
    if (config.transport === "http" || config.transport === "sse") {
      this.clients.set(config.id, new McpHttpClient(config));
    }
    // Invalidate tool cache for this server
    this.cachedTools.delete(config.id);
  }

  /**
   * Unregister an MCP Server.
   */
  unregisterServer(id: string): void {
    this.servers.delete(id);
    this.clients.delete(id);
    this.cachedTools.delete(id);
  }

  /**
   * Convert an MCP tool schema into standard OpenAI Function Calling schema.
   */
  private convertMcpToolToOpenAi(
    serverId: string,
    serverName: string,
    tool: McpToolSchema,
    client: McpHttpClient
  ): DynamicMcpTool {
    const sanitizedName = `mcp_${serverId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

    const schema: OpenAI.ChatCompletionTool = {
      type: "function",
      function: {
        name: sanitizedName,
        description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
        parameters: {
          type: "object",
          properties: (tool.inputSchema?.properties as Record<string, unknown>) || {},
          required: tool.inputSchema?.required || [],
        },
      },
    };

    return {
      name: sanitizedName,
      originalName: tool.name,
      serverId,
      serverName,
      schema,
      execute: async (args: Record<string, unknown>) => {
        try {
          const res = await client.callTool(tool.name, args);
          if (res.isError) {
            const errText = res.content.map((c: any) => c.text || "").join("\n");
            return `[MCP Error from ${serverName}]: ${errText || "Tool execution failed"}`;
          }
          return res.content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
        } catch (err: any) {
          return `[MCP Client Error]: ${err.message || String(err)}`;
        }
      },
    };
  }

  /**
   * Fetch and aggregate dynamic tools from all active MCP servers for the current run.
   */
  async getActiveTools(scope?: ToolScope): Promise<DynamicMcpTool[]> {
    const allTools: DynamicMcpTool[] = [];

    // Dynamically register tenant's connected MCP server from scope vault credentials
    if (scope?.credentials?.mcp?.serverUrl) {
      const userMcpId = `user_${scope.userId || "tenant"}_mcp`;
      this.registerServer({
        id: userMcpId,
        name: `${scope.username || "User"}'s Custom MCP`,
        transport: "http",
        url: scope.credentials.mcp.serverUrl,
        headers: scope.credentials.mcp.apiKey
          ? { Authorization: scope.credentials.mcp.apiKey.startsWith("Bearer ") ? scope.credentials.mcp.apiKey : `Bearer ${scope.credentials.mcp.apiKey}` }
          : {},
        enabled: true,
      });
    }

    for (const [id, config] of this.servers.entries()) {
      if (config.enabled === false) continue;

      const client = this.clients.get(id);
      if (!client) continue;

      try {
        if (!this.cachedTools.has(id)) {
          const listRes = await client.listTools();
          const dynamicTools = listRes.tools.map((t: McpToolSchema) =>
            this.convertMcpToolToOpenAi(id, config.name, t, client)
          );
          this.cachedTools.set(id, dynamicTools);
        }

        const serverTools = this.cachedTools.get(id) || [];
        allTools.push(...serverTools);
      } catch (err: any) {
        // Log & non-blocking: server timeout shouldn't take down the agent
        console.warn(`[MCP Server ${config.name}] Discovery failed: ${err.message}`);
      }
    }

    return allTools;
  }
}

export const mcpRegistry = new McpRegistryManager();
