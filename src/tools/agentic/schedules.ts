import { errorMessage } from "../../core/errors.js";
import { executeInSandbox } from "../../agent/sandbox/runner.js";
import { executeWebSearch, inspectWebsite } from "../cloud.js";
import {
  executeManageWorkspaceFiles,
  persistSandboxWrittenFiles,
  sanitizeFileName,
} from "./files.js";
import { executeManageAgentMemory } from "./memory.js";
import { hydrateTenantAgenticState, persistTenantAgenticState } from "./persistence.js";
import { getOrCreateScheduleState, getTenantFilesMap, tenantSchedulesStore } from "./store.js";
import type { AgentScheduledMonitor, ScheduledActionType } from "./types.js";
import {
  MAX_CONSECUTIVE_SCHEDULE_FAILURES,
  MAX_SCHEDULES_PER_TENANT,
} from "./types.js";

/**
 * 5. Autonomous Scheduled Monitors & Watchdogs (`manage_agent_schedules`)
 *
 * Recursive jobs (website health, research digests, sandbox scripts, swarm
 * audits) that the agent can create, run on demand, pause and delete. A single
 * unref'd ticker runs due jobs; five consecutive failures auto-pause a job.
 */

type RunStatus = "OK" | "ALERT" | "ERROR";
type RunOutcome = { status: RunStatus; summary: string };

const SCHEDULE_ACTIONS: ReadonlyArray<ScheduledActionType> = [
  "website_monitor",
  "web_research_digest",
  "sandbox_script",
  "swarm_audit",
];

const DEFAULT_OUTPUT_FILES: Record<ScheduledActionType, string> = {
  website_monitor: "monitor-log.md",
  web_research_digest: "research-digest.md",
  sandbox_script: "sandbox-cron.md",
  swarm_audit: "swarm-watchdog.md",
};

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const TICK_INTERVAL_MS = 60_000;
const SANDBOX_JOB_TIMEOUT_MS = 5000;

let scheduleTickerHandle: ReturnType<typeof setInterval> | null = null;

export function computeNextRunIso(intervalMinutes: number, fromMs = Date.now()): string {
  return new Date(fromMs + intervalMinutes * 60_000).toISOString();
}

function autoPauseIfFailing(job: AgentScheduledMonitor, suffix: string): void {
  if (job.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
    job.enabled = false;
    job.lastSummary += suffix;
  }
}

async function appendToOutputFile(
  tenantKey: string,
  job: AgentScheduledMonitor,
  content: string
): Promise<void> {
  await executeManageWorkspaceFiles(
    { operation: "append", filename: job.outputFilename, content },
    tenantKey
  );
}

async function runWebsiteMonitor(
  job: AgentScheduledMonitor,
  tenantKey: string,
  nowIso: string,
  startedAt: number
): Promise<RunOutcome> {
  const raw = await inspectWebsite(job.targetUrl || "https://example.com", job.query);
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}

  const httpStatus = parsed?.status || 0;
  const latencyMs = parsed?.latencyMs || 0;
  const isAlert = !httpStatus || httpStatus >= 400 || latencyMs > 5000;

  job.lastStatus = isAlert ? "ALERT" : "OK";
  job.lastDurationMs = Math.max(1, Date.now() - startedAt);
  job.consecutiveFailures = isAlert ? job.consecutiveFailures + 1 : 0;
  job.lastSummary = `HTTP ${httpStatus || "ERR"} • ${latencyMs}ms (${job.targetUrl})`;

  const logLine =
    `- **[${nowIso}]** ` +
    (isAlert ? "🚨 ALERT" : "✅ HEALTHY") +
    ` — URL: ${job.targetUrl} | Status: ${httpStatus || "ERR"} | Latency: ${latencyMs}ms`;
  await appendToOutputFile(tenantKey, job, logLine);

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

  autoPauseIfFailing(job, " [Auto-paused after 5 consecutive alerts]");
  return { status: job.lastStatus, summary: job.lastSummary };
}

async function runResearchDigest(
  job: AgentScheduledMonitor,
  tenantKey: string,
  nowIso: string,
  startedAt: number
): Promise<RunOutcome> {
  const searchOut = await executeWebSearch(job.query || job.name, { maxResults: 4 });
  job.lastStatus = "OK";
  job.consecutiveFailures = 0;
  job.lastDurationMs = Math.max(1, Date.now() - startedAt);

  const isAudit = job.actionType === "swarm_audit";
  const label = isAudit ? "🐝 Swarm Security & Research Audit" : "📰 Research Digest";
  job.lastSummary = `${isAudit ? "Audited" : "Fetched digest for"} "${job.query || job.name}" -> ${job.outputFilename} (${job.lastDurationMs}ms)`;

  await appendToOutputFile(
    tenantKey,
    job,
    `## ${label}: ${job.name} (${nowIso})\n${searchOut.slice(0, 2000)}\n`
  );
  return { status: "OK", summary: job.lastSummary };
}

