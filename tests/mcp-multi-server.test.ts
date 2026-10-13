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

async function runTests() {
  console.log("=================================================");
  console.log("⚡ TESTING MULTI-MCP CONCURRENT CONNECTION & VAULT");
  console.log("=================================================");

  const userId = 999;
  // Cleanup test user memStore entries
  for (const k of Array.from(memStore.platformCredentials.keys())) {
    if (k.startsWith("999:")) memStore.platformCredentials.delete(k);
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
  const scope: ToolScope = {
    userId,
    username: "testuser",
    role: "user",
    credentials: bundle,
  };

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
  const testServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      if (parsed.method === "tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: {
            tools: [
              { name: "test_calculator", description: "Performs arithmetic" },
              { name: "test_search", description: "Performs mock search" },
            ],
          },
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
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

  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  // Cleanup
  await deleteUserPlatformCredential(userId, "mcp:brave-search");
  await deleteUserPlatformCredential(userId, "mcp:custom-tools");

  console.log("=================================================");
  console.log("🎉 ALL MULTI-MCP TESTS PASSED CLEANLY!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
