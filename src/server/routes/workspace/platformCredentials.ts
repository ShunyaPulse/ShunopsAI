import type { FastifyInstance } from "fastify";
import {
  listUserPlatformCredentials,
  upsertUserPlatformCredential,
  deleteUserPlatformCredential,
  getUserCredentialBundle,
  PLATFORM_SPECS,
  CredentialVaultError,
  isVaultConfigured,
} from "../../db.js";
import {
  McpHttpClient,
  allowMcpEndpoint,
  isBuiltInMcpEndpoint,
  KNOWN_ALLOWED_MCP_HOSTS,
} from "../../../agent/mcp/client.js";
import { BUILT_IN_MCP_TOOLS } from "./mcpServer.js";
import { mcpCredentialRejection, mcpPolicyHint } from "./mcpPolicy.js";
import type { WorkspaceRouteDeps } from "./shared.js";

/** Is this host explicitly allowlisted (built-in list or ALLOWED_MCP_HOSTS)? */
function isAllowedMcpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (KNOWN_ALLOWED_MCP_HOSTS.some((h) => h === host)) return true;
  const customHosts = (process.env.ALLOWED_MCP_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return customHosts.includes(host);
}

/** Rebuild a validated endpoint from verified components. */
function safeEndpointFrom(url: URL): string {
  const safePort = url.port ? `:${url.port}` : "";
  const safeProtocol = url.protocol === "http:" ? "http:" : "https:";
  const safeOrigin = `${safeProtocol}//${url.hostname}${safePort}`;
  return new URL(`${url.pathname}${url.search}`, safeOrigin).href;
}

/** Load the stored URL/key for an already-connected MCP platform. */
async function loadSavedMcpTarget(
  userId: number | undefined,
  platform: string
): Promise<{ serverUrl: string; apiKey: string } | null> {
  if (!userId || !platform) return null;
  try {
    const bundle = await getUserCredentialBundle(userId);
    const found =
      bundle.mcpServers?.find((s) => s.id === platform) ||
      (platform === "mcp" ? bundle.mcp : undefined);
    if (!found) return null;
    return { serverUrl: found.serverUrl, apiKey: found.apiKey || "" };
  } catch {
    return null;
  }
}

/** Platform connections, MCP probes, and disconnects. */
export function registerPlatformCredentialRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { requireAuth } = deps;

  // 6. Platform Connections — the user's OWN provider credentials.
  // Agent runs started by this account use these and nothing else, so a user's
  // Neon/GitHub/Redis/Cloudflare commands can only ever touch their account.
  app.get("/api/user/platform-credentials", { preHandler: [requireAuth] }, async (req) => {
    const userId = (req as any).user?.id || 0;
    return {
      success: true,
      // Lets the form warn up front instead of failing only after a submit.
      vaultReady: isVaultConfigured(),
      available: Object.values(PLATFORM_SPECS).map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        tier: spec.tier,
        fields: spec.fields.map((field) => ({
          key: field.key,
          label: field.label,
          secret: field.secret,
          placeholder: field.placeholder,
          optional: field.optional,
        })),
      })),
      connected: await listUserPlatformCredentials(userId),
    };
  });

  app.post<{ Body: { platform?: string; label?: string; values?: Record<string, unknown> } }>(
    "/api/user/platform-credentials",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to connect a platform account." };
      }

      const platform = String(req.body?.platform || "");
      const values = (req.body?.values || {}) as Record<string, unknown>;
      const rejection = mcpCredentialRejection(platform, values);
      if (rejection) {
        reply.status(400);
        return { error: rejection };
      }

      try {
        const credential = await upsertUserPlatformCredential(
          userId,
          platform,
          values,
          req.body?.label
        );
        // Only the masked summary is echoed back; the secret never leaves the vault.
        return { success: true, credential };
      } catch (err: any) {
        reply.status(400);
        return {
          error:
            err instanceof CredentialVaultError
              ? err.message
              : "Could not store that credential.",
        };
      }
    }
  );

  // 6b. Test MCP Server Connection
  app.post<{ Body: { serverUrl?: string; apiKey?: string; platform?: string } }>(
    "/api/user/platform-credentials/test-mcp",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      let serverUrl = typeof req.body?.serverUrl === "string" ? req.body.serverUrl.trim() : "";
      let apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
      const platform = typeof req.body?.platform === "string" ? req.body.platform.trim() : "";

      // If testing an already connected platform by ID
      if (!serverUrl && platform) {
        const saved = await loadSavedMcpTarget((req as any).user?.id, platform);
        if (saved) {
          serverUrl = saved.serverUrl;
          apiKey = saved.apiKey;
        }
      }

      // Handle Built-in Sovereign MCP endpoint
      if (isBuiltInMcpEndpoint(serverUrl)) {
        const tools = BUILT_IN_MCP_TOOLS.map(({ name, description }) => ({ name, description }));
        return {
          success: true,
          connected: true,
          toolsCount: tools.length,
          tools,
          message: `Connection successful! ${tools.length} built-in sovereign tools active.`,
        };
      }

      if (!serverUrl) {
        reply.status(400);
        return { success: false, connected: false, error: "Server URL is required to test MCP connection." };
      }

      let matchedEndpoint: string;
      try {
        // Same validator the connect form and the run-time registry use, so
        // "test" can never pass a URL that a real run would refuse.
        matchedEndpoint = allowMcpEndpoint(serverUrl);
      } catch (err: any) {
        reply.status(400);
        return { success: false, connected: false, error: mcpPolicyHint(err) };
      }

      const testUrl = new URL(matchedEndpoint);
      if (!isAllowedMcpHost(testUrl.hostname)) {
        reply.status(400);
        return { success: false, connected: false, error: `Disallowed MCP host: ${testUrl.hostname}` };
      }

      const safeTestEndpoint = safeEndpointFrom(testUrl);

      try {
        const client = new McpHttpClient({
          id: "test-mcp",
          name: "MCP Connection Test",
          transport: "http",
          url: safeTestEndpoint,
          headers: apiKey
            ? { Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}` }
            : {},
        });

        const res = await client.listTools();
        const tools = (res?.tools || []).map((t) => ({
          name: t.name,
          description: t.description || "",
        }));

        return {
          success: true,
          connected: true,
          toolsCount: tools.length,
          tools,
          message: `Connection successful! ${tools.length} tool${tools.length === 1 ? "" : "s"} discovered.`,
        };
      } catch (err: any) {
        reply.status(400);
        return {
          success: false,
          connected: false,
          error: err.message || "Failed to reach MCP server. If this is a local bridge, verify it is running on your machine.",
        };
      }
    }
  );

  app.delete<{ Params: { platform: string } }>(
    "/api/user/platform-credentials/:platform",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to disconnect a platform account." };
      }

      const deleted = await deleteUserPlatformCredential(userId, req.params.platform);
      if (!deleted) {
        reply.status(404);
        return { error: "No credential stored for that platform." };
      }

      return { success: true, message: "Platform account disconnected." };
    }
  );
}
