import { randomUUID } from "node:crypto";
import { runAutonomousAgent, type ProviderKeyOverrides } from "../agent/index.js";
import type { ToolScope } from "../agent/scope.js";
import { getRedisClient } from "./redis.js";
import { saveTaskRecord, getTaskRecord, recordUserTokenUsage } from "./db.js";

export interface QueuedTaskState {
  id: string;
  userId?: number | undefined;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  goal: string;
  createdAt: string;
  completedAt?: string | undefined;
  result?: {
    success: boolean;
    finalAnswer: string;
    stepsTaken: number;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | undefined;
  } | undefined;
  error?: string | undefined;
}

const taskStore = new Map<string, QueuedTaskState>();

// Bounds so a long-running server cannot accumulate task state without limit.
const MAX_TASK_ENTRIES = Number(process.env.MAX_TASK_STATE_ENTRIES) || 500;
const TASK_RETENTION_MS = Number(process.env.TASK_STATE_RETENTION_MS) || 24 * 60 * 60 * 1000;

/** Evict finished tasks past their retention window and cap the total size. */
function pruneTaskStore(): void {
  const now = Date.now();
  for (const [id, task] of taskStore) {
    const age = now - new Date(task.createdAt).getTime();
    const terminal = task.status === "COMPLETED" || task.status === "FAILED";
    if (terminal && age > TASK_RETENTION_MS) taskStore.delete(id);
  }
  while (taskStore.size > MAX_TASK_ENTRIES) {
    const oldest = taskStore.keys().next().value;
    if (oldest === undefined) break;
    taskStore.delete(oldest);
  }
}

async function persistTask(task: QueuedTaskState) {
  taskStore.set(task.id, task);
  pruneTaskStore();

  // 1. Centralized Redis caching
  const r = getRedisClient();
  if (r && r.status === "ready") {
    try {
      await r.set(`shunops:task:${task.id}`, JSON.stringify(task), "EX", 86400 * 7); // 7-day TTL
    } catch {
      // Non-blocking fallback
    }
  }

  // 2. Persistent Postgres Storage
  try {
    await saveTaskRecord({
      id: task.id,
      userId: task.userId,
      goal: task.goal,
      status: task.status,
      stepsTaken: task.result?.stepsTaken,
      finalAnswer: task.result?.finalAnswer,
      error: task.error,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
  } catch {
    // Non-blocking fallback
  }
}

export async function getTaskState(taskId: string): Promise<QueuedTaskState | undefined> {
  const mem = taskStore.get(taskId);
  if (mem) return mem;

  const r = getRedisClient();
  if (r && r.status === "ready") {
    try {
      const raw = await r.get(`shunops:task:${taskId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        taskStore.set(taskId, parsed);
        return parsed;
      }
    } catch {
      // Fallback
    }
  }

  // Fallback to database
  try {
    const dbRecord = await getTaskRecord(taskId);
    if (dbRecord) {
      const taskState: QueuedTaskState = {
        id: dbRecord.id,
        userId: dbRecord.user_id,
        goal: dbRecord.goal,
        status: dbRecord.status,
        createdAt: dbRecord.created_at,
        completedAt: dbRecord.completed_at,
        result: dbRecord.final_answer
          ? {
              success: dbRecord.status === "COMPLETED",
              finalAnswer: dbRecord.final_answer,
              stepsTaken: dbRecord.steps_taken || 0,
            }
          : undefined,
        error: dbRecord.error,
      };
      taskStore.set(taskId, taskState);
      return taskState;
    }
  } catch {}

  return undefined;
}

export function createQueuedTask(
  goal: string,
  maxSteps = 6,
  context?: string | undefined,
  userId?: number | undefined,
  keyOverrides?: ProviderKeyOverrides | undefined,
  /** Tenant scope captured at request time, so the background run cannot escalate. */
  scope?: ToolScope | undefined,
  meteringOpts?: { isBYOK?: boolean; isAdmin?: boolean } | undefined
): QueuedTaskState {
  const id = `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const task: QueuedTaskState = {
    id,
    userId,
    status: "QUEUED",
    goal,
    createdAt: new Date().toISOString(),
  };
  persistTask(task).catch(() => {});

  // Background execution
  setTimeout(async () => {
    task.status = "RUNNING";
    await persistTask(task);
    try {
      const result = await runAutonomousAgent(goal, {
        maxSteps,
        ...(context ? { initialContext: context } : {}),
        keyOverrides,
        ...(scope ? { scope } : {}),
      });
      task.status = result.success ? "COMPLETED" : "FAILED";
      task.completedAt = new Date().toISOString();
      const inTokens = result.usage?.promptTokens || Math.ceil(goal.length / 4);
      const outTokens = result.usage?.completionTokens || Math.ceil((result.finalAnswer || "").length / 4);
      task.result = {
        success: result.success,
        finalAnswer: result.finalAnswer ?? "",
        stepsTaken: result.stepsTaken,
        usage: {
          promptTokens: inTokens,
          completionTokens: outTokens,
          totalTokens: inTokens + outTokens,
        },
      };

      // Meter token usage for non-admin tenant runs when not using BYOK inference keys
      if (!meteringOpts?.isAdmin && userId && userId > 0 && !meteringOpts?.isBYOK) {
        await recordUserTokenUsage(userId, inTokens, outTokens).catch(() => {});
      }
    } catch {
      task.status = "FAILED";
      task.completedAt = new Date().toISOString();
      task.error = "Agent task execution failed."; // Redacted: raw messages may contain sensitive paths or credentials
    }
    await persistTask(task);
  }, 10);

  return task;
}
