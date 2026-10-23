import { computeDeterministicEmbedding } from "../server/db/knowledge.js";
import { getSql } from "../server/db/store.js";
import { executeWebSearch, inspectWebsite } from "./cloud.js";
import { executeInSandbox } from "../agent/sandbox/runner.js";

// ==========================================
// ShunopsAI Core Agentic Capabilities (Tenant-Isolated)
// 1. Virtual Agent Workspace File System (`manage_workspace_files`)
// 2. Persistent Agent Task Planner & Checklist (`manage_agent_tasks`)
// 3. Long-Term Episodic & Semantic Agent Memory (`manage_agent_memory`)
// 4. Compound Multi-Tool Chaining Pipeline (`run_agentic_pipeline`)
// ==========================================

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

export interface AgenticPipelineStep {
  action:
    | "create_plan"
    | "update_task"
    | "web_search"
    | "inspect_website"
    | "execute_code"
    | "write_file"
    | "read_file"
    | "remember"
    | "recall";
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

const MAX_FILES_PER_TENANT = 50;
const MAX_FILE_SIZE_CHARS = 100_000;
const MAX_TASKS_PER_TENANT = 100;
const MAX_MEMORIES_PER_TENANT = 200;

// Tenant-partitioned in-memory stores keyed by `tenantKey` (e.g. "user:42" or "admin:0")
const tenantFilesStore = new Map<string, Map<string, WorkspaceVirtualFile>>();
const tenantTasksStore = new Map<string, { nextId: number; tasks: Map<number, AgentTaskItem> }>();
const tenantMemoriesStore = new Map<string, Map<string, AgentMemoryFact>>();

export function resolveTenantKey(userId?: number | string, kind?: "admin" | "user"): string {
  const numId = Number(userId);
  if (kind === "admin" && (!Number.isFinite(numId) || numId <= 0)) return "admin:0";
  if (Number.isFinite(numId) && numId > 0) return `user:${numId}`;
  return "anon:0";
}

function sanitizeFileName(raw: string): string {
  const clean = String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, "");
  if (!clean || clean.length > 120 || !/^[A-Za-z0-9_./-]+$/.test(clean)) {
    throw new Error(
      `Invalid filename "${raw}". Use alphanumeric characters, hyphens, underscores, dots, or slashes (e.g., "notes.md", "src/helper.js").`
    );
  }
  return clean;
}

// ==========================================
// 1. Virtual Agent Workspace File System (`manage_workspace_files`)
// ==========================================

export async function executeManageWorkspaceFiles(
  args: {
    operation: "write" | "append" | "read" | "list" | "delete" | "search";
    filename?: string | undefined;
    content?: string | undefined;
    query?: string | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  let fileMap = tenantFilesStore.get(tenantKey);
  if (!fileMap) {
    fileMap = new Map<string, WorkspaceVirtualFile>();
    tenantFilesStore.set(tenantKey, fileMap);
  }

  const op = args.operation;

  if (op === "list") {
    if (fileMap.size === 0) {
      return "Workspace File System is currently empty (0 files). Use operation='write' to create files.";
    }
    const rows = Array.from(fileMap.values()).map(
      (f) => `• ${f.name} (${f.sizeBytes} bytes, updated ${f.updatedAt})`
    );
    return `Workspace Files (${fileMap.size}/${MAX_FILES_PER_TENANT}):\n${rows.join("\n")}`;
  }

  if (op === "search") {
    const q = String(args.query || "").trim().toLowerCase();
    if (!q) return "Error: 'query' parameter is required for operation='search'.";
    const matches: string[] = [];
    for (const f of fileMap.values()) {
      if (f.name.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)) {
        const lines = f.content.split("\n");
        const matchingLines = lines
          .map((line, i) => ({ line, num: i + 1 }))
          .filter((item) => item.line.toLowerCase().includes(q))
          .slice(0, 5)
          .map((item) => `  L${item.num}: ${item.line.slice(0, 160)}`);
        matches.push(
          `📄 ${f.name}:\n${matchingLines.length > 0 ? matchingLines.join("\n") : "  (Filename match)"}`
        );
      }
    }
    return matches.length > 0
      ? `Search Results for "${args.query}" (${matches.length} files):\n\n${matches.join("\n\n")}`
      : `No workspace files matched "${args.query}".`;
  }

  let safeName: string;
  try {
    safeName = sanitizeFileName(args.filename || "");
  } catch (err: any) {
    return `Error: ${err.message}`;
  }

  if (op === "read") {
    const file = fileMap.get(safeName);
    if (!file) {
      return `Error: File "${safeName}" not found in your workspace. Available files: ${
        Array.from(fileMap.keys()).join(", ") || "none"
      }`;
    }
    return `=== ${file.name} (${file.sizeBytes} bytes) ===\n${file.content}`;
  }

  if (op === "delete") {
    const existed = fileMap.delete(safeName);
    if (existed) await persistTenantAgenticState(tenantKey);
    return existed
      ? `Deleted file "${safeName}" from workspace.`
      : `File "${safeName}" did not exist in workspace.`;
  }

  if (op === "write" || op === "append") {
    const incoming = String(args.content ?? "");
    const existing = fileMap.get(safeName);
    if (!existing && fileMap.size >= MAX_FILES_PER_TENANT) {
      return `Error: Workspace file limit (${MAX_FILES_PER_TENANT}) reached. Delete unused files first.`;
    }
    const nextContent =
      op === "append" && existing ? `${existing.content}\n${incoming}` : incoming;
    if (nextContent.length > MAX_FILE_SIZE_CHARS) {
      return `Error: File "${safeName}" exceeds maximum size of ${MAX_FILE_SIZE_CHARS} characters.`;
    }
    const now = new Date().toISOString();
    const sizeBytes = Buffer.byteLength(nextContent, "utf8");
    fileMap.set(safeName, {
      name: safeName,
      content: nextContent,
      sizeBytes,
      updatedAt: now,
    });
    await persistTenantAgenticState(tenantKey);
    return `Successfully ${op === "append" ? "appended to" : "saved"} workspace file "${safeName}" (${sizeBytes} bytes).`;
  }

  return `Unsupported workspace file operation: "${op}".`;
}

