/**
 * Multi-tenant isolation suite.
 *
 * Acceptance criteria under test:
 *  1. A user-scoped agent run can never reach host-level tools (shell, files,
 *     gcloud/SSH, wrangler, shared GPU pipeline, operator infra).
 *  2. It uses the caller's OWN platform credentials, and when the caller has not
 *     connected a platform it is REFUSED — never silently substituted with the
 *     server operator's credentials.
 *  3. Approval requests raised by a run are visible only to the owning account,
 *     and only that account (or an operator) can settle them.
 *
 * The suite forces the in-memory store (no DATABASE_URL) so it is hermetic and
 * never touches a real database or provider API.
 */

// Hermetic: in-memory persistence + a fixed vault key for this process only.
delete process.env.DATABASE_URL;
process.env.CREDENTIALS_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import assert from "node:assert/strict";
import { memStore } from "../src/server/db/store.js";
import {
  CredentialVaultError,
  deleteUserPlatformCredential,
  getUserCredentialBundle,
  listUserPlatformCredentials,
  upsertUserPlatformCredential,
} from "../src/server/db.js";
import { toolRegistry } from "../src/agent/index.js";
import {
  adminScope,
  allowedToolsForScope,
  toolTier,
  userScope,
} from "../src/agent/scope.js";
import { listPendingApprovals, requestHumanApproval, resolveApproval } from "../src/tools/safety.js";
import { buildRequestScope, isAdminUser, tenantUserId } from "../src/server/scope.js";
import { getUserWorkspaceHtml } from "../src/dashboard/workspace.js";

const SECRET_NEON = "postgresql://alice:sup3rsecret@127.0.0.1:9/alicedb";
const HOST_TOOLS = [
  "run_shell_command",
  "read_file",
  "write_file",
  "list_directory",
  "manage_cloud_run",
  "manage_compute_engine",
  "manage_cloudflare",
  "sentinel_health_check",
  "auto_heal_service",
  "resolve_code_scanning_alerts",
  "produce_video",
  "manage_kaggle",
  "publish_to_youtube",
  "index_knowledge_document",
];
const PLATFORM_TOOLS = ["execute_neon_sql", "execute_redis_command", "manage_github", "run_cloudflare_ai"];

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    failures.push(name);
    console.log(`❌ FAIL: ${name}`);
    console.log(`     ${err?.message ?? err}`);
  }
}

