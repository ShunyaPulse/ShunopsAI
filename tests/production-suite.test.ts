import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  initDatabaseSchema,
  runDatabaseMigrations,
  createUser,
  findUserByUsername,
  findUserByEmail,
  updateUserPassword,
  deleteUserAccount,
  exportUserData,
  createSession,
  findUserBySessionToken,
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  saveTaskRecord,
  getTaskRecord,
  listUserTasks,
  createApiKey,
  findUserByApiKey,
  listUserApiKeys,
  deleteApiKey,
  listAllUsers,
  updateUserRole,
  revokeAllUserSessions,
  getSystemUserStats,
  getUserUsageAndPlan,
  recordUserTokenUsage,
  incrementUserQueryCount,
  checkDbHealth,
} from "../src/server/db.js";
import {
  listPendingApprovals,
  resolveApproval,
  requestHumanApproval,
  isActionSensitive,
} from "../src/tools/safety.js";
import {
  generateShieldChallenge,
  verifyShieldSolution,
} from "../src/server/middleware/bot-shield.js";
import { getRedisClient, checkRedisHealth } from "../src/server/redis.js";
import { createApp, loadAppConfig } from "../src/server/app.js";
import {
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  isModelDegraded,
  getTiersHealthStatus,
  classifyHeuristic,
  getRoutingTargets,
  buildRollingMemory,
  toolRegistry,
} from "../src/agent/index.js";
import {
  indexKnowledgeDocument,
  searchKnowledgeHybrid,
  deleteKnowledgeDocument,
} from "../src/server/db.js";
import {
  isKokoroAvailable,
  resolveKokoroVoice,
} from "../src/tools/kokoro-tts.js";

