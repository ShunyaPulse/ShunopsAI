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
import {
  McpHttpClient,
  allowMcpEndpoint,
  assertAllowedMcpUrl,
  isBuiltInMcpEndpoint,
  KNOWN_ALLOWED_MCP_HOSTS,
} from "../../agent/mcp/client.js";

/**
 * Tools the built-in sovereign `/api/mcp` server actually implements. It
 * advertises exactly what its `tools/call` branch can run: listing tools the
 * server cannot execute just makes the agent report phantom failures.
 */
const BUILT_IN_MCP_TOOLS = [
  {
    name: "execute_sandboxed_code",
    description: "Secure isolated in-memory V8 code execution sandbox (no host filesystem or network)",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["code"],
    },
  },
  {
    name: "calculate_math_expression",
    description: "Arithmetic expression solver, evaluated inside the isolated sandbox",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
];

/**
 * One message shape for every MCP URL refusal, so the panel, the probe and the
 * registry all explain the same policy instead of three near-miss variants.
 */
function mcpPolicyHint(err: unknown): string {
  const message = err instanceof Error ? err.message : "invalid MCP server URL";
  return `${message} Public MCP hosts must be listed in ALLOWED_MCP_HOSTS; loopback and private addresses are only reachable in a development run.`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Execute one built-in sovereign tool. Both tools run inside the same isolated
 * V8 sandbox the agent's native tool uses, so a caller cannot reach the host.
 */
async function callBuiltInMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const { executeInSandbox } = await import("../../agent/sandbox/runner.js");

  if (name === "execute_sandboxed_code") {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) {
      return { text: "Refused: 'code' is required.", isError: true };
    }
    const res = await executeInSandbox(code, { timeoutMs: Number(args.timeoutMs) });
    if (!res.success) {
      return { text: `Execution failed in ${res.executionTimeMs}ms: ${res.error}`, isError: true };
    }
    const output = [
      `Executed in ${res.executionTimeMs}ms.`,
      res.result !== null ? `Return value: ${safeStringify(res.result)}` : "",
      res.logs.length > 0 ? `Console output:\n${res.logs.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { text: output || "Executed successfully with no output.", isError: false };
  }

  if (name === "calculate_math_expression") {
    const expression = typeof args.expression === "string" ? args.expression : "";
    // Only arithmetic reaches the sandbox: no identifiers, calls, or member
    // access, so this stays a calculator rather than an eval channel.
    const compact = expression.replace(/\s+/g, "");
    if (!compact || !/^[0-9+\-*/().,%eE]+$/.test(compact)) {
      return {
        text: "Refused: the expression may only contain digits and the operators + - * / ( ) . % and e.",
        isError: true,
      };
    }
    const res = await executeInSandbox(`return (${compact});`);
    const value = res.success ? res.result : undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        text: `Could not evaluate that expression${res.error ? `: ${res.error}` : "."}`,
        isError: true,
      };
    }
    return { text: String(value), isError: false };
  }

  return { text: `Unknown tool: ${name || "(missing name)"}`, isError: true };
}

/**
 * MCP credentials are only useful if the run-time registry is allowed to call
 * them, and the registry refuses any endpoint that fails the shared outbound
 * URL policy. Reject it at connect time so the panel can never show a green
 * "connected" row for a server the agent could never reach.
 */
function mcpCredentialRejection(platform: string, values: Record<string, unknown>): string | null {
  if (platform !== "mcp" && platform !== "local_bridge" && !platform.startsWith("mcp:")) {
    return null;
  }

  const candidate = [values.serverUrl, values.bridgeUrl].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (!candidate) return null; // A missing URL is reported by the required-field check.
  if (isBuiltInMcpEndpoint(candidate)) return null;

  try {
    assertAllowedMcpUrl(candidate);
    return null;
  } catch (err) {
    return `That MCP endpoint cannot be used: ${mcpPolicyHint(err)}`;
  }
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
        return {
          success: false,
          connected: false,
          error: mcpPolicyHint(err),
        };
      }

      const testUrl = new URL(matchedEndpoint);
      const testHost = testUrl.hostname.toLowerCase();
      const matchedTestHost = KNOWN_ALLOWED_MCP_HOSTS.find((h) => h === testHost);
      if (!matchedTestHost) {
        const customHosts = (process.env.ALLOWED_MCP_HOSTS || "")
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean);
        if (!customHosts.includes(testHost)) {
          reply.status(400);
          return {
            success: false,
            connected: false,
            error: `Disallowed MCP host: ${testUrl.hostname}`,
          };
        }
      }

      const safePort = testUrl.port ? `:${testUrl.port}` : "";
      const safeProtocol = testUrl.protocol === "http:" ? "http:" : "https:";
      const safeOrigin = `${safeProtocol}//${matchedTestHost || testHost}${safePort}`;
      const safeTestEndpoint = new URL(`${testUrl.pathname}${testUrl.search}`, safeOrigin).href;

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

  // 6c. ShunopsAI Sovereign Built-in MCP JSON-RPC Server.
  // Authenticated like every other /api route, and it answers `tools/call` for
  // the tools it lists instead of advertising tools that cannot be executed.
  app.post<{ Body: { jsonrpc?: string; id?: any; method?: string; params?: any } }>(
    "/api/mcp",
    { preHandler: [requireAuth] },
    async (req) => {
      const { id, method, params } = req.body || {};
      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: id || 1,
          result: {
            tools: BUILT_IN_MCP_TOOLS.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        };
      }

      if (method === "tools/call") {
        const toolName = typeof params?.name === "string" ? params.name : "";
        const args = (
          params?.arguments && typeof params.arguments === "object" ? params.arguments : {}
        ) as Record<string, unknown>;
        const outcome = await callBuiltInMcpTool(toolName, args);
        return {
          jsonrpc: "2.0",
          id: id || 1,
          result: { content: [{ type: "text", text: outcome.text }], isError: outcome.isError },
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
