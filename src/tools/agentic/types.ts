/**
 * Data shapes and hard limits for the tenant-isolated agentic workspace:
 * virtual files, task plans, long-term memory and scheduled monitors.
 */

export interface WorkspaceVirtualFile {
  name: string;
  content: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AgentTaskItem {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  notes?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryFact {
  key: string;
  fact: string;
  tags: string[];
  embedding: number[];
  updatedAt: string;
}

export type PipelineAction =
  | "create_plan"
  | "update_task"
  | "web_search"
  | "inspect_website"
  | "execute_code"
  | "write_file"
  | "read_file"
  | "remember"
  | "recall";

export interface AgenticPipelineStep {
  action: PipelineAction;
  tasks?: string[] | undefined;
  taskId?: number | undefined;
  status?: "pending" | "in_progress" | "completed" | undefined;
  notes?: string | undefined;
  query?: string | undefined;
  url?: string | undefined;
  focusQuery?: string | undefined;
  code?: string | undefined;
  timeoutMs?: number | undefined;
  filename?: string | undefined;
  content?: string | undefined;
  append?: boolean | undefined;
  key?: string | undefined;
  fact?: string | undefined;
  tags?: string[] | undefined;
}

export type ScheduledActionType =
  | "website_monitor"
  | "web_research_digest"
  | "sandbox_script"
  | "swarm_audit";

export interface AgentScheduledMonitor {
  id: number;
  name: string;
  actionType: ScheduledActionType;
  intervalMinutes: number;
  enabled: boolean;
  targetUrl?: string | undefined;
  query?: string | undefined;
  code?: string | undefined;
  outputFilename: string;
  runCount: number;
  consecutiveFailures: number;
  lastRunAt?: string | undefined;
  nextRunAt: string;
  lastDurationMs?: number | undefined;
  lastStatus?: "OK" | "ALERT" | "ERROR" | undefined;
  lastSummary?: string | undefined;
  createdAt: string;
}

export const MAX_FILES_PER_TENANT = 50;
export const MAX_FILE_SIZE_CHARS = 100_000;
export const MAX_TASKS_PER_TENANT = 100;
export const MAX_MEMORIES_PER_TENANT = 200;
export const MAX_SCHEDULES_PER_TENANT = 15;
export const MAX_CONSECUTIVE_SCHEDULE_FAILURES = 5;
