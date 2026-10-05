import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { runAutonomousAgent } from "../agent/index.js";

export interface QueuedTaskState {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  goal: string;
  createdAt: string;
  completedAt?: string;
  result?: {
    success: boolean;
    finalAnswer: string;
    stepsTaken: number;
  };
  error?: string;
}

const taskStore = new Map<string, QueuedTaskState>();

let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  if (!url && !host) return null;

  try {
    redisClient = url
      ? new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true })
      : new Redis({
          host: host || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
    redisClient.connect().catch(() => {});
  } catch {
    redisClient = null;
  }
  return redisClient;
}

async function persistTask(task: QueuedTaskState) {
  taskStore.set(task.id, task);
  const r = getRedis();
  if (r && r.status === "ready") {
    try {
      await r.set(`shunops:task:${task.id}`, JSON.stringify(task), "EX", 86400 * 7); // 7-day TTL
    } catch {
      // Non-blocking
    }
  }
}

export async function getTaskState(taskId: string): Promise<QueuedTaskState | undefined> {
  const mem = taskStore.get(taskId);
  if (mem) return mem;

  const r = getRedis();
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
  return undefined;
}

export function createQueuedTask(goal: string, maxSteps = 6, context?: string): QueuedTaskState {
  const id = `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const task: QueuedTaskState = {
    id,
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
      });
      task.status = result.success ? "COMPLETED" : "FAILED";
      task.completedAt = new Date().toISOString();
      task.result = {
        success: result.success,
        finalAnswer: result.finalAnswer ?? "",
        stepsTaken: result.stepsTaken,
      };
    } catch (err: any) {
      task.status = "FAILED";
      task.completedAt = new Date().toISOString();
      task.error = err?.message || String(err);
    }
    await persistTask(task);
  }, 10);

  return task;
}
