/**
 * Tool registry barrel.
 *
 * The definitions live in domain modules under `./tools/`:
 * - `hostTools`     — shell and filesystem access (operator scope only)
 * - `platformTools` — Neon/Redis/GitHub/Cloudflare/GCP/web tools
 * - `mediaTools`    — video production, Kaggle and YouTube
 * - `opsTools`      — approval gate, sentinel healing, consensus, security ops
 * - `knowledgeTools`— knowledge-base retrieval and the code sandbox
 * - `agenticTools`  — workspace files, tasks, memory, pipelines, swarms, schedules
 *
 * `registry.ts` composes them and applies scope enforcement exactly once.
 */
export type { ToolDefinition, ToolName } from "./tools/types.js";
export { toolRegistry, registeredTools } from "./tools/registry.js";
