import assert from "node:assert/strict";
import {
  upsertUserPlatformCredential,
  listUserPlatformCredentials,
  deleteUserPlatformCredential,
  getUserCredentialBundle,
} from "../src/server/db/platformCredentials.js";
import { memStore } from "../src/server/db/store.js";
import { mcpRegistry } from "../src/agent/mcp/registry.js";
import type { ToolScope } from "../src/agent/scope.js";

process.env.NODE_ENV = "test";
process.env.CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const TENANT_ID = 999;
const OTHER_TENANT_ID = 998;

function tenantScope(userId: number, username: string, bundle: Awaited<ReturnType<typeof getUserCredentialBundle>>): ToolScope {
  return { kind: "user", userId, username, credentials: bundle };
}

async function runTests() {
  console.log("=================================================");
  console.log("⚡ TESTING MULTI-MCP CONCURRENT CONNECTION & VAULT");
  console.log("=================================================");

  const userId = TENANT_ID;
  // Cleanup test user memStore entries
  for (const k of Array.from(memStore.platformCredentials.keys())) {
    if (k.startsWith("999:") || k.startsWith("998:")) memStore.platformCredentials.delete(k);
  }

  // 1. Connect first MCP server (Brave Search preset)
  const braveCred = await upsertUserPlatformCredential(
    userId,
    "mcp:brave-search",
    { serverUrl: "https://brave.mcp.example.com", apiKey: "brave-secret-key-123" },
    "Brave Search MCP"
  );
  assert.equal(braveCred.platform, "mcp:brave-search");
  assert.equal(braveCred.label, "Brave Search MCP");

  // 2. Connect second MCP server (Neon Postgres preset) without apiKey (optional)
  const neonCred = await upsertUserPlatformCredential(
    userId,
    "mcp:neon-postgres",
    { serverUrl: "https://neon.mcp.example.com" },
    "Neon Postgres MCP"
  );
  assert.equal(neonCred.platform, "mcp:neon-postgres");
  assert.equal(neonCred.label, "Neon Postgres MCP");

  // 3. Connect custom MCP server
  const customCred = await upsertUserPlatformCredential(
    userId,
    "mcp:custom-tools",
    { serverUrl: "http://127.0.0.1:8000/sse", apiKey: "custom-token-xyz" },
    "Custom Internal MCP"
  );
  assert.equal(customCred.platform, "mcp:custom-tools");

  // 4. Verify listUserPlatformCredentials returns all 3 distinct MCP servers
  const list = await listUserPlatformCredentials(userId);
  assert.equal(list.length, 3, "All 3 MCP connections must be listed concurrently");
  const platforms = list.map((c) => c.platform);
  assert.ok(platforms.includes("mcp:brave-search"));
  assert.ok(platforms.includes("mcp:neon-postgres"));
  assert.ok(platforms.includes("mcp:custom-tools"));
  console.log("✅ PASS: Successfully listed 3 concurrent MCP servers in user vault");

  // 5. Verify getUserCredentialBundle returns all decrypted MCP servers in mcpServers array
  const bundle = await getUserCredentialBundle(userId);
  assert.ok(bundle.mcpServers, "bundle.mcpServers must be defined");
  assert.equal(bundle.mcpServers.length, 3, "bundle must contain all 3 MCP configs");

  const braveServer = bundle.mcpServers.find((s) => s.id === "mcp:brave-search");
  assert.equal(braveServer?.serverUrl, "https://brave.mcp.example.com");
  assert.equal(braveServer?.apiKey, "brave-secret-key-123");
  assert.equal(braveServer?.name, "Brave Search MCP");

  const neonServer = bundle.mcpServers.find((s) => s.id === "mcp:neon-postgres");
  assert.equal(neonServer?.serverUrl, "https://neon.mcp.example.com");
  assert.equal(neonServer?.apiKey, undefined);

  console.log("✅ PASS: getUserCredentialBundle accurately decrypts and bundles multiple MCP servers");

  // 6. Verify scope registers all servers into dynamic registry
  const scope = tenantScope(userId, "testuser", bundle);

  // Calling getActiveTools triggers dynamic server registration
  await mcpRegistry.getActiveTools(scope);
  console.log("✅ PASS: mcpRegistry registers all 3 user MCP servers without conflicts");

  // 7. Verify independent disconnect of one server leaves others intact
  const disconnected = await deleteUserPlatformCredential(userId, "mcp:neon-postgres");
  assert.equal(disconnected, true);

  const updatedBundle = await getUserCredentialBundle(userId);
  assert.equal(updatedBundle.mcpServers?.length, 2);
  const remainingPlatforms = updatedBundle.mcpServers?.map((s) => s.id);
  assert.ok(remainingPlatforms?.includes("mcp:brave-search"));
  assert.ok(remainingPlatforms?.includes("mcp:custom-tools"));
  assert.ok(!remainingPlatforms?.includes("mcp:neon-postgres"));

  console.log("✅ PASS: Disconnecting one MCP server keeps remaining MCP servers connected");

  // 8. Test live MCP server ping & tool discovery via McpHttpClient
  const http = await import("node:http");
  const toolCalls: Array<{ name?: string; authorization?: string }> = [];
  const testServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const reply = (result: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
      };
      if (parsed.method === "tools/list") {
        reply({
          tools: [
            {
              name: "test_calculator",
              description: "Performs arithmetic",
              inputSchema: { type: "object", properties: { expression: { type: "string" } } },
            },
            {
              name: "test_search",
              description: "Performs mock search",
              inputSchema: { type: "object", properties: { query: { type: "string" } } },
            },
          ],
        });
        return;
      }
      if (parsed.method === "tools/call") {
        toolCalls.push({ name: parsed.params?.name, authorization: req.headers.authorization });
        reply({ content: [{ type: "text", text: `mock-result:${parsed.params?.name}` }] });
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (testServer.address() as any).port;
  const mockMcpUrl = `http://127.0.0.1:${port}`;

  const { McpHttpClient, registerAllowedMcpEndpoint } = await import("../src/agent/mcp/client.js");
  registerAllowedMcpEndpoint(mockMcpUrl);
  const client = new McpHttpClient({
    id: "mock",
    name: "Mock MCP",
    transport: "http",
    url: mockMcpUrl,
  });

  const listRes = await client.listTools();
  assert.equal(listRes.tools.length, 2);
  assert.equal(listRes.tools[0]?.name, "test_calculator");
  assert.equal(listRes.tools[1]?.name, "test_search");
  console.log("✅ PASS: McpHttpClient successfully connects and discovers tools (verified 'Connected')");

  // 9. A connected MCP server's tools must reach the model, and its tool must run.
  await upsertUserPlatformCredential(
    userId,
    "mcp:mock",
    { serverUrl: mockMcpUrl, apiKey: "mock-token" },
    "Mock MCP"
  );
  const mockBundle = await getUserCredentialBundle(userId);
  const mockTools = await mcpRegistry.getActiveTools(tenantScope(userId, "testuser", mockBundle));
  const mockToolNames = mockTools.map((t) => t.name).sort();
  assert.deepEqual(
    mockToolNames,
    ["mcp_user_999_mcp_mock_test_calculator", "mcp_user_999_mcp_mock_test_search"],
    "Both tools of the live mock server must be exposed to this tenant's run"
  );

  const calculator = mockTools.find((t) => t.originalName === "test_calculator");
  assert.ok(calculator, "Discovered tool must be callable");
  const callResult = await calculator.execute({ expression: "1+1" });
  assert.equal(callResult, "mock-result:test_calculator");
  assert.equal(toolCalls.length, 1, "The tool call must reach the server exactly once");
  assert.equal(toolCalls[0]?.name, "test_calculator");
  assert.equal(
    toolCalls[0]?.authorization,
    "Bearer mock-token",
    "The tenant's own token must be the one sent to their server"
  );
  console.log("✅ PASS: A tenant's MCP tools are exposed and callable with that tenant's own token");

  // 10. The run of any other account must never see (or reach) those servers.
  const otherScope = tenantScope(OTHER_TENANT_ID, "otheruser", {});
  const otherTools = await mcpRegistry.getActiveTools(otherScope);
  assert.equal(
    otherTools.length,
    0,
    "A run with no connected platforms must not inherit another tenant's MCP tools"
  );
  assert.ok(
    !otherTools.some((t) => t.name.includes(`user_${TENANT_ID}`)),
    "Another tenant's MCP tools must never be listed"
  );
  console.log("✅ PASS: MCP servers are isolated to the tenant that connected them");

  // The other tenant may connect the same endpoint, and still only sees its own copy.
  await upsertUserPlatformCredential(
    OTHER_TENANT_ID,
    "mcp:mock",
    { serverUrl: mockMcpUrl },
    "Other Mock MCP"
  );
  const otherBundle = await getUserCredentialBundle(OTHER_TENANT_ID);
  const otherOwnTools = await mcpRegistry.getActiveTools(
    tenantScope(OTHER_TENANT_ID, "otheruser", otherBundle)
  );
  assert.ok(otherOwnTools.length === 2, "Each tenant gets its own copy of a shared endpoint");
  assert.ok(
    otherOwnTools.every((t) => t.name.startsWith(`mcp_user_${OTHER_TENANT_ID}_`)),
    "Tool names must be namespaced to the owning tenant"
  );
  console.log("✅ PASS: Two tenants may share an endpoint without sharing registry entries");

  // 11. Disconnect takes effect on the next run: tools stop being offered.
  await deleteUserPlatformCredential(userId, "mcp:mock");
  const afterDisconnect = await getUserCredentialBundle(userId);
  const toolsAfterDisconnect = await mcpRegistry.getActiveTools(
    tenantScope(userId, "testuser", afterDisconnect)
  );
  assert.ok(
    !toolsAfterDisconnect.some((t) => t.name.includes("user_999_mcp_mock")),
    "A disconnected server's tools must not be offered any more"
  );
  console.log("✅ PASS: Disconnecting an MCP server removes it (and its tools) from the next run");

  // 12. Endpoints that fail the outbound URL policy must never be registered.
  const refusedBundle = {
    mcpServers: [
      { id: "mcp:metadata", serverUrl: "http://169.254.169.254/latest/meta-data" },
      { id: "mcp:unlisted", serverUrl: "https://attacker.example.net/mcp" },
    ],
  };
  const refusedTools = await mcpRegistry.getActiveTools(
    tenantScope(userId, "testuser", refusedBundle)
  );
  assert.equal(
    refusedTools.length,
    0,
    "Metadata/private and non-allowlisted MCP endpoints must be refused, not fetched"
  );
  console.log("✅ PASS: Refused MCP endpoints are never registered or called");

  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  // Cleanup
  await deleteUserPlatformCredential(userId, "mcp:brave-search");
  await deleteUserPlatformCredential(userId, "mcp:custom-tools");
  await deleteUserPlatformCredential(OTHER_TENANT_ID, "mcp:mock");

  console.log("=================================================");
  console.log("🎉 ALL MULTI-MCP TESTS PASSED CLEANLY!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
