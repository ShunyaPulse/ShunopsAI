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
    assert.equal(usage.tokenLimit, 500000);

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
