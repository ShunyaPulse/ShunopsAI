/**
 * ShunopsAI autonomous agent — public API surface.
 *
 * The agent is composed of focused modules:
 *  - `models`   — provider/model fallback chain and client factory
 *  - `prompts`  — system prompt engineering
 *  - `sandbox`  — workspace path safety and secret protection
 *  - `tools`    — the tool registry and JSON schemas
 *  - `loop`     — the ReAct execution loop
 */
export {
  AGENT_MODELS_CHAIN,
  PRIMARY_MODEL,
  FALLBACK_MODELS,
  createClientForTarget,
  callChatCompletionWithFailover,
  type ModelTarget,
} from "./models.js";

export { buildSystemPrompt } from "./prompts.js";

export {
  PROJECT_ROOT,
  DEFAULT_IGNORED_DIRS,
  isSecretPath,
  resolveInsideProject,
  assertAccessible,
  listDirectoryTree,
  sensitivityPayload,
} from "./sandbox.js";

export {
  toolRegistry,
  registeredTools,
  type ToolDefinition,
  type ToolName,
} from "./tools.js";

export {
  runAutonomousAgent,
  type AgentOptions,
  type AgentRunResult,
} from "./loop.js";
