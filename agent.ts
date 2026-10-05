/**
 * ShunopsAI agent entrypoint.
 *
 * The implementation now lives in focused modules under `src/agent/`.
 * This file re-exports the public API (kept stable for `test-tools.ts`,
 * `server.ts`, and CI workflows) and provides the CLI handler.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as dotenv from "dotenv";
import { colors } from "./src/core/colors.js";
import { runAutonomousAgent } from "./src/agent/index.js";

dotenv.config();

export * from "./src/agent/index.js";

// ==========================================
// CLI Self-Execution Handler
// ==========================================

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const goal =
    process.argv.slice(2).join(" ") ||
    "Inspect the repository structure, read package.json, create a sample file at './src/agent.json' with agent metadata, and verify that the file exists.";

  runAutonomousAgent(goal, { maxSteps: 15 }).then((result) => {
    if (!result.success && !process.env.OPENROUTER_API_KEY) {
      console.log(
        `\n${colors.gray}Tip: Set OPENROUTER_API_KEY in .env to execute live reasoning on OpenRouter.${colors.reset}`
      );
    }
  });
}