async function runSuite() {
  console.log("=================================================");
  console.log("🧪 SHUNOPSAI PRODUCTION ARCHITECTURE TEST SUITE");
  console.log("=================================================\n");

  let testsPassed = 0;
  let testsFailed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      testsPassed++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      testsFailed++;
    }
  }

  // 1. Versioned Database Schema Migrations
  await test("Database Schema: Versioned migrations execute and report current version", async () => {
    const migrationResult = await runDatabaseMigrations();
    assert.ok(migrationResult.currentVersion >= 5, "Expected migration version >= 5");
  });

  // 2. Account Lifecycle & Authentication
  await test("Account Lifecycle: Create user, hash password, and authenticate session", async () => {
    const testUsername = `user_${Date.now()}`;
    const testEmail = `${testUsername}@shunopsai.test`;
    const passwordHash = await bcrypt.hash("InitialPassword123!", 10);

    const user = await createUser(testUsername, passwordHash, testEmail, true);
    assert.equal(user.username, testUsername);
    assert.equal(user.email, testEmail);

    // Verify session creation and lookup
    const sessionToken = `test_token_${Date.now()}`;
    await createSession(user.id, sessionToken, 1);
    const sessionUser = await findUserBySessionToken(sessionToken);
    assert.ok(sessionUser, "Session should be found");
    assert.equal(sessionUser?.id, user.id);

    // Change password
    const newPasswordHash = await bcrypt.hash("UpdatedPassword456!", 10);
    const pwUpdated = await updateUserPassword(user.id, newPasswordHash);
    assert.ok(pwUpdated, "Password should update");

    // Export user data
    const exported = await exportUserData(user.id);
    assert.ok(exported?.profile, "Exported data must include profile");
    assert.equal(exported.profile.username, testUsername);

    // Clean up / Delete user
    const deleted = await deleteUserAccount(user.id);
    assert.ok(deleted, "User account should be deleted");
    const afterDelete = await findUserByUsername(testUsername);
    assert.equal(afterDelete, null, "User should no longer exist");
  });

  // 3. Conversation Persistence
  await test("Conversation Persistence: Save, retrieve, and clear chat messages per user", async () => {
    const user = await createUser(`chat_user_${Date.now()}`, null, undefined, false);
    await saveChatMessage(user.id, "user", "Hello assistant, how are you?");
    await saveChatMessage(user.id, "assistant", "I am running nominal. All systems nominal.");

    const history = await getChatHistory(user.id);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, "user");
    assert.equal(history[1]?.role, "assistant");

    await clearChatHistory(user.id);
    const cleared = await getChatHistory(user.id);
    assert.equal(cleared.length, 0);

    await deleteUserAccount(user.id);
  });

  // 4. Multi-Tenant Task Isolation
  await test("Task Isolation: User tasks are scoped by user_id and isolated", async () => {
    const userA = await createUser(`user_a_${Date.now()}`, null);
    const userB = await createUser(`user_b_${Date.now()}`, null);

    const taskIdA = `task_${Date.now()}_a`;
    const taskIdB = `task_${Date.now()}_b`;

    await saveTaskRecord({
      id: taskIdA,
      userId: userA.id,
      goal: "Deploy container service",
      status: "COMPLETED",
      finalAnswer: "Container deployed successfully.",
    });

    await saveTaskRecord({
      id: taskIdB,
      userId: userB.id,
      goal: "Run security audit",
      status: "COMPLETED",
      finalAnswer: "0 vulnerabilities found.",
    });

    const tasksA = await listUserTasks(userA.id);
    const tasksB = await listUserTasks(userB.id);

    assert.ok(tasksA.some((t) => t.id === taskIdA));
    assert.ok(!tasksA.some((t) => t.id === taskIdB), "User A must NOT see User B's task");

    assert.ok(tasksB.some((t) => t.id === taskIdB));
    assert.ok(!tasksB.some((t) => t.id === taskIdA), "User B must NOT see User A's task");

    await deleteUserAccount(userA.id);
    await deleteUserAccount(userB.id);
  });

  // 5. Personal API Keys
  await test("Personal API Keys: Create, authenticate with shun_ prefix, list, and revoke", async () => {
    const user = await createUser(`key_user_${Date.now()}`, null);
    const apiKey = await createApiKey(user.id, "Automated n8n Key");

    assert.ok(apiKey.rawKey.startsWith("shun_"), "Key must start with shun_");

    const foundUser = await findUserByApiKey(apiKey.rawKey);
    assert.ok(foundUser, "User should be found by personal API key");
    assert.equal(foundUser?.id, user.id);

    const keysList = await listUserApiKeys(user.id);
    assert.equal(keysList.length, 1);

    await deleteApiKey(user.id, apiKey.id);
    const afterRevoke = await findUserByApiKey(apiKey.rawKey);
    assert.equal(afterRevoke, null, "Revoked key must not authenticate");

    await deleteUserAccount(user.id);
  });

  // 6. Human-in-the-Loop Approvals Queue
  await test("Approvals Queue: Sensitive actions detect risk and can be resolved remotely", async () => {
    const sensitive = isActionSensitive("rm -rf /var/data && drop table users");
    assert.ok(sensitive.isSensitive, "Dangerous command must be marked sensitive");

    // Simulate async approval in background
    let resolved = false;
    const approvalPromise = requestHumanApproval(
      "DROP TABLE",
      "DROP TABLE production_sessions;",
      "Sensitive database wipe"
    );

    const pending = listPendingApprovals();
    assert.ok(pending.length > 0, "Approval request must appear in pending queue");
    const reqId = pending[0]?.id;

    assert.ok(reqId, "Expected valid approval request ID");
    const success = resolveApproval(reqId!, true);
    assert.ok(success, "Approval resolution should succeed");

    const result = await approvalPromise;
    assert.equal(result.approved, true, "Promise must resolve as approved");
  });

  // 7. Modern Token Metering & Quotas
  await test("Billing & Metering: Track token quotas and record input/output token usage", async () => {
    const user = await createUser(`billing_user_${Date.now()}`, null);
    const usage = await getUserUsageAndPlan(user.id);
    assert.equal(usage.plan, "community");
    assert.equal(usage.tokenLimit, 1500000);

    const tokenRecord = await recordUserTokenUsage(user.id, 120, 80);
    assert.equal(tokenRecord.allowed, true);
    assert.equal(tokenRecord.inputTokens, 120);
    assert.equal(tokenRecord.outputTokens, 80);
    assert.equal(tokenRecord.totalTokens, 200);
    assert.equal(tokenRecord.queryCount, 1);

    await deleteUserAccount(user.id);
  });

  // 8. Admin Console Governance
  await test("Admin Governance: List users, update roles, revoke sessions, and get stats", async () => {
    const user = await createUser(`admin_target_${Date.now()}`, null);
    assert.equal(user.role, "user");

    const promoted = await updateUserRole(user.id, "admin");
    assert.ok(promoted, "Role promotion should succeed");

    const refreshed = await findUserByUsername(user.username);
    assert.equal(refreshed?.role, "admin");

    const stats = await getSystemUserStats();
    assert.ok(stats.totalUsers >= 1);

    await revokeAllUserSessions(user.id);
    await deleteUserAccount(user.id);
  });

  // 9. Proof-of-Work Anti-Bot Shield & Widget Security
  await test("Bot-Shield: Generate challenge, solve Proof-of-Work, and verify solution", async () => {
    const challenge = generateShieldChallenge();
    assert.ok(challenge.salt);
    assert.ok(challenge.signature);

    // Solve PoW for targetDifficulty (prefix '00')
    const crypto = await import("node:crypto");
    let solution = 0;
    while (true) {
      const hash = crypto
        .createHash("sha256")
        .update(`${challenge.salt}:${solution}`)
        .digest("hex");
      if (hash.startsWith("00")) break;
      solution++;
    }

    const isValid = verifyShieldSolution(
      challenge.salt,
      challenge.timestamp,
      challenge.targetDifficulty,
      challenge.signature,
      String(solution)
    );
    assert.ok(isValid, "Cryptographic PoW solution must verify successfully");
  });

  // 10. Centralized Redis Client & Readiness Probe
  await test("Observability & Readiness: Redis health check and Database probe return status", async () => {
    const dbStatus = await checkDbHealth();
    assert.ok(dbStatus.ok, "Database health probe must be OK");

    const redisStatus = await checkRedisHealth();
    assert.ok(typeof redisStatus.status === "string", "Redis health check must return status");
  });

  // 11. Fastify Application Readiness Endpoints
  await test("Fastify App: /health and /ready endpoints return 200 with readiness details", async () => {
    process.env.NODE_ENV = "test";
    const app = await createApp();

    const healthRes = await app.inject({ method: "GET", url: "/health" });
    assert.equal(healthRes.statusCode, 200);

    const readyRes = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readyRes.statusCode, 200);
    const readyBody = JSON.parse(readyRes.payload);
    assert.equal(readyBody.status, "ready");
    assert.ok(readyBody.database);
    assert.ok(readyBody.redis);

    await app.close();
  });

  // 12. Chat Endpoint Bot-Shield Hardening
  await test("Chat Bot-Shield: /api/chat rejects anonymous callers without shield with 403, accepts valid PoW", async () => {
    process.env.NODE_ENV = "test";
    const app = await createApp();

    // Anonymous request without shield should be blocked with 403
    const blockedRes = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello without shield" },
    });
    assert.equal(blockedRes.statusCode, 403);
    const blockedBody = JSON.parse(blockedRes.payload);
    assert.equal(blockedBody.success, false);
    assert.ok(blockedBody.reply.includes("Proof-of-work bot shield required"));

    // Solve valid PoW challenge
    const challenge = generateShieldChallenge();
    const crypto = await import("node:crypto");
    let solution = 0;
    while (true) {
      const hash = crypto
        .createHash("sha256")
        .update(`${challenge.salt}:${solution}`)
        .digest("hex");
      if (hash.startsWith("00")) break;
      solution++;
    }

    // Call /api/chat with solved shield
    const allowedRes = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        message: "Hello with valid shield",
        shield: {
          salt: challenge.salt,
          timestamp: challenge.timestamp,
          targetDifficulty: challenge.targetDifficulty,
          signature: challenge.signature,
          solution: String(solution),
        },
      },
    });
    // Should NOT be 403 (it passes the bot gate)
    assert.notEqual(allowedRes.statusCode, 403, "Valid PoW shield must not be rejected with 403");

    await app.close();
  });

  await test("Circuit Breaker: Passive recording and zero-probe health checking", async () => {
    // 1. Initial state is healthy
    const initialDegraded = await isModelDegraded("mock_provider", "mock_model");
    assert.equal(initialDegraded, false, "Model should initially not be degraded");

    // 2. Record 429 failure passively
    await recordCircuitBreakerFailure("mock_provider", "mock_model", 429, "Rate limit reached");
    const degraded = await isModelDegraded("mock_provider", "mock_model");
    assert.equal(degraded, true, "Model should be in degraded cooldown after 429");

    // 3. Record success clears degraded state immediately
    await recordCircuitBreakerSuccess("mock_provider", "mock_model");
    const cleared = await isModelDegraded("mock_provider", "mock_model");
    assert.equal(cleared, false, "Model should be cleared from degraded cooldown on success");

    // 4. Zero-probe tier health inspection (0 synthetic requests)
    const tiers = await getTiersHealthStatus();
    assert.ok(Array.isArray(tiers), "getTiersHealthStatus must return array of tiers");
    assert.ok(tiers.length >= 4, "Must cover smart tiers including auto, fast, deep reasoning, and frontier");
    const autoTier = tiers.find((t) => t.tierId === "auto");
    assert.ok(autoTier, "Auto tier must be present in health status");
    assert.ok(tiers.find((t) => t.tierId === "gemini-flash"), "Fast tier must be present");
    assert.ok(tiers.find((t) => t.tierId === "groq-120b"), "Deep reasoning tier must be present");
    assert.ok(tiers.find((t) => t.tierId === "openrouter-heavy"), "Frontier tier must be present");
  });

  await test("Task Complexity Routing: Heuristics and circuit-breaker-aware prioritizing", async () => {
    // Reset circuit breaker state for clean deterministic testing
    await recordCircuitBreakerSuccess("gemini", "gemini-3.8-flash");
    await recordCircuitBreakerSuccess("gemini", "gemini-3-flash-preview");

    // 1. Heuristic classifications
    const simple1 = classifyHeuristic("hi there");
    assert.equal(simple1, "simple", "Greetings should be classified as simple");

    const simple2 = classifyHeuristic("what is docker?");
    assert.equal(simple2, "simple", "Short questions should be classified as simple");

    const complex1 = classifyHeuristic("Debug this AST visitor and fix the memory leak in the parser");
    assert.equal(complex1, "complex", "AST and memory leak prompts should be complex");

    const complex2 = classifyHeuristic("Write an SQL injection security filter for this user table");
    assert.equal(complex2, "complex", "Security and SQL injection prompts should be complex");

    // 2. Simple task routes to fast Flash model
    const simpleRouting = await getRoutingTargets("auto", "hello, how are you?");
    assert.equal(simpleRouting.routedComplexity, "simple");
    assert.equal(simpleRouting.targets[0]?.provider, "gemini");

    // 3. Complex task routes to heavy reasoning model
    const complexRouting = await getRoutingTargets("auto", "Solve this concurrency deadlock in the transaction manager");
    assert.equal(complexRouting.routedComplexity, "complex");
    assert.equal(complexRouting.targets[0]?.provider, "groq");
    assert.ok(complexRouting.targets[0]?.model.includes("120b"));

    // 4. User preference override
    const manualPref = await getRoutingTargets("openrouter-heavy", "hello");
    assert.equal(manualPref.targets[0]?.provider, "openrouter");

    // 5. Circuit Breaker Skipping: If primary model is degraded, it is deprioritized
    await recordCircuitBreakerFailure("gemini", "gemini-3.8-flash", 429, "Rate limit");
    const skippedRouting = await getRoutingTargets("auto", "hello, how are you?");
    assert.notEqual(
      skippedRouting.targets[0]?.model,
      "gemini-3.8-flash",
      "Degraded model must not be first in the target chain"
    );
    // Cleanup
    await recordCircuitBreakerSuccess("gemini", "gemini-3.8-flash");
  });

  await test("API Endpoints: /api/models/status returns live tier health without probes", async () => {
    const config = loadAppConfig();
    const app = await createApp(config);

    const statusRes = await app.inject({
      method: "GET",
      url: "/api/models/status",
    });
    assert.equal(statusRes.statusCode, 200);
    const statusData = JSON.parse(statusRes.payload);
    assert.equal(statusData.success, true);
    assert.ok(Array.isArray(statusData.tiers));
    assert.ok(statusData.tiers.length >= 4);

    await app.close();
  });

  // 16. Hierarchical Rolling Memory
  await test("Hierarchical Rolling Memory: Compresses older turns while keeping recent verbatim", async () => {
    const turns = [
      { role: "user", content: "Let's set up the Neon connection pool with Lakebase." },
      { role: "assistant", content: "I will configure the DATABASE_URL and pooled connection." },
      { role: "user", content: "Also make sure we use Redis on OCI Ampere VM." },
      { role: "assistant", content: "Configured Redis client with offline fallback." },
      { role: "user", content: "Can we add pgvector for document search?" },
      { role: "assistant", content: "Added migration 007 for hybrid knowledge search." },
      { role: "user", content: "Now how do we test this?" },
      { role: "assistant", content: "Run npm test to verify." },
      { role: "user", content: "What was the first thing we set up?" },
    ];

    const memory = buildRollingMemory(turns, { maxRecentTurns: 4 });
    assert.ok(memory.includes("Prior Session Context & Key Decisions (Rolling Memory)"));
    assert.ok(memory.includes("Neon connection pool"));
    assert.ok(memory.includes("Recent Active Conversation Turns"));
    assert.ok(memory.includes("What was the first thing we set up?"));
  });

  // 17. Neon Lakebase Hybrid Knowledge Search
  await test("Hybrid Knowledge Search: Index document and retrieve via BM25 matching", async () => {
    const doc1 = await indexKnowledgeDocument(
      "Neon Postgres Autoscaling Guide",
      "Neon Lakebase Postgres automatically scales down to zero when idle and activates on connection.",
      "database",
      { version: "1.0" }
    );
    assert.ok(doc1.id > 0);
    assert.equal(doc1.title, "Neon Postgres Autoscaling Guide");

    const searchResults = await searchKnowledgeHybrid("Postgres autoscaling");
    assert.ok(searchResults.length > 0);
    assert.ok(searchResults.some((r) => r.document.title.includes("Autoscaling")));

    await deleteKnowledgeDocument(doc1.id);
  });

  // 18. Kokoro-82M Voice Synthesis Architecture & Multi-Tier Cascade
  await test("TTS Architecture: Kokoro-82M voice resolver and multi-tier synthesis cascade", async () => {
    const femaleVoice = resolveKokoroVoice("female", "English");
    assert.equal(femaleVoice, "af_heart");

    const maleVoice = resolveKokoroVoice("male", "English");
    assert.equal(maleVoice, "am_adam");

    const hindiVoice = resolveKokoroVoice("hindi_male", "Hindi");
    assert.equal(hindiVoice, "hm_omega");

    const isKokoro = await isKokoroAvailable();
    assert.equal(typeof isKokoro, "boolean");
  });

  // 19. Knowledge API & Agent Tool Integration
  await test("Knowledge Integration: /api/knowledge/search endpoint and agent tools", async () => {
    // 1. Tool execution check
    assert.ok(toolRegistry.search_knowledge_base, "search_knowledge_base tool must be registered");
    assert.ok(toolRegistry.index_knowledge_document, "index_knowledge_document tool must be registered");

    const indexRes = await toolRegistry.index_knowledge_document.execute({
      title: "OCI Ampere Redis Deployment",
      content: "Redis is deployed on Oracle Cloud Infrastructure Ampere A1 Compute VM with persistence.",
      category: "infrastructure",
    });
    assert.ok(indexRes.includes("Successfully indexed"));

    const searchRes = await toolRegistry.search_knowledge_base.execute({
      query: "Ampere Redis",
    });
    assert.ok(searchRes.includes("OCI Ampere Redis"));

    // 2. HTTP Endpoint check
    const config = loadAppConfig();
    const app = await createApp(config);

    const apiSearchRes = await app.inject({
      method: "GET",
      url: "/api/knowledge/search?q=Ampere",
    });
    assert.equal(apiSearchRes.statusCode, 200);
    const apiData = JSON.parse(apiSearchRes.payload);
    assert.equal(apiData.success, true);
    assert.ok(Array.isArray(apiData.results));
    assert.ok(apiData.results.length > 0);

    await app.close();
  });

  // 20. Isolated Code Sandbox (user code must not reach the host realm)
  await test("Code Sandbox: user code runs isolated, cannot reach the host realm, and times out", async () => {
    const { executeInSandbox } = await import("../src/agent/sandbox/runner.js");

    // Host objects injected into the context used to hand user code the host
    // Function constructor, so `Object.constructor("return process")()` escaped.
    // A host object injected into the context used to hand user code the host
    // Function constructor, so `Object.constructor("return process")()` escaped.
    const wrap = (expr: string) =>
      `return (function () { try { return ${expr}; } catch (e) { return 'blocked:' + e.name; } })();`;
    const escapeProbes = [
      wrap("typeof process"),
      wrap("typeof module"),
      wrap("typeof Object.constructor('return process')()"),
      wrap("typeof console.log.constructor('return process')()"),
      wrap("typeof ({}).constructor.constructor('return globalThis')().process"),
    ];
    for (const probe of escapeProbes) {
      const res = await executeInSandbox(probe);
      assert.equal(res.success, true, `Probe should run: ${probe}`);
      assert.ok(
        res.result === "undefined" || res.result === "blocked:ReferenceError",
        `Sandbox escape must be impossible: ${probe} (got ${JSON.stringify(res.result)})`
      );
    }

    const working = await executeInSandbox("console.log('hi'); return 6 * 7;");
    assert.equal(working.success, true);
    assert.equal(working.result, 42);
    assert.deepEqual(working.logs, ["hi"]);

    const timedOut = await executeInSandbox("while (true) {}", { timeoutMs: 250 });
    assert.equal(timedOut.success, false);
    assert.match(String(timedOut.error), /timed out/i);
  });

  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${testsPassed} Passed, ${testsFailed} Failed.`);
  console.log("=================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSuite().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
