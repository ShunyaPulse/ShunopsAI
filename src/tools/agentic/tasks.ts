import { hydrateTenantAgenticState, persistTenantAgenticState } from "./persistence.js";
import { getOrCreateTaskState, tenantTasksStore } from "./store.js";
import type { AgentTaskItem } from "./types.js";
import { MAX_TASKS_PER_TENANT } from "./types.js";

/**
 * 2. Persistent Agent Task Planner (`manage_agent_tasks`)
 *
 * Keeps a per-tenant checklist so a long run can report progress. Creating a
 * plan starts the first step; completing a step advances the next pending one.
 */

const TASK_STATUSES: ReadonlyArray<AgentTaskItem["status"]> = [
  "pending",
  "in_progress",
  "completed",
];
const TASK_PRIORITIES: ReadonlyArray<AgentTaskItem["priority"]> = ["low", "medium", "high"];

function isTaskStatus(value: unknown): value is AgentTaskItem["status"] {
  return TASK_STATUSES.includes(value as AgentTaskItem["status"]);
}

function isTaskPriority(value: unknown): value is AgentTaskItem["priority"] {
  return TASK_PRIORITIES.includes(value as AgentTaskItem["priority"]);
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

type TaskState = { nextId: number; tasks: Map<number, AgentTaskItem> };

function normalizeTitles(tasks: unknown): string[] {
  return Array.isArray(tasks)
    ? tasks.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
}

function createPlan(
  state: TaskState,
  titles: string[],
  priority: AgentTaskItem["priority"] | undefined,
  now: string
): AgentTaskItem[] {
  const created: AgentTaskItem[] = [];
  for (let i = 0; i < titles.slice(0, 20).length; i++) {
    if (state.tasks.size >= MAX_TASKS_PER_TENANT) break;
    const id = state.nextId++;
    const item: AgentTaskItem = {
      id,
      title: titles[i]!.slice(0, 240),
      // The step the agent should work on first starts in progress.
      status: i === 0 ? "in_progress" : "pending",
      priority: priority || "medium",
      createdAt: now,
      updatedAt: now,
    };
    state.tasks.set(id, item);
    created.push(item);
  }
  return created;
}

function advanceNextPendingTask(tasks: Map<number, AgentTaskItem>, now: string): void {
  const hasInProgress = Array.from(tasks.values()).some((t) => t.status === "in_progress");
  if (hasInProgress) return;
  const nextPending = Array.from(tasks.values()).find((t) => t.status === "pending");
  if (nextPending) {
    nextPending.status = "in_progress";
    nextPending.updatedAt = now;
  }
}

export async function executeManageAgentTasks(
  args: {
    operation:
      | "create_plan"
      | "add_task"
      | "update_task"
      | "list_tasks"
      | "clear_completed"
      | "delete_task"
      | "clear_all";
    tasks?: string[] | undefined;
    title?: string | undefined;
    taskId?: number | undefined;
    status?: AgentTaskItem["status"] | undefined;
    priority?: AgentTaskItem["priority"] | undefined;
    notes?: string | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  const state = getOrCreateTaskState(tenantKey);
  const now = new Date().toISOString();

  switch (args.operation) {
    case "create_plan": {
      const titles = normalizeTitles(args.tasks);
      if (titles.length === 0) {
        return "Error: Provide a non-empty 'tasks' string array for operation='create_plan'.";
      }
      const created = createPlan(state, titles, args.priority, now);
      await persistTenantAgenticState(tenantKey);
      return formatTaskBoard(state.tasks, `Created plan with ${created.length} step(s):`);
    }

    case "add_task": {
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

    case "update_task": {
      const id = Number(args.taskId);
      const existing = state.tasks.get(id);
      if (!existing) {
        return `Error: Task #${id} not found. Run operation='list_tasks' to see valid task IDs.`;
      }
      if (isTaskStatus(args.status)) existing.status = args.status;
      if (isTaskPriority(args.priority)) existing.priority = args.priority;
      if (args.notes !== undefined) existing.notes = String(args.notes).slice(0, 400);
      existing.updatedAt = now;

      if (existing.status === "completed") {
        advanceNextPendingTask(state.tasks, now);
      }

      await persistTenantAgenticState(tenantKey);
      return formatTaskBoard(
        state.tasks,
        `Updated task #${id} -> [${existing.status.toUpperCase()}]:`
      );
    }

    case "clear_completed": {
      let removed = 0;
      for (const [id, task] of state.tasks.entries()) {
        if (task.status === "completed") {
          state.tasks.delete(id);
          removed++;
        }
      }
      await persistTenantAgenticState(tenantKey);
      return formatTaskBoard(state.tasks, `Cleared ${removed} completed task(s):`);
    }

    case "delete_task": {
      const id = Number(args.taskId);
      if (!state.tasks.delete(id)) return `Error: Task #${id} not found.`;
      await persistTenantAgenticState(tenantKey);
      return formatTaskBoard(state.tasks, `Deleted task #${id}:`);
    }

    case "clear_all": {
      const count = state.tasks.size;
      state.tasks.clear();
      await persistTenantAgenticState(tenantKey);
      return formatTaskBoard(state.tasks, `Cleared all ${count} task(s).`);
    }

    default:
      return formatTaskBoard(state.tasks, "Current Agent Task Plan:");
  }
}

/**
 * Close out steps left `in_progress` once a run executed downstream deliverable
 * tools, so a finished run never reports a stuck checklist — unless the user
 * explicitly asked to keep a step in progress.
 */
export function autoSyncTasksOnRunCompletion(
  tenantKey: string,
  executedToolNames: string[],
  userGoal = ""
): void {
  const state = tenantTasksStore.get(tenantKey);
  if (!state || state.tasks.size === 0) return;

  if (/\bmark\b.*\bin[_\s-]?progress\b/i.test(userGoal)) {
    return;
  }

  const nonTaskTools = executedToolNames.filter((n) => n !== "manage_agent_tasks");
  if (nonTaskTools.length === 0) return;

  const now = new Date().toISOString();
  for (const task of state.tasks.values()) {
    if (task.status === "in_progress") {
      task.status = "completed";
      task.updatedAt = now;
    }
  }
}
