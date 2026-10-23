/**
 * Autonomous agent loop barrel.
 *
 * Implementation lives in `./loop/`:
 * - `types`          — public result, option and progress-event types
 * - `toolCallParsing`— 4-format universal tool-call parser + markup stripper
 * - `toolSelection`  — intent-scoped tool schema pruning
 * - `runContext`     — model targets, scope/tool resolution and prompt assembly
 * - `guardrails`     — deliverable verification counters and reflexion cues
 * - `toolExecution`  — one tool call: parsing, safety gate, MCP routing, logging
 * - `runner`         — the step loop, synthesis and result assembly
 */
export type {
  AgentOptions,
  AgentProgressEvent,
  AgentRunResult,
  AgentStepLogEntry,
  AgentTokenUsage,
} from "./loop/types.js";
export {
  extractEmbeddedToolCalls,
  stripEmbeddedToolCallMarkup,
} from "./loop/toolCallParsing.js";
export { selectEnergyEfficientToolsForGoal } from "./loop/toolSelection.js";
export { runAutonomousAgent } from "./loop/runner.js";
