/**
 * Tenant-isolated agentic workspace: virtual files, task plans, long-term
 * memory, compound pipelines and scheduled monitors.
 *
 * The implementation lives in `./agentic/*`, one module per capability. This
 * barrel is the stable public entry point used by the agent loop, tools and the
 * workspace API.
 */

export type {
  AgentMemoryFact,
  AgentScheduledMonitor,
  AgentTaskItem,
  AgenticPipelineStep,
  PipelineAction,
  ScheduledActionType,
  WorkspaceVirtualFile,
} from "./agentic/types.js";

export {
  getTenantAgenticContextSummary,
  getTenantAgenticSnapshot,
  getTenantFilesMap,
  resolveTenantKey,
} from "./agentic/store.js";

export { executeManageWorkspaceFiles, persistSandboxWrittenFiles } from "./agentic/files.js";

export { autoSyncTasksOnRunCompletion, executeManageAgentTasks } from "./agentic/tasks.js";

export { executeManageAgentMemory } from "./agentic/memory.js";

export { executeAgenticPipeline, type WebSearchCredentials } from "./agentic/pipeline.js";

export {
  executeManageAgentSchedules,
  runDueSchedulesPass,
  runScheduledMonitorOnce,
} from "./agentic/schedules.js";

export {
  hydrateTenantAgenticState,
  mergeSnapshotIntoStores,
  persistTenantAgenticState,
  syncTenantAgenticState,
} from "./agentic/persistence.js";