/**
 * Persist any files created inside the JS sandbox via `writeWorkspaceFile(name, content)`
 * into the tenant's isolated workspace store.
 */
export async function persistSandboxWrittenFiles(
  writtenFiles: Record<string, string> | undefined,
  tenantKey: string
): Promise<string[]> {
  if (!writtenFiles || typeof writtenFiles !== "object") return [];
  const savedNames: string[] = [];
  for (const [rawName, content] of Object.entries(writtenFiles)) {
    const res = await executeManageWorkspaceFiles(
      {
        operation: "write",
        filename: rawName,
        content: String(content ?? ""),
      },
      tenantKey
    );
    if (res.startsWith("Successfully")) {
      savedNames.push(rawName);
    }
  }
  return savedNames;
}

// ==========================================
// 2. Persistent Agent Task Planner (`manage_agent_tasks`)
// ==========================================

export async function executeManageAgentTasks(
  args: {
    operation: "create_plan" | "add_task" | "update_task" | "list_tasks" | "clear_completed" | "delete_task" | "clear_all";
    tasks?: string[] | undefined;
    title?: string | undefined;
    taskId?: number | undefined;
    status?: "pending" | "in_progress" | "completed" | undefined;
    priority?: "low" | "medium" | "high" | undefined;
    notes?: string | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  let state = tenantTasksStore.get(tenantKey);
  if (!state) {
    state = { nextId: 1, tasks: new Map<number, AgentTaskItem>() };
    tenantTasksStore.set(tenantKey, state);
  }

  const op = args.operation;
  const now = new Date().toISOString();

  if (op === "create_plan") {
    const list = Array.isArray(args.tasks)
      ? args.tasks.map((t) => String(t || "").trim()).filter(Boolean)
      : [];
    if (list.length === 0) {
      return "Error: Provide a non-empty 'tasks' string array for operation='create_plan'.";
    }
    const created: AgentTaskItem[] = [];
    for (let i = 0; i < list.slice(0, 20).length; i++) {
      const title = list[i]!;
      if (state.tasks.size >= MAX_TASKS_PER_TENANT) break;
      const id = state.nextId++;
      // Mark the first task in a freshly created plan as in_progress automatically
      const item: AgentTaskItem = {
        id,
        title: title.slice(0, 240),
        status: i === 0 ? "in_progress" : "pending",
        priority: args.priority || "medium",
        createdAt: now,
        updatedAt: now,
      };
      state.tasks.set(id, item);
      created.push(item);
    }
    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(state.tasks, `Created plan with ${created.length} step(s):`);
  }

  if (op === "add_task") {
    const title = String(args.title || "").trim();
    if (!title) return "Error: 'title' is required for operation='add_task'.";
    if (state.tasks.size >= MAX_TASKS_PER_TENANT) {
      return `Error: Maximum task limit (${MAX_TASKS_PER_TENANT}) reached. Run 'clear_completed' first.`;
    }
    const id = state.nextId++;
    const item: AgentTaskItem = {
      id,
      title: title.slice(0, 240),
      status: args.status || "pending",
      priority: args.priority || "medium",
      ...(args.notes ? { notes: String(args.notes).slice(0, 400) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    state.tasks.set(id, item);
    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(state.tasks, `Added task #${id} ("${item.title}"):`);
  }

  if (op === "update_task") {
    const id = Number(args.taskId);
    const existing = state.tasks.get(id);
    if (!existing) {
      return `Error: Task #${id} not found. Run operation='list_tasks' to see valid task IDs.`;
    }
    if (args.status && ["pending", "in_progress", "completed"].includes(args.status)) {
      existing.status = args.status;
    }
    if (args.priority && ["low", "medium", "high"].includes(args.priority)) {
      existing.priority = args.priority;
    }
    if (args.notes !== undefined) {
      existing.notes = String(args.notes).slice(0, 400);
    }
    existing.updatedAt = now;

    // When a task is marked completed, automatically advance the next pending task to in_progress
    if (existing.status === "completed") {
      const hasInProgress = Array.from(state.tasks.values()).some((t) => t.status === "in_progress");
      if (!hasInProgress) {
        const nextPending = Array.from(state.tasks.values()).find((t) => t.status === "pending");
        if (nextPending) {
          nextPending.status = "in_progress";
          nextPending.updatedAt = now;
        }
      }
    }

    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(
      state.tasks,
      `Updated task #${id} -> [${existing.status.toUpperCase()}]:`
    );
  }

  if (op === "clear_completed") {
    let removed = 0;
    for (const [id, t] of state.tasks.entries()) {
      if (t.status === "completed") {
        state.tasks.delete(id);
        removed++;
      }
    }
    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(state.tasks, `Cleared ${removed} completed task(s):`);
  }

  if (op === "delete_task") {
    const id = Number(args.taskId);
    const existed = state.tasks.delete(id);
    if (!existed) {
      return `Error: Task #${id} not found.`;
    }
    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(state.tasks, `Deleted task #${id}:`);
  }

  if (op === "clear_all") {
    const count = state.tasks.size;
    state.tasks.clear();
    await persistTenantAgenticState(tenantKey);
    return formatTaskBoard(state.tasks, `Cleared all ${count} task(s).`);
  }

  return formatTaskBoard(state.tasks, "Current Agent Task Plan:");
}

/**
 * Synchronize task statuses when a multi-tool agent run completes so tasks
 * that were actively worked on during the run don't remain stuck in `in_progress`
 * if the model already executed the downstream deliverable tools.
 */
export function autoSyncTasksOnRunCompletion(
  tenantKey: string,
  executedToolNames: string[],
  userGoal = ""
): void {
  const state = tenantTasksStore.get(tenantKey);
  if (!state || state.tasks.size === 0) return;

  // If the user explicitly asked to leave a step "in progress" (e.g. "mark step 1 in progress"),
  // honor their exact instruction and do not auto-complete it.
  if (/\bmark\b.*\bin[_\s-]?progress\b/i.test(userGoal)) {
    return;
  }

  const nonTaskTools = executedToolNames.filter((n) => n !== "manage_agent_tasks");
  if (nonTaskTools.length === 0) return;

  const now = new Date().toISOString();
  for (const t of state.tasks.values()) {
    if (t.status === "in_progress") {
      t.status = "completed";
      t.updatedAt = now;
    }
  }
}

function formatTaskBoard(tasks: Map<number, AgentTaskItem>, header: string): string {
  if (tasks.size === 0) {
    return `${header}\n(No tasks currently in plan. Use operation='create_plan' or 'add_task' to add steps.)`;
  }
  const all = Array.from(tasks.values());
  const completedCount = all.filter((t) => t.status === "completed").length;
  const pct = Math.round((completedCount / all.length) * 100);
  const lines = all.map((t) => {
    const icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[/]" : "[ ]";
    const prio = t.priority === "high" ? "🔴 HIGH" : t.priority === "low" ? "🟢 LOW" : "🟡 MED";
    const noteStr = t.notes ? ` — Note: ${t.notes}` : "";
    return `${icon} #${t.id} [${prio}] ${t.title}${noteStr}`;
  });
  return `${header}\nProgress: ${completedCount}/${all.length} completed (${pct}%)\n${lines.join("\n")}`;
}

// ==========================================
// 3. Long-Term Semantic & Episodic Agent Memory (`manage_agent_memory`)
// ==========================================

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

export async function executeManageAgentMemory(
  args: {
    operation: "remember" | "recall" | "list" | "forget";
    key?: string | undefined;
    fact?: string | undefined;
    query?: string | undefined;
    tags?: string[] | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  let memMap = tenantMemoriesStore.get(tenantKey);
  if (!memMap) {
    memMap = new Map<string, AgentMemoryFact>();
    tenantMemoriesStore.set(tenantKey, memMap);
  }

  const op = args.operation;

  if (op === "remember") {
    const key = String(args.key || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_")
      .slice(0, 80);
    const fact = String(args.fact || "").trim().slice(0, 2000);
    if (!key || !fact) {
      return "Error: Both 'key' (short identifier) and 'fact' (information to remember) are required for operation='remember'.";
    }
    if (!memMap.has(key) && memMap.size >= MAX_MEMORIES_PER_TENANT) {
      const oldestKey = memMap.keys().next().value;
      if (oldestKey !== undefined) memMap.delete(oldestKey);
    }
    const tags = Array.isArray(args.tags)
      ? args.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [];
    const embedding = computeDeterministicEmbedding(`${key} ${tags.join(" ")} ${fact}`);
    memMap.set(key, {
      key,
      fact,
      tags,
      embedding,
      updatedAt: new Date().toISOString(),
    });
    await persistTenantAgenticState(tenantKey);
    return `Remembered fact under key "${key}": "${fact}"${tags.length > 0 ? ` [tags: ${tags.join(", ")}]` : ""}.`;
  }

  if (op === "forget") {
    const key = String(args.key || "").trim().toLowerCase();
    if (!key) return "Error: 'key' is required for operation='forget'.";
    const removed = memMap.delete(key);
    if (removed) await persistTenantAgenticState(tenantKey);
    return removed
      ? `Forgot memory "${key}".`
      : `Memory key "${key}" was not found.`;
  }

  if (op === "list") {
    if (memMap.size === 0) {
      return "No long-term memories stored yet. Use operation='remember' to store user preferences, project architecture facts, or decisions.";
    }
    const items = Array.from(memMap.values()).map(
      (m) => `• [${m.key}]: ${m.fact}${m.tags.length > 0 ? ` (${m.tags.join(", ")})` : ""}`
    );
    return `Stored Long-Term Memories (${memMap.size}):\n${items.join("\n")}`;
  }

  if (op === "recall") {
    const query = String(args.query || args.key || "").trim();
    if (!query) return "Error: 'query' is required for operation='recall'.";
    if (memMap.size === 0) return "No memories stored yet.";

    const qLower = query.toLowerCase();
    const qVec = computeDeterministicEmbedding(query);
    const scored = Array.from(memMap.values())
      .map((m) => {
        const lexicalHit =
          m.key.includes(qLower) ||
          m.fact.toLowerCase().includes(qLower) ||
          m.tags.some((t) => t.includes(qLower))
            ? 0.4
            : 0;
        const vecSim = cosineSim(qVec, m.embedding);
        return { m, score: lexicalHit + vecSim };
      })
      .filter((x) => x.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (scored.length === 0) {
      return `No stored memories matched query "${query}".`;
    }
    return (
      `Recalled Memories for "${query}":\n` +
      scored
        .map(
          ({ m, score }) =>
            `• [${m.key}] (relevance ${score.toFixed(2)}): ${m.fact}${
              m.tags.length > 0 ? ` [tags: ${m.tags.join(", ")}]` : ""
            }`
        )
        .join("\n")
    );
  }

  return `Unsupported memory operation: "${op}".`;
}

// ==========================================
// 4. Compound Multi-Tool Chaining Engine (`run_agentic_pipeline`)
// ==========================================

export async function executeAgenticPipeline(
  args: { steps: AgenticPipelineStep[] },
  tenantKey: string,
  webSearchCredentials?: { provider?: "tavily" | "brave"; apiKey?: string }
): Promise<string> {
  const steps = Array.isArray(args?.steps) ? args.steps.slice(0, 8) : [];
  if (steps.length === 0) {
    return "Error: 'steps' array must contain at least 1 pipeline step.";
  }

  const pipelineOutputs: string[] = [];
  const stepReports: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    const stepNum = i + 1;
    const t0 = Date.now();
    let out = "";

    try {
      switch (st.action) {
        case "create_plan":
          out = await executeManageAgentTasks(
            { operation: "create_plan", tasks: st.tasks || [] },
            tenantKey
          );
          break;
        case "update_task":
          out = await executeManageAgentTasks(
            {
              operation: "update_task",
              taskId: st.taskId,
              status: st.status || "completed",
              notes: st.notes,
            },
            tenantKey
          );
          break;
        case "web_search":
          out = await executeWebSearch(String(st.query || ""), {
            ...(webSearchCredentials || {}),
            maxResults: 5,
          });
          break;
        case "inspect_website":
          out = await inspectWebsite(String(st.url || ""), st.focusQuery);
          break;
        case "write_file":
          out = await executeManageWorkspaceFiles(
            {
              operation: st.append ? "append" : "write",
              filename: st.filename,
              content: st.content ?? (pipelineOutputs[pipelineOutputs.length - 1] || ""),
            },
            tenantKey
          );
          break;
        case "read_file":
          out = await executeManageWorkspaceFiles(
            { operation: "read", filename: st.filename },
            tenantKey
          );
          break;
        case "remember":
          out = await executeManageAgentMemory(
            {
              operation: "remember",
              key: st.key,
              fact: st.fact ?? (pipelineOutputs[pipelineOutputs.length - 1] || ""),
              tags: st.tags,
            },
            tenantKey
          );
          break;
        case "recall":
          out = await executeManageAgentMemory(
            { operation: "recall", query: st.query || st.key },
            tenantKey
          );
          break;
        case "execute_code": {
          const workspaceFiles = getTenantFilesMap(tenantKey);
          const sbRes = await executeInSandbox(String(st.code || ""), {
            timeoutMs: st.timeoutMs,
            workspaceFiles,
            pipelineOutputs,
          });
          if (!sbRes.success) {
            out = `Error in sandbox step: ${sbRes.error}`;
          } else {
            const savedNames = await persistSandboxWrittenFiles(sbRes.writtenFiles, tenantKey);
            const parts = [
              sbRes.result !== null ? JSON.stringify(sbRes.result, null, 2) : "",
              sbRes.logs.length > 0 ? `Logs:\n${sbRes.logs.join("\n")}` : "",
              savedNames.length > 0 ? `Saved workspace files: ${savedNames.join(", ")}` : "",
            ].filter(Boolean);
            out = parts.join("\n") || "Executed successfully.";
          }
          break;
        }
        default:
          out = `Error: Unsupported pipeline action "${(st as any).action}".`;
      }
    } catch (err: any) {
      out = `Error in pipeline step ${stepNum} (${st.action}): ${err?.message || String(err)}`;
    }

    pipelineOutputs.push(out);
    const elapsed = Math.max(1, Date.now() - t0);
    stepReports.push(
      `--- [Pipeline Step ${stepNum}/${steps.length}: ${st.action} (${elapsed}ms)] ---\n${out.slice(0, 1500)}`
    );
  }

  return `Agentic Pipeline Completed (${steps.length} steps):\n\n${stepReports.join("\n\n")}`;
}


// ==========================================
// 5. Autonomous Scheduled Monitors & Watchdogs (`manage_agent_schedules`)
// - Supports: website_monitor, web_research_digest, sandbox_script, swarm_audit
// - Unref'd background ticker (`ensureScheduleTickerStarted`) + `runDueSchedulesPass`
// - Automatic circuit-breaker pause after 5 consecutive failures
// ==========================================

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

const MAX_SCHEDULES_PER_TENANT = 15;
const MAX_CONSECUTIVE_SCHEDULE_FAILURES = 5;
const tenantSchedulesStore = new Map<string, { nextId: number; schedules: Map<number, AgentScheduledMonitor> }>();
let scheduleTickerHandle: ReturnType<typeof setInterval> | null = null;

function computeNextRunIso(intervalMinutes: number, fromMs = Date.now()): string {
  return new Date(fromMs + intervalMinutes * 60_000).toISOString();
}

export async function runScheduledMonitorOnce(
  job: AgentScheduledMonitor,
  tenantKey: string
): Promise<{ status: "OK" | "ALERT" | "ERROR"; summary: string }> {
  const startMs = Date.now();
  const nowIso = new Date(startMs).toISOString();
  job.lastRunAt = nowIso;
  job.nextRunAt = computeNextRunIso(job.intervalMinutes, startMs);
  job.runCount++;

  try {
    if (job.actionType === "website_monitor") {
      const raw = await inspectWebsite(job.targetUrl || "https://example.com", job.query);
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      const httpStatus = parsed?.status || 0;
      const latencyMs = parsed?.latencyMs || 0;
      const isAlert = !httpStatus || httpStatus >= 400 || latencyMs > 5000;
      job.lastStatus = isAlert ? "ALERT" : "OK";
      job.lastDurationMs = Math.max(1, Date.now() - startMs);
      job.consecutiveFailures = isAlert ? job.consecutiveFailures + 1 : 0;
      job.lastSummary = `HTTP ${httpStatus || "ERR"} • ${latencyMs}ms (${job.targetUrl})`;

      const logLine =
        `- **[${nowIso}]** ` +
        (isAlert ? "🚨 ALERT" : "✅ HEALTHY") +
        ` — URL: ${job.targetUrl} | Status: ${httpStatus || "ERR"} | Latency: ${latencyMs}ms`;
      await executeManageWorkspaceFiles(
        {
          operation: "append",
          filename: job.outputFilename,
          content: logLine,
        },
        tenantKey
      );
      if (isAlert) {
        await executeManageAgentMemory(
          {
            operation: "remember",
            key: `monitor_alert_${job.id}`,
            fact: `Scheduled monitor "${job.name}" detected issue on ${job.targetUrl}: HTTP ${httpStatus || "ERR"} (${latencyMs}ms) at ${nowIso}`,
            tags: ["monitor", "alert"],
          },
          tenantKey
        );
      }
      if (job.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
        job.enabled = false;
        job.lastSummary += " [Auto-paused after 5 consecutive alerts]";
      }
      return { status: job.lastStatus, summary: job.lastSummary };
    }

    if (job.actionType === "web_research_digest" || job.actionType === "swarm_audit") {
      const searchOut = await executeWebSearch(job.query || job.name, { maxResults: 4 });
      job.lastStatus = "OK";
      job.consecutiveFailures = 0;
      job.lastDurationMs = Math.max(1, Date.now() - startMs);
      const label = job.actionType === "swarm_audit" ? "🐝 Swarm Security & Research Audit" : "📰 Research Digest";
      job.lastSummary = `${job.actionType === "swarm_audit" ? "Audited" : "Fetched digest for"} "${job.query || job.name}" -> ${job.outputFilename} (${job.lastDurationMs}ms)`;
      const digestBlock = `## ${label}: ${job.name} (${nowIso})\n${searchOut.slice(0, 2000)}\n`;
      await executeManageWorkspaceFiles(
        {
          operation: "append",
          filename: job.outputFilename,
          content: digestBlock,
        },
        tenantKey
      );
      return { status: "OK", summary: job.lastSummary };
    }

    if (job.actionType === "sandbox_script") {
      const workspaceFiles = getTenantFilesMap(tenantKey);
      const sbRes = await executeInSandbox(job.code || "return null;", {
        timeoutMs: 5000,
        workspaceFiles,
      });
      job.lastDurationMs = Math.max(1, Date.now() - startMs);
      if (!sbRes.success) {
        job.lastStatus = "ERROR";
        job.consecutiveFailures++;
        job.lastSummary = `Sandbox error: ${sbRes.error}`;
        if (job.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
          job.enabled = false;
          job.lastSummary += " [Auto-paused after 5 consecutive errors]";
        }
        return { status: "ERROR", summary: job.lastSummary };
      }
      job.consecutiveFailures = 0;
      await persistSandboxWrittenFiles(sbRes.writtenFiles, tenantKey);
      const valStr = sbRes.result !== null ? JSON.stringify(sbRes.result) : "completed";
      job.lastStatus = "OK";
      job.lastSummary = `Executed in ${sbRes.executionTimeMs}ms -> ${valStr.slice(0, 120)}`;
      await executeManageWorkspaceFiles(
        {
          operation: "append",
          filename: job.outputFilename,
          content: `- **[${nowIso}]** Sandbox Job "${job.name}" (${sbRes.executionTimeMs}ms): ${valStr.slice(0, 300)}`,
        },
        tenantKey
      );
      return { status: "OK", summary: job.lastSummary };
    }

    job.lastStatus = "ERROR";
    job.lastSummary = `Unsupported actionType: ${job.actionType}`;
    return { status: "ERROR", summary: job.lastSummary };
  } catch (err: any) {
    job.lastStatus = "ERROR";
    job.consecutiveFailures++;
    job.lastDurationMs = Math.max(1, Date.now() - startMs);
    job.lastSummary = err?.message || String(err);
    if (job.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
      job.enabled = false;
    }
    return { status: "ERROR", summary: job.lastSummary || "Monitor execution failed" };
  }
}

/**
 * Scan all tenants for due enabled schedules (`nowMs >= Date.parse(job.nextRunAt)`)
 * and execute them asynchronously.
 */
export async function runDueSchedulesPass(nowMs = Date.now()): Promise<number> {
  let executedCount = 0;
  for (const [tenantKey, state] of tenantSchedulesStore.entries()) {
    for (const job of state.schedules.values()) {
      if (!job.enabled) continue;
      const dueMs = Date.parse(job.nextRunAt);
      if (Number.isFinite(dueMs) && nowMs >= dueMs) {
        executedCount++;
        await runScheduledMonitorOnce(job, tenantKey).catch(() => {});
      }
    }
  }
  return executedCount;
}

function ensureScheduleTickerStarted(): void {
  if (scheduleTickerHandle) return;
  scheduleTickerHandle = setInterval(() => {
    void runDueSchedulesPass();
  }, 60_000);
  if (typeof scheduleTickerHandle.unref === "function") {
    scheduleTickerHandle.unref();
  }
}

export async function executeManageAgentSchedules(
  args: {
    operation:
      | "create_schedule"
      | "list_schedules"
      | "run_now"
      | "pause_schedule"
      | "resume_schedule"
      | "delete_schedule";
    scheduleId?: number | undefined;
    name?: string | undefined;
    actionType?: ScheduledActionType | undefined;
    intervalMinutes?: number | undefined;
    targetUrl?: string | undefined;
    query?: string | undefined;
    code?: string | undefined;
    outputFilename?: string | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  let state = tenantSchedulesStore.get(tenantKey);
  if (!state) {
    state = { nextId: 1, schedules: new Map<number, AgentScheduledMonitor>() };
    tenantSchedulesStore.set(tenantKey, state);
  }

  const op = args.operation;

  if (op === "create_schedule") {
    if (state.schedules.size >= MAX_SCHEDULES_PER_TENANT) {
      return `Error: Maximum schedule limit (${MAX_SCHEDULES_PER_TENANT}) reached. Delete unused schedules first.`;
    }
    const actionType: ScheduledActionType =
      args.actionType &&
      ["website_monitor", "web_research_digest", "sandbox_script", "swarm_audit"].includes(args.actionType)
        ? args.actionType
        : args.targetUrl
        ? "website_monitor"
        : args.code
        ? "sandbox_script"
        : "web_research_digest";

    const id = state.nextId++;
    const intervalMinutes = Math.min(Math.max(Number(args.intervalMinutes) || 30, 5), 1440);
    const defaultFile =
      actionType === "website_monitor"
        ? "monitor-log.md"
        : actionType === "sandbox_script"
        ? "sandbox-cron.md"
        : actionType === "swarm_audit"
        ? "swarm-watchdog.md"
        : "research-digest.md";

    let outputFilename = defaultFile;
    try {
      if (args.outputFilename) outputFilename = sanitizeFileName(args.outputFilename);
    } catch {}

    const nowIso = new Date().toISOString();
    const job: AgentScheduledMonitor = {
      id,
      name: String(args.name || `${actionType} #${id}`).trim().slice(0, 120),
      actionType,
      intervalMinutes,
      enabled: true,
      ...(args.targetUrl ? { targetUrl: String(args.targetUrl).trim() } : {}),
      ...(args.query ? { query: String(args.query).trim() } : {}),
      ...(args.code ? { code: String(args.code) } : {}),
      outputFilename,
      runCount: 0,
      consecutiveFailures: 0,
      nextRunAt: computeNextRunIso(intervalMinutes),
      createdAt: nowIso,
    };
    state.schedules.set(id, job);
    ensureScheduleTickerStarted();

    // Run initial verification pass immediately so the user gets instant output in their workspace file
    const initialRun = await runScheduledMonitorOnce(job, tenantKey);
    await persistTenantAgenticState(tenantKey);
    return `Created schedule #${id} ("${job.name}", every ${intervalMinutes}m, next run at ${job.nextRunAt}, output -> ${outputFilename}).\nInitial Run Status: [${initialRun.status}] ${initialRun.summary}`;
  }

  if (op === "run_now") {
    const id = Number(args.scheduleId);
    const job = state.schedules.get(id);
    if (!job) return `Error: Schedule #${id} not found.`;
    const runRes = await runScheduledMonitorOnce(job, tenantKey);
    await persistTenantAgenticState(tenantKey);
    return `Executed schedule #${id} ("${job.name}") -> [${runRes.status}] ${runRes.summary} (logged to ${job.outputFilename}).`;
  }

  if (op === "pause_schedule" || op === "resume_schedule") {
    const id = Number(args.scheduleId);
    const job = state.schedules.get(id);
    if (!job) return `Error: Schedule #${id} not found.`;
    job.enabled = op === "resume_schedule";
    if (job.enabled) {
      job.consecutiveFailures = 0;
      job.nextRunAt = computeNextRunIso(job.intervalMinutes);
      ensureScheduleTickerStarted();
    }
    await persistTenantAgenticState(tenantKey);
    return `Schedule #${id} ("${job.name}") is now ${job.enabled ? "ACTIVE" : "PAUSED"}.`;
  }

  if (op === "delete_schedule") {
    const id = Number(args.scheduleId);
    const existed = state.schedules.delete(id);
    if (existed) await persistTenantAgenticState(tenantKey);
    return existed ? `Deleted schedule #${id}.` : `Error: Schedule #${id} not found.`;
  }

  if (state.schedules.size === 0) {
    return "No autonomous scheduled monitors configured yet. Use operation='create_schedule' to set up a recurring website monitor, web research digest, sandbox job, or swarm audit.";
  }

  const lines = Array.from(state.schedules.values()).map(
    (s) =>
      `• #${s.id} [${s.enabled ? "🟢 ACTIVE" : "⏸️ PAUSED"}] "${s.name}" (${s.actionType}, every ${s.intervalMinutes}m -> ${s.outputFilename}) — Runs: ${s.runCount} | Next: ${s.nextRunAt}${
        s.lastSummary ? ` | Last: [${s.lastStatus}] ${s.lastSummary}` : ""
      }`
  );
  return `Autonomous Scheduled Monitors (${state.schedules.size}):\n${lines.join("\n")}`;
}

/**
 * Retrieve a compact summary of the tenant's active memories, tasks, and files
 * to inject automatically into the agent's system context at the start of a run.
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
    parts.push(
      `Saved Workspace Files (${fileMap.size}): ${Array.from(fileMap.keys()).join(", ")}`
    );
  }

  const schedState = tenantSchedulesStore.get(tenantKey);
  if (schedState && schedState.schedules.size > 0) {
    const schedLines = Array.from(schedState.schedules.values()).map(
      (s) => `• #${s.id} [${s.enabled ? "ACTIVE" : "PAUSED"}] ${s.name} (${s.actionType} -> ${s.outputFilename})`
    );
    parts.push(`Active Scheduled Monitors:\n${schedLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

/**
 * Return the structured snapshot of a tenant's workspace files, tasks, and memories
 * for the interactive Agentic Workspace Hub in `/workspace`.
 */
export function getTenantAgenticSnapshot(tenantKey: string): {
  files: WorkspaceVirtualFile[];
  tasks: AgentTaskItem[];
  memories: Array<{ key: string; fact: string; tags: string[]; updatedAt: string }>;
  schedules: AgentScheduledMonitor[];
} {
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
 * Return a read-only dictionary of all workspace files and contents for a tenant.
 * Used by the sandbox execution engine so scripts can directly inspect files.
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


// ==========================================
// 6. Durable Database Persistence & Non-Destructive Sync
// ==========================================

let agenticStateTableReady = false;
const hydratedTenants = new Set<string>();
const initializedTenants = new Set<string>();

async function ensureAgenticStateTable(sql: any): Promise<void> {
  if (agenticStateTableReady || !sql) return;
  try {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS shunops_agentic_state (
        tenant_key VARCHAR(64) PRIMARY KEY,
        state_json JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    agenticStateTableReady = true;
  } catch {}
}

/**
 * Hydrate in-memory stores from Neon PostgreSQL if not yet loaded in this container instance,
 * merging non-destructively so neither in-memory nor DB records are lost.
 */
export async function hydrateTenantAgenticState(tenantKey: string, force = false): Promise<void> {
  if (!tenantKey || (hydratedTenants.has(tenantKey) && !force)) return;
  hydratedTenants.add(tenantKey);
  const sql = getSql() as any;
  if (!sql) return;
  try {
    await ensureAgenticStateTable(sql);
    const rows = await sql.query(
      `SELECT state_json FROM shunops_agentic_state WHERE tenant_key = $1 LIMIT 1;`,
      [tenantKey]
    );
    const raw = rows?.[0]?.state_json;
    if (!raw) return;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    mergeSnapshotIntoStores(tenantKey, parsed, false);
    initializedTenants.add(tenantKey);
  } catch {}
}

/**
 * Persist the current tenant snapshot to Neon PostgreSQL so serverless cold starts
 * or multi-instance routing never reset or lose workspace records.
 */
export async function persistTenantAgenticState(tenantKey: string): Promise<void> {
  if (!tenantKey) return;
  initializedTenants.add(tenantKey);
  const sql = getSql() as any;
  if (!sql) return;
  try {
    await ensureAgenticStateTable(sql);
    const snap = getTenantAgenticSnapshot(tenantKey);
    await sql.query(
      `INSERT INTO shunops_agentic_state (tenant_key, state_json, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_key) DO UPDATE
       SET state_json = EXCLUDED.state_json,
           updated_at = CURRENT_TIMESTAMP;`,
      [tenantKey, JSON.stringify(snap)]
    );
  } catch {}
}

/**
 * Merge a snapshot (from DB or client cache) into in-memory stores without wiping existing records.
 * Purely synchronous — no recursive hydrate calls!
 */
export function mergeSnapshotIntoStores(
  tenantKey: string,
  snap: {
    files?: WorkspaceVirtualFile[];
    tasks?: AgentTaskItem[];
    memories?: Array<{ key: string; fact: string; tags?: string[]; updatedAt?: string }>;
    schedules?: AgentScheduledMonitor[];
  },
  overwriteExisting = false
): void {
  if (!snap || typeof snap !== "object") return;

  // 1. Files
  if (Array.isArray(snap.files) && snap.files.length > 0) {
    let fileMap = tenantFilesStore.get(tenantKey);
    if (!fileMap) {
      fileMap = new Map<string, WorkspaceVirtualFile>();
      tenantFilesStore.set(tenantKey, fileMap);
    }
    for (const f of snap.files) {
      if (!f || typeof f.name !== "string" || !f.name.trim()) continue;
      if (overwriteExisting || !fileMap.has(f.name)) {
        const contentStr = String(f.content ?? "");
        fileMap.set(f.name, {
          name: f.name,
          content: contentStr,
          sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : Buffer.byteLength(contentStr, "utf8"),
          updatedAt: f.updatedAt || new Date().toISOString(),
        });
      }
    }
  }

  // 2. Tasks
  if (Array.isArray(snap.tasks) && snap.tasks.length > 0) {
    let taskState = tenantTasksStore.get(tenantKey);
    if (!taskState) {
      taskState = { nextId: 1, tasks: new Map<number, AgentTaskItem>() };
      tenantTasksStore.set(tenantKey, taskState);
    }
    for (const t of snap.tasks) {
      if (!t || typeof t.title !== "string" || !t.title.trim()) continue;
      const id = Number(t.id) > 0 ? Number(t.id) : taskState.nextId++;
      if (id >= taskState.nextId) taskState.nextId = id + 1;
      if (overwriteExisting || !taskState.tasks.has(id)) {
        taskState.tasks.set(id, {
          id,
          title: t.title,
          status: t.status === "completed" || t.status === "in_progress" ? t.status : "pending",
          priority: t.priority === "high" || t.priority === "low" ? t.priority : "medium",
          ...(t.notes ? { notes: String(t.notes) } : {}),
          createdAt: t.createdAt || new Date().toISOString(),
          updatedAt: t.updatedAt || new Date().toISOString(),
        });
      }
    }
  }

  // 3. Memories
  if (Array.isArray(snap.memories) && snap.memories.length > 0) {
    let memMap = tenantMemoriesStore.get(tenantKey);
    if (!memMap) {
      memMap = new Map<string, AgentMemoryFact>();
      tenantMemoriesStore.set(tenantKey, memMap);
    }
    for (const m of snap.memories) {
      if (!m || typeof m.key !== "string" || !m.key.trim() || typeof m.fact !== "string") continue;
      if (overwriteExisting || !memMap.has(m.key)) {
        memMap.set(m.key, {
          key: m.key,
          fact: m.fact,
          tags: Array.isArray(m.tags) ? m.tags : [],
          embedding: computeDeterministicEmbedding(`${m.key} ${m.fact}`),
          updatedAt: m.updatedAt || new Date().toISOString(),
        });
      }
    }
  }

  // 4. Schedules
  if (Array.isArray(snap.schedules) && snap.schedules.length > 0) {
    let schedState = tenantSchedulesStore.get(tenantKey);
    if (!schedState) {
      schedState = { nextId: 1, schedules: new Map<number, AgentScheduledMonitor>() };
      tenantSchedulesStore.set(tenantKey, schedState);
    }
    for (const s of snap.schedules) {
      if (!s || typeof s.name !== "string" || !s.name.trim()) continue;
      const id = Number(s.id) > 0 ? Number(s.id) : schedState.nextId++;
      if (id >= schedState.nextId) schedState.nextId = id + 1;
      if (overwriteExisting || !schedState.schedules.has(id)) {
        schedState.schedules.set(id, {
          ...s,
          id,
        });
      }
    }
  }
}

/**
 * Full non-destructive sync: hydrates from DB, merges client-cached state if the
 * server cold-started or has missing records, persists back to DB, and returns the unified snapshot.
 */
export async function syncTenantAgenticState(
  tenantKey: string,
  clientSnapshot?: {
    files?: WorkspaceVirtualFile[];
    tasks?: AgentTaskItem[];
    memories?: Array<{ key: string; fact: string; tags?: string[]; updatedAt?: string }>;
    schedules?: AgentScheduledMonitor[];
  }
) {
  await hydrateTenantAgenticState(tenantKey, true);
  if (clientSnapshot) {
    mergeSnapshotIntoStores(tenantKey, clientSnapshot, false);
  }
  await persistTenantAgenticState(tenantKey);
  return getTenantAgenticSnapshot(tenantKey);
}