async function runSandboxScript(
  job: AgentScheduledMonitor,
  tenantKey: string,
  nowIso: string,
  startedAt: number
): Promise<RunOutcome> {
  const sandbox = await executeInSandbox(job.code || "return null;", {
    timeoutMs: SANDBOX_JOB_TIMEOUT_MS,
    workspaceFiles: getTenantFilesMap(tenantKey),
  });
  job.lastDurationMs = Math.max(1, Date.now() - startedAt);

  if (!sandbox.success) {
    job.lastStatus = "ERROR";
    job.consecutiveFailures++;
    job.lastSummary = `Sandbox error: ${sandbox.error}`;
    autoPauseIfFailing(job, " [Auto-paused after 5 consecutive errors]");
    return { status: "ERROR", summary: job.lastSummary };
  }

  job.consecutiveFailures = 0;
  await persistSandboxWrittenFiles(sandbox.writtenFiles, tenantKey);
  const valueStr = sandbox.result !== null ? JSON.stringify(sandbox.result) : "completed";
  job.lastStatus = "OK";
  job.lastSummary = `Executed in ${sandbox.executionTimeMs}ms -> ${valueStr.slice(0, 120)}`;

  await appendToOutputFile(
    tenantKey,
    job,
    `- **[${nowIso}]** Sandbox Job "${job.name}" (${sandbox.executionTimeMs}ms): ${valueStr.slice(0, 300)}`
  );
  return { status: "OK", summary: job.lastSummary };
}

export async function runScheduledMonitorOnce(
  job: AgentScheduledMonitor,
  tenantKey: string
): Promise<RunOutcome> {
  const startedAt = Date.now();
  const nowIso = new Date(startedAt).toISOString();
  job.lastRunAt = nowIso;
  job.nextRunAt = computeNextRunIso(job.intervalMinutes, startedAt);
  job.runCount++;

  try {
    switch (job.actionType) {
      case "website_monitor":
        return await runWebsiteMonitor(job, tenantKey, nowIso, startedAt);
      case "web_research_digest":
      case "swarm_audit":
        return await runResearchDigest(job, tenantKey, nowIso, startedAt);
      case "sandbox_script":
        return await runSandboxScript(job, tenantKey, nowIso, startedAt);
      default:
        job.lastStatus = "ERROR";
        job.lastSummary = `Unsupported actionType: ${job.actionType}`;
        return { status: "ERROR", summary: job.lastSummary };
    }
  } catch (err) {
    job.lastStatus = "ERROR";
    job.consecutiveFailures++;
    job.lastDurationMs = Math.max(1, Date.now() - startedAt);
    job.lastSummary = errorMessage(err);
    if (job.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
      job.enabled = false;
    }
    return { status: "ERROR", summary: job.lastSummary || "Monitor execution failed" };
  }
}

/**
 * Run every due, enabled schedule across all tenants.
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
  }, TICK_INTERVAL_MS);
  if (typeof scheduleTickerHandle.unref === "function") {
    scheduleTickerHandle.unref();
  }
}

function resolveActionType(args: {
  actionType?: ScheduledActionType | undefined;
  targetUrl?: string | undefined;
  code?: string | undefined;
}): ScheduledActionType {
  if (args.actionType && SCHEDULE_ACTIONS.includes(args.actionType)) {
    return args.actionType;
  }
  if (args.targetUrl) return "website_monitor";
  if (args.code) return "sandbox_script";
  return "web_research_digest";
}

function clampIntervalMinutes(raw: unknown): number {
  return Math.min(Math.max(Number(raw) || DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES);
}

function createSchedule(
  state: { nextId: number; schedules: Map<number, AgentScheduledMonitor> },
  args: {
    name?: string | undefined;
    actionType?: ScheduledActionType | undefined;
    intervalMinutes?: number | undefined;
    targetUrl?: string | undefined;
    query?: string | undefined;
    code?: string | undefined;
    outputFilename?: string | undefined;
  }
): AgentScheduledMonitor {
  const actionType = resolveActionType(args);
  const id = state.nextId++;
  const intervalMinutes = clampIntervalMinutes(args.intervalMinutes);

  let outputFilename = DEFAULT_OUTPUT_FILES[actionType];
  try {
    if (args.outputFilename) outputFilename = sanitizeFileName(args.outputFilename);
  } catch {}

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
    createdAt: new Date().toISOString(),
  };
  state.schedules.set(id, job);
  return job;
}

function formatScheduleList(schedules: Map<number, AgentScheduledMonitor>): string {
  if (schedules.size === 0) {
    return "No autonomous scheduled monitors configured yet. Use operation='create_schedule' to set up a recurring website monitor, web research digest, sandbox job, or swarm audit.";
  }
  const lines = Array.from(schedules.values()).map(
    (s) =>
      `• #${s.id} [${s.enabled ? "🟢 ACTIVE" : "⏸️ PAUSED"}] "${s.name}" (${s.actionType}, every ${s.intervalMinutes}m -> ${s.outputFilename}) — Runs: ${s.runCount} | Next: ${s.nextRunAt}${
        s.lastSummary ? ` | Last: [${s.lastStatus}] ${s.lastSummary}` : ""
      }`
  );
  return `Autonomous Scheduled Monitors (${schedules.size}):\n${lines.join("\n")}`;
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
  const state = getOrCreateScheduleState(tenantKey);
  const op = args.operation;

  if (op === "create_schedule") {
    if (state.schedules.size >= MAX_SCHEDULES_PER_TENANT) {
      return `Error: Maximum schedule limit (${MAX_SCHEDULES_PER_TENANT}) reached. Delete unused schedules first.`;
    }
    const job = createSchedule(state, args);
    ensureScheduleTickerStarted();

    // Run once immediately so the user sees output in their workspace file.
    const initialRun = await runScheduledMonitorOnce(job, tenantKey);
    await persistTenantAgenticState(tenantKey);
    return `Created schedule #${job.id} ("${job.name}", every ${job.intervalMinutes}m, next run at ${job.nextRunAt}, output -> ${job.outputFilename}).\nInitial Run Status: [${initialRun.status}] ${initialRun.summary}`;
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

  return formatScheduleList(state.schedules);
}
