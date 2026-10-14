/**
 * ShunopsAI autonomous agent — public API surface.
 *
 * The agent is composed of focused modules:
 *  - `models`        — provider/model fallback chain and client factory
 *  - `prompts`       — system prompt engineering
 *  - `sandbox`       — workspace path safety and secret protection
 *  - `tools`         — the tool registry and JSON schemas
 *  - `loop`          — the ReAct execution loop with SSE progress & self-reflection
 *  - `semanticCache` — Stage 8 tenant-isolated 768-dim semantic response cache
 */
export {
  AGENT_MODELS_CHAIN,
  PRIMARY_MODEL,
  FALLBACK_MODELS,
  createClientForTarget,
  callChatCompletionWithFailover,
  type ModelTarget,
  type ProviderKeyOverrides,
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
  type AgentProgressEvent,
} from "./loop.js";

export {
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  recordModelCallTelemetry,
  getModelBanditTelemetry,
  isModelDegraded,
  getModelDegradedInfo,
  getTiersHealthStatus,
  type TierHealthStatus,
  type DegradedState,
  type ModelBanditTelemetry,
} from "./circuitBreaker.js";

export {
  classifyHeuristic,
  analyzeTaskComplexity,
  getRoutingTargets,
  getModelsHealthStatus,
  type ComplexityLevel,
  type IndividualModelStatus,
} from "./router.js";

export {
  buildRollingMemory,
  type ChatTurn,
  type MemorySummaryOptions,
} from "./memory.js";

export {
  lookupSemanticCache,
  storeSemanticCache,
  getSemanticCacheStats,
  clearSemanticCache,
  isCacheablePrompt,
  type SemanticCacheEntry,
  type SemanticCacheHit,
} from "./semanticCache.js";
