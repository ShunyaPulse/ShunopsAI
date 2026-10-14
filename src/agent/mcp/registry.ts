import OpenAI from "openai";
import { McpHttpClient, allowMcpEndpoint, isBuiltInMcpEndpoint } from "./client.js";
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

/** Servers registered from a tenant's vault are namespaced with this prefix. */
const TENANT_SERVER_PREFIX = "user_";
const MAX_TOOLS_PER_SERVER = 50;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_DESC_LENGTH = 500;
const MAX_TOOL_TEXT_LENGTH = 20000;
const MAX_CACHED_SERVERS = 200;

/**
 * Strip prompt-injection control sequences and cap length on external MCP
 * tool/parameter descriptions before exposing them to the LLM.
 */
function sanitizeMcpDescription(raw: unknown, fallback = ""): string {
  const str = typeof raw === "string" ? raw : fallback;
  return str
    .replace(/[\r\n]+/g, " ")
    .replace(/\b(system\s*override|ignore\s+(all\s+)?previous\s+instructions|system\s*:|assistant\s*:)/gi, "[filtered]")
    .trim()
    .slice(0, MAX_TOOL_DESC_LENGTH);
}

function sanitizeMcpProperties(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props as Record<string, any>).slice(0, 40)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      clean[key] = {
        ...val,
        ...(typeof val.description === "string"
          ? { description: sanitizeMcpDescription(val.description) }
          : {}),
      };
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * In-memory registry for active MCP Servers.
 * Handles auto-discovery and translates MCP schemas to OpenAI Function Calling format.
 *
 * Isolation: a run only ever sees the operator's servers plus the MCP servers
 * of the tenant that run belongs to. Tenant server ids carry the owning user id
 * (`user_<id>_<server>`), so one tenant can never list, call, or borrow the
 * credentials of another tenant's server.
 */
class McpRegistryManager {
  private servers: Map<string, McpServerConfig> = new Map();
  private clients: Map<string, McpHttpClient> = new Map();
  private cachedTools: Map<string, DynamicMcpTool[]> = new Map();

  /**
   * Register a new MCP Server (e.g. from environment or user workspace).
   */
  registerServer(config: McpServerConfig): void {
    // Bound total registered tenant servers to prevent unbounded memory growth
    if (!this.servers.has(config.id) && this.servers.size >= MAX_CACHED_SERVERS) {
      const oldestTenantId = Array.from(this.servers.keys()).find((k) => this.isTenantServer(k));
      if (oldestTenantId) this.unregisterServer(oldestTenantId);
    }

    const previous = this.servers.get(config.id);
    const changed =
      !previous ||
      previous.url !== config.url ||
      previous.enabled !== config.enabled ||
      JSON.stringify(previous.headers ?? {}) !== JSON.stringify(config.headers ?? {});

    this.servers.set(config.id, config);

    if (config.transport === "http" || config.transport === "sse") {
      if (changed || !this.clients.has(config.id)) {
        this.clients.set(config.id, new McpHttpClient(config));
      }
    }

    // Invalidate the tool cache only when the server actually changed, so a
    // scope refresh on every run does not force a re-discovery round trip.
    if (changed) {
      this.cachedTools.delete(config.id);
    }
  }

  /**
   * Unregister an MCP Server.
   */
  unregisterServer(id: string): void {
    this.servers.delete(id);
    this.clients.delete(id);
    this.cachedTools.delete(id);
  }

  /** Id prefix owned by one tenant; operator servers never match it. */
  private tenantPrefix(userId?: number): string {
    return `${TENANT_SERVER_PREFIX}${userId ?? "tenant"}_`;
  }

  private isTenantServer(id: string): boolean {
    return id.startsWith(TENANT_SERVER_PREFIX);
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
    const sanitizedName = `mcp_${serverId}_${tool.name}`
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, MAX_TOOL_NAME_LENGTH);

    const safeServerName = sanitizeMcpDescription(serverName, "MCP").slice(0, 64);
    const safeToolDesc = sanitizeMcpDescription(tool.description, tool.name);

    const schema: OpenAI.ChatCompletionTool = {
      type: "function",
      function: {
        name: sanitizedName,
        description: `[MCP: ${safeServerName}] ${safeToolDesc}`,
        parameters: {
          type: "object",
          properties: sanitizeMcpProperties(tool.inputSchema?.properties),
          required: Array.isArray(tool.inputSchema?.required)
            ? tool.inputSchema.required.slice(0, 40)
            : [],
        },
      },
    };

