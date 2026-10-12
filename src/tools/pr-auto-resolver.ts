/**
 * ShunopsAI autonomous PR / CI-CD resolver.
 *
 * The implementation lives under `src/tools/pr/`: `gh.ts` (CLI plumbing),
 * `workflow-runs.ts` (failed-run diagnosis), `comments.ts` (bot-suggestion
 * remediation), `review.ts` (dual-model consensus review), `runner.ts` (fleet
 * runners). This file is the public entrypoint and CLI, so existing importers
 * and `npx tsx src/tools/pr-auto-resolver.ts` keep working unchanged.
 */
import * as dotenv from "dotenv";
import { DEFAULT_TARGET_REPOS, getTargetReposList } from "../core/repos.js";
import { runAutoPRResolver } from "./pr/runner.js";

dotenv.config();

export { DEFAULT_TARGET_REPOS, getTargetReposList };
export * from "./pr/types.js";
export * from "./pr/comments.js";
export * from "./pr/workflow-runs.js";
export * from "./pr/review.js";
export * from "./pr/runner.js";

// CLI handler
const isCLI = process.argv[1]?.endsWith("pr-auto-resolver.ts") || process.argv[1]?.endsWith("pr-auto-resolver.js");
if (isCLI) {
  runAutoPRResolver().then(() => {
    process.exit(0);
  });
}
