/**
 * ShunopsAI autonomous repository auditor & healer.
 *
 * The implementation lives under `src/tools/auditor/`: `commit-identity.ts`,
 * `state.ts` (Redis/file state), `scanner.ts` (heuristic flaws), `consensus.ts`
 * (dual-model remediation), `quota.ts` (smart guardrails), `audit.ts` (local
 * orchestration), `remote.ts` (clone + audit) and `runner.ts` (multi-repo).
 * This file is the public entrypoint and CLI, so existing importers and
 * `npx tsx src/tools/autonomous-repo-auditor.ts` keep working unchanged.
 */
import * as dotenv from "dotenv";
import { runMultiRepoAutonomousAuditor } from "./auditor/runner.js";

dotenv.config();

export * from "./auditor/types.js";
export * from "./auditor/commit-identity.js";
export * from "./auditor/state.js";
export * from "./auditor/scanner.js";
export * from "./auditor/consensus.js";
export * from "./auditor/quota.js";
export * from "./auditor/results.js";
export * from "./auditor/audit.js";
export * from "./auditor/remote.js";
export * from "./auditor/runner.js";

// CLI direct execution
const isCLI = process.argv[1]?.endsWith("autonomous-repo-auditor.ts") || process.argv[1]?.endsWith("autonomous-repo-auditor.js");
if (isCLI) {
  runMultiRepoAutonomousAuditor()
    .then((results) => {
      console.log("\n📊 Final Multi-Repo Autonomous Audit Report:");
      console.table(results);
    })
    .catch((err) => {
      console.error("Fatal error during autonomous repo audit:", err);
      process.exit(1);
    });
}
