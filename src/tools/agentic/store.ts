import type {
  AgentMemoryFact,
  AgentScheduledMonitor,
  AgentTaskItem,
  WorkspaceVirtualFile,
} from "./types.js";

/**
 * Tenant-partitioned in-memory stores keyed by `tenantKey` (e.g. "user:42",
 * "admin:0"). Never read these maps directly from feature modules — use the
 * `getOrCreate*` accessors so a missing tenant always starts from a clean slate.
 */
export const tenantFilesStore = new Map<string, Map<string, WorkspaceVirtualFile>>();
export const tenantTasksStore = new Map<string, { nextId: number; tasks: Map<number, AgentTaskItem> }>();
export const tenantMemoriesStore = new Map<string, Map<string, AgentMemoryFact>>();
export const tenantSchedulesStore = new Map<
  string,
  { nextId: number; schedules: Map<number, AgentScheduledMonitor> }
>();

export interface AgenticSnapshot {
  files: WorkspaceVirtualFile[];
  tasks: AgentTaskItem[];
  memories: Array<{ key: string; fact: string; tags: string[]; updatedAt: string }>;
  schedules: AgentScheduledMonitor[];
}

export type ClientAgenticSnapshot = {
  files?: WorkspaceVirtualFile[] | undefined;
  tasks?: AgentTaskItem[] | undefined;
  memories?: Array<{ key: string; fact: string; tags?: string[] | undefined; updatedAt?: string | undefined }> | undefined;
  schedules?: AgentScheduledMonitor[] | undefined;
};

export function resolveTenantKey(userId?: number | string, kind?: "admin" | "user"): string {
  const numId = Number(userId);
  if (kind === "admin" && (!Number.isFinite(numId) || numId <= 0)) return "admin:0";
  if (Number.isFinite(numId) && numId > 0) return `user:${numId}`;
  return "anon:0";
}

export function getOrCreateFileMap(tenantKey: string): Map<string, WorkspaceVirtualFile> {
  let fileMap = tenantFilesStore.get(tenantKey);
  if (!fileMap) {
    fileMap = new Map<string, WorkspaceVirtualFile>();
    tenantFilesStore.set(tenantKey, fileMap);
  }
  return fileMap;
}

export function getOrCreateTaskState(
  tenantKey: string
): { nextId: number; tasks: Map<number, AgentTaskItem> } {
  let state = tenantTasksStore.get(tenantKey);
  if (!state) {
    state = { nextId: 1, tasks: new Map<number, AgentTaskItem>() };
    tenantTasksStore.set(tenantKey, state);
  }
  return state;
}

export function getOrCreateMemoryMap(tenantKey: string): Map<string, AgentMemoryFact> {
  let memMap = tenantMemoriesStore.get(tenantKey);
  if (!memMap) {
    memMap = new Map<string, AgentMemoryFact>();
    tenantMemoriesStore.set(tenantKey, memMap);
  }
  return memMap;
}

export function getOrCreateScheduleState(
  tenantKey: string
): { nextId: number; schedules: Map<number, AgentScheduledMonitor> } {
  let state = tenantSchedulesStore.get(tenantKey);
  if (!state) {
    state = { nextId: 1, schedules: new Map<number, AgentScheduledMonitor>() };
    tenantSchedulesStore.set(tenantKey, state);
  }
  return state;
}

/**
 * Retrieve a compact summary of the tenant's active memories, tasks, files and
 * schedules to inject into the agent's system context at the start of a run.
 */
export function getTenantAgenticContextSummary(tenantKey: string): string {
  const parts: string[] = [];

  const memMap = tenantMemoriesStore.get(tenantKey);
  if (memMap && memMap.size > 0) {
    const recentMemories = Array.from(memMap.values())
      .slice(-10)
      .map((m) => `• ${m.key}: ${m.fact}`);
    parts.push(`Saved Long-Term Agent Memories:\n${recentMemories.join("\n")}`);
  }

  const taskState = tenantTasksStore.get(tenantKey);
  if (taskState && taskState.tasks.size > 0) {
    const activeTasks = Array.from(taskState.tasks.values())
      .filter((t) => t.status !== "completed")
      .slice(0, 10)
      .map((t) => `• #${t.id} [${t.status}] ${t.title}`);
    if (activeTasks.length > 0) {
      parts.push(`Active Agent Task Checklist:\n${activeTasks.join("\n")}`);
    }
  }

  const fileMap = tenantFilesStore.get(tenantKey);
  if (fileMap && fileMap.size > 0) {
    parts.push(`Saved Workspace Files (${fileMap.size}): ${Array.from(fileMap.keys()).join(", ")}`);
  }

  const schedState = tenantSchedulesStore.get(tenantKey);
  if (schedState && schedState.schedules.size > 0) {
    const schedLines = Array.from(schedState.schedules.values()).map(
      (s) =>
        `• #${s.id} [${s.enabled ? "ACTIVE" : "PAUSED"}] ${s.name} (${s.actionType} -> ${s.outputFilename})`
    );
    parts.push(`Active Scheduled Monitors:\n${schedLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

/**
 * Structured snapshot of a tenant's workspace for the Agentic Workspace Hub and
 * for durable persistence.
 */
export function getTenantAgenticSnapshot(tenantKey: string): AgenticSnapshot {
  const fileMap = tenantFilesStore.get(tenantKey);
  const taskState = tenantTasksStore.get(tenantKey);
  const memMap = tenantMemoriesStore.get(tenantKey);
  const schedState = tenantSchedulesStore.get(tenantKey);

  return {
    files: fileMap ? Array.from(fileMap.values()) : [],
    tasks: taskState ? Array.from(taskState.tasks.values()) : [],
    memories: memMap
      ? Array.from(memMap.values()).map(({ key, fact, tags, updatedAt }) => ({
          key,
          fact,
          tags,
          updatedAt,
        }))
      : [],
    schedules: schedState ? Array.from(schedState.schedules.values()) : [],
  };
}

/**
 * Read-only dictionary of a tenant's workspace files, handed to the sandbox so
 * scripts can inspect files without gaining write access to the store.
 */
export function getTenantFilesMap(tenantKey: string): Record<string, string> {
  const fileMap = tenantFilesStore.get(tenantKey);
  if (!fileMap) return {};
  const out: Record<string, string> = {};
  for (const [name, file] of fileMap.entries()) {
    out[name] = file.content;
  }
  return out;
}
