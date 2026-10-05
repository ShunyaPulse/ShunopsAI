import { randomUUID } from "node:crypto";
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

export function getTaskState(taskId: string): QueuedTaskState | undefined {
  return taskStore.get(taskId);
}

export function createQueuedTask(goal: string, maxSteps = 6, context?: string): QueuedTaskState {
  const id = `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const task: QueuedTaskState = {
    id,
    status: "QUEUED",
    goal,
    createdAt: new Date().toISOString(),
  };
  taskStore.set(id, task);

  // Background execution
  setTimeout(async () => {
    task.status = "RUNNING";
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
  }, 10);

  return task;
}