async function runSuite(): Promise<void> {
  console.log("=================================================");
  console.log("🔐 MULTI-TENANT ISOLATION SUITE");
  console.log("=================================================\n");

  // ---- 1. Tool tiers -------------------------------------------------------
  await check("host-tier tools are never exposed to a user scope", () => {
    const allowed = allowedToolsForScope(userScope(1, "alice"));
    for (const name of HOST_TOOLS) {
      assert.ok(!allowed.has(name as any), `${name} must not be offered to a user scope`);
      assert.equal(toolTier(name as any), "host");
    }
  });

  await check("user scope keeps the 4 platform tools + safe tools only", () => {
    const allowed = allowedToolsForScope(userScope(1, "alice"));
    const total = Object.keys(toolRegistry).length;
    assert.equal(allowed.size, total - HOST_TOOLS.length);
    for (const name of PLATFORM_TOOLS) {
      assert.ok(allowed.has(name as any), `${name} must remain available for the user's own account`);
    }
  });

  await check("operator scope keeps the complete toolset", () => {
    const allowed = allowedToolsForScope(adminScope());
    assert.equal(allowed.size, Object.keys(toolRegistry).length);
  });

  // ---- 2. Registry-wide enforcement ---------------------------------------
  await check("shell tool refuses to run for a user scope", async () => {
    const result = await toolRegistry.run_shell_command.execute(
      { command: "echo MULTITENANT_LEAK" },
      userScope(1, "alice")
    );
    assert.ok(result.startsWith("Refused:"), `expected a refusal, got: ${result}`);
    assert.ok(!result.includes("MULTITENANT_LEAK"), "shell must not execute for a user scope");
  });

  await check("filesystem tool refuses for a user scope", async () => {
    const result = await toolRegistry.read_file.execute({ path: "package.json" }, userScope(1, "alice"));
    assert.ok(result.startsWith("Refused:"), `expected a refusal, got: ${result}`);
  });

  await check("knowledge-base writes stay operator-only", async () => {
    const result = await toolRegistry.index_knowledge_document.execute(
      { title: "t", content: "c" },
      userScope(1, "alice")
    );
    assert.ok(result.startsWith("Refused:"), `expected a refusal, got: ${result}`);
  });

  // ---- 3. Fail-closed platform credentials --------------------------------
  await check("neon tool is refused when the account has no connection", async () => {
    const result = await toolRegistry.execute_neon_sql.execute({ query: "select 1" }, userScope(1, "alice"));
    assert.ok(result.startsWith("Refused:"), result);
    assert.ok(result.includes("no Neon Postgres credential connected"), result);
  });

  await check("redis tool is refused when the account has no connection", async () => {
    const result = await toolRegistry.execute_redis_command.execute(
      { command: "PING" },
      userScope(1, "alice")
    );
    assert.ok(result.includes("no Redis credential connected"), result);
  });

  await check("github tool is refused when the account has no token", async () => {
    const result = await toolRegistry.manage_github.execute(
      { operation: "list_issues", repo: "octocat/hello-world" },
      userScope(1, "alice")
    );
    assert.ok(result.includes("no GitHub credential connected"), result);
  });

  await check("cloudflare AI tool is refused when the account has no token", async () => {
    const result = await toolRegistry.run_cloudflare_ai.execute({ prompt: "hi" }, userScope(1, "alice"));
    assert.ok(result.includes("no Cloudflare credential connected"), result);
  });

  await check("neon tool uses the caller's connection string, never the server's", async () => {
    const scope = userScope(7, "dave", {
      neon: { connectionString: "postgresql://dave:pw@127.0.0.1:9/davedb" },
    });
    const result = await toolRegistry.execute_neon_sql.execute({ query: "select 1" }, scope);
    assert.ok(!result.startsWith("Refused:"), `must not refuse once connected: ${result}`);
    assert.ok(
      !result.includes("Neither DATABASE_URL"),
      "must never fall back to server-side database credentials"
    );
  });

  // ---- 4. Credential vault ------------------------------------------------
  await check("vault stores the secret encrypted and returns only a masked hint", async () => {
    const summary = await upsertUserPlatformCredential(1, "neon", { connectionString: SECRET_NEON });
    assert.equal(summary.platform, "neon");
    assert.ok(summary.hint.startsWith("••••"), summary.hint);
    assert.ok(!summary.hint.includes("sup3rsecret"), "hint must not leak the secret");

    const row = memStore.platformCredentials.get("1:neon");
    assert.ok(row, "credential must be persisted");
    assert.ok(!row!.payload.includes("sup3rsecret"), "stored payload must be ciphertext");
    const listed = JSON.stringify(await listUserPlatformCredentials(1));
    assert.ok(!listed.includes("sup3rsecret"), "listing must never expose the secret");
  });

  await check("decrypted bundle is available to the owner and nobody else", async () => {
    assert.equal((await getUserCredentialBundle(1)).neon?.connectionString, SECRET_NEON);
    assert.equal((await getUserCredentialBundle(2)).neon, undefined, "another tenant must not decrypt it");
  });

  await check("vault rejects incomplete fields and unknown platforms", async () => {
    await assert.rejects(
      () => upsertUserPlatformCredential(1, "neon", { connectionString: "   " }),
      (err: any) => err instanceof CredentialVaultError
    );
    await assert.rejects(
      () => upsertUserPlatformCredential(1, "cloudflare", { accountId: "abc" }),
      (err: any) => err instanceof CredentialVaultError
    );
    await assert.rejects(
      () => upsertUserPlatformCredential(1, "kubernetes", { kubeconfig: "x" }),
      (err: any) => err instanceof CredentialVaultError
    );
  });

  await check("disconnecting removes the credential", async () => {
    assert.equal(await deleteUserPlatformCredential(1, "neon"), true);
    assert.equal(await deleteUserPlatformCredential(1, "neon"), false);
    assert.equal((await getUserCredentialBundle(1)).neon, undefined);
  });

  // ---- 5. Per-user approval routing --------------------------------------
  await check("an approval is visible only to the owning account", async () => {
    const promise = requestHumanApproval("Tool: execute_neon_sql", "DROP TABLE orders;", "destructive", {
      userId: 11,
      username: "alice",
    });

    const mine = listPendingApprovals(11);
    assert.equal(mine.length, 1, "the owner must see exactly their own request");
    assert.equal(mine[0]!.username, "alice");
    assert.equal(listPendingApprovals(12).length, 0, "another account must not see it");

    assert.equal(
      resolveApproval(mine[0]!.id, true, { userId: 12 }),
      false,
      "another account must not be able to approve it"
    );
    assert.equal(listPendingApprovals(11).length, 1, "the request must still be pending");

    assert.equal(resolveApproval(mine[0]!.id, true, { userId: 11 }), true, "the owner may approve it");
    assert.equal((await promise).approved, true);
    assert.equal(listPendingApprovals(11).length, 0);
  });

  await check("operator requests stay out of tenant queues", async () => {
    const promise = requestHumanApproval("Tool: run_shell_command", "rm -rf /tmp/x", "destructive op");
    assert.equal(listPendingApprovals(11).length, 0, "a tenant must not see operator requests");

    const all = listPendingApprovals();
    assert.ok(all.length >= 1, "operator scope sees the full queue");
    assert.equal(resolveApproval(all[0]!.id, false), true, "operator scope keeps admin power");
    assert.equal((await promise).approved, false);
  });

  // ---- 6. Request scope builder ------------------------------------------
  await check("a tenant scope carries only the tenant's own credentials", async () => {
    await upsertUserPlatformCredential(21, "github", { token: "ghp_tenanttoken0123456789" });
    const scope = await buildRequestScope({ id: 21, username: "bob", role: "user" });
    assert.equal(scope.kind, "user");
    assert.equal(scope.userId, 21);
    assert.equal(scope.credentials.github?.token, "ghp_tenanttoken0123456789");
    assert.equal(scope.credentials.neon, undefined);
  });

  await check("operator callers and unconfigured tenants resolve safely", async () => {
    const admin = await buildRequestScope({ id: 0, username: "master_admin", role: "admin", isMaster: true });
    assert.equal(admin.kind, "admin");

    const bare = await buildRequestScope({ id: 33, username: "carol", role: "user" });
    assert.equal(bare.kind, "user");
    assert.deepEqual(bare.credentials, {}, "a tenant scope never inherits server credentials");

    assert.equal(isAdminUser({ role: "user" }), false);
    assert.equal(isAdminUser({ role: "admin" }), true);
    assert.equal(tenantUserId({ id: 0 }), 0);
  });

  // ---- 7. Workspace surface ----------------------------------------------
  await check("workspace renders the new panels and its inline script parses", () => {
    const html = getUserWorkspaceHtml("alice");
    assert.ok(html.includes("Platform Connections"), "connections panel missing");
    assert.ok(html.includes("task-goal-input"), "task runner missing");
    for (const fn of ["loadPlatformCredentials", "connectPlatformCredential", "runAutonomousTask", "pollTaskResult"]) {
      assert.ok(html.includes(fn), `${fn} missing from the inline script`);
    }

    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    assert.ok(scripts.length > 0, "expected an inline script");
    for (const script of scripts) {
      // Compiles only — a SyntaxError here means the template literal mangled it.
      new Function(script);
    }
  });
}

runSuite()
  .then(() => {
    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passed} Passed, ${failures.length} Failed.`);
    console.log("=================================================");
    if (failures.length > 0) {
      console.log("\nFailed:");
      for (const name of failures) console.log(`  - ${name}`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Suite crashed:", err);
    process.exit(1);
  });
