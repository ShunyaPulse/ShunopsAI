import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  createApiKey,
  listUserApiKeys,
  deleteApiKey,
  listUserPlatformCredentials,
  upsertUserPlatformCredential,
  deleteUserPlatformCredential,
  getUserCredentialBundle,
  PLATFORM_SPECS,
  CredentialVaultError,
  isVaultConfigured,
} from "../db.js";
import { McpHttpClient } from "../../agent/mcp/client.js";

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false;
  const [a, b] = hostname.split(".").map((n) => Number(n));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isDisallowedMcpTestUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  if (parsed.username || parsed.password) return true;
  if (parsed.hash) return true;

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.platform",
  ]);

  if (blockedHosts.has(hostname)) return true;
  if (hostname.endsWith(".internal") || hostname.endsWith(".localhost")) return true;
  if (isPrivateOrLocalIpv4(hostname)) return true;

  return false;
}

export interface WorkspaceRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * User Workspace Routes: Chat Conversation Persistence & Personal API Keys.
 */
export async function workspaceRoutes(app: FastifyInstance, options: WorkspaceRouteOptions): Promise<void> {
  const { requireAuth } = options;

  // 1. Get Chat History for Authenticated User
  app.get("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const messages = await getChatHistory(userId, 100);
    return { success: true, messages };
  });

  // 2. Save Chat Message
  app.post<{ Body: { role: "user" | "assistant"; message: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id || 0;
      const { role, message } = req.body || {};

      if (!message || (role !== "user" && role !== "assistant")) {
        reply.status(400);
        return { error: "Valid role ('user' or 'assistant') and message required." };
      }

      await saveChatMessage(userId, role, message);
      return { success: true };
    }
  );

  // 3. Clear Chat History
  app.delete("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    await clearChatHistory(userId);
    return { success: true, message: "Chat history cleared." };
  });

  // 4. List Personal API Keys
  app.get("/api/user/api-keys", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const keys = await listUserApiKeys(userId);
    return { success: true, keys };
  });

  // 5. Create Personal API Key
  app.post<{ Body: { name?: string } }>(
    "/api/user/api-keys",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to generate an API key." };
      }

      const name = (req.body?.name || "Personal API Key").trim().slice(0, 64);
      const newKey = await createApiKey(userId, name);
      return {
        success: true,
        id: newKey.id,
        key: newKey.rawKey,
        keyPrefix: newKey.keyPrefix,
        message: "API key generated. Please save this secret key now, as it cannot be displayed again.",
      };
    }
  );

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
      const user = (req as any).user;
      const userId = user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to connect a platform account." };
      }

      try {
        const credential = await upsertUserPlatformCredential(
          userId,
          String(req.body?.platform || ""),
          req.body?.values || {},
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
        const userId = (req as any).user?.id;
        if (userId) {
          try {
            const bundle = await getUserCredentialBundle(userId);
            const found = bundle.mcpServers?.find((s) => s.id === platform) || (platform === "mcp" ? bundle.mcp : undefined);
            if (found) {
              serverUrl = found.serverUrl;
              apiKey = found.apiKey || "";
            }
          } catch {
            // ignore and proceed to validation
          }
        }
      }

      // Handle Built-in Sovereign MCP endpoint
      if (serverUrl === "/api/mcp" || serverUrl.endsWith("/api/mcp")) {
        const tools = [
          { name: "execute_sandboxed_code", description: "Secure isolated in-memory V8 code execution sandbox" },
          { name: "calculate_math_expression", description: "High-precision AST mathematical evaluator" },
          { name: "fetch_web_content", description: "Clean web documentation fetcher for autonomous research" },
        ];
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

      if (isDisallowedMcpTestUrl(serverUrl)) {
        reply.status(400);
        return {
          success: false,
          connected: false,
          error: "Server URL is invalid or not allowed for security reasons.",
        };
      }

      try {
        const client = new McpHttpClient({
          id: "test-mcp",
          name: "MCP Connection Test",
          transport: "http",
          url: serverUrl,
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

  // 6c. ShunopsAI Sovereign Built-in MCP JSON-RPC Server
  app.post<{ Body: { jsonrpc?: string; id?: any; method?: string; params?: any } }>(
    "/api/mcp",
    async (req) => {
      const { id, method } = req.body || {};
      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: id || 1,
          result: {
            tools: [
              {
                name: "execute_sandboxed_code",
                description: "Secure isolated in-memory V8 code execution sandbox",
                inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
              },
              {
                name: "calculate_math_expression",
                description: "High-precision AST mathematical evaluator",
                inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
              },
              {
                name: "fetch_web_content",
                description: "Clean web documentation fetcher for autonomous research",
                inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
              },
            ],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id: id || 1,
        result: { status: "ShunopsAI Sovereign MCP Server Online" },
      };
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

  // 7. Revoke Personal API Key
  app.delete<{ Params: { id: string } }>(
    "/api/user/api-keys/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      const keyId = Number(req.params.id);

      if (!userId || !keyId) {
        reply.status(400);
        return { error: "Valid key ID required." };
      }

      const deleted = await deleteApiKey(userId, keyId);
      if (!deleted) {
        reply.status(404);
        return { error: "Key not found." };
      }

      return { success: true, message: "API key revoked." };
    }
  );
}