    return {
      name: sanitizedName,
      originalName: tool.name,
      serverId,
      serverName: safeServerName,
      schema,
      execute: async (args: Record<string, unknown>) => {
        try {
          const res = await client.callTool(tool.name, args);
          const content = Array.isArray(res?.content) ? res.content : [];
          const text = content
            .map((c: any) => (typeof c?.text === "string" ? c.text : JSON.stringify(c)))
            .join("\n")
            .slice(0, MAX_TOOL_TEXT_LENGTH);
          if (res?.isError) {
            return `[MCP Error from ${safeServerName}]: ${text || "Tool execution failed"}`;
          }
          return text || `[MCP: ${safeServerName}] ${tool.name} returned no content.`;
        } catch (err: any) {
          return `[MCP Client Error]: ${err.message || String(err)}`;
        }
      },
    };
  }

  /**
   * Refresh this scope's tenant servers and return the ids it owns.
   *
   * Validating here (not only in the connect form) means a stored endpoint that
   * is not an allowed outbound target is refused instead of being fetched, and
   * a disconnect removes the server — and its cached tools — on the next run
   * rather than lingering for every future run of that account.
   */
  private syncTenantServers(scope?: ToolScope): Set<string> {
    const activeTenantIds = new Set<string>();
    const userId = scope?.userId;
    const prefix = this.tenantPrefix(userId);

    const connected: Array<{
      id: string;
      name?: string | undefined;
      serverUrl: string;
      apiKey?: string | undefined;
    }> = [];

    if (scope?.credentials?.mcpServers && scope.credentials.mcpServers.length > 0) {
      connected.push(...scope.credentials.mcpServers);
    } else if (scope?.credentials?.mcp?.serverUrl) {
      connected.push({
        id: "mcp",
        name: `${scope.username || "User"}'s Custom MCP`,
        serverUrl: scope.credentials.mcp.serverUrl,
        apiKey: scope.credentials.mcp.apiKey,
      });
    }

    for (const server of connected) {
      if (!server?.serverUrl) continue;
      const sanitizedId = String(server.id || "mcp").replace(/[^a-zA-Z0-9_-]/g, "_");
      const serverId = `${prefix}${sanitizedId}`;
      activeTenantIds.add(serverId);

      // The built-in sovereign server is not an outbound target; its tools are
      // native agent tools, so there is nothing to discover over HTTP.
      if (isBuiltInMcpEndpoint(server.serverUrl)) {
        this.unregisterServer(serverId);
        continue;
      }

      let endpoint: string;
      try {
        endpoint = allowMcpEndpoint(server.serverUrl);
      } catch {
        this.unregisterServer(serverId);
        // Deliberately static: both the policy message and the tenant's own
        // server name come from credential data, and neither belongs in a log.
        console.warn("[MCP] refused a configured endpoint that failed the outbound MCP URL policy.");
        continue;
      }

      this.registerServer({
        id: serverId,
        name: server.name || server.id,
        transport: "http",
        url: endpoint,
        headers: server.apiKey
          ? { Authorization: server.apiKey.startsWith("Bearer ") ? server.apiKey : `Bearer ${server.apiKey}` }
          : {},
        enabled: true,
      });
    }

    // Drop servers this tenant has disconnected or whose credential is gone.
    for (const id of Array.from(this.servers.keys())) {
      if (id.startsWith(prefix) && !activeTenantIds.has(id)) {
        this.unregisterServer(id);
      }
    }

    return activeTenantIds;
  }

  /**
   * Fetch and aggregate dynamic tools from all active MCP servers for the current run.
   */
  async getActiveTools(scope?: ToolScope): Promise<DynamicMcpTool[]> {
    const activeTenantIds = this.syncTenantServers(scope);
    const allTools: DynamicMcpTool[] = [];

    for (const [id, config] of this.servers.entries()) {
      if (config.enabled === false) continue;
      // Tenant servers belong to exactly one account: another tenant's server is
      // neither listed nor callable from this run.
      if (this.isTenantServer(id) && !activeTenantIds.has(id)) continue;

      const client = this.clients.get(id);
      if (!client) continue;

      try {
        if (!this.cachedTools.has(id)) {
          const listRes = await client.listTools();
          const discovered = (listRes?.tools ?? []).slice(0, MAX_TOOLS_PER_SERVER);
          this.cachedTools.set(
            id,
            discovered.map((t: McpToolSchema) =>
              this.convertMcpToolToOpenAi(id, config.name, t, client)
            )
          );
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
