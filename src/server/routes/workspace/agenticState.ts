import type { FastifyInstance } from "fastify";
import {
  executeManageWorkspaceFiles,
  executeManageAgentTasks,
  executeManageAgentMemory,
  executeManageAgentSchedules,
  getTenantAgenticSnapshot,
  hydrateTenantAgenticState,
  syncTenantAgenticState,
  type ScheduledActionType,
} from "../../../tools/agentic.js";
import {
  executeAgentSwarm,
  getTenantSwarmHistory,
  type SwarmSubAgentSpec,
  type SwarmExecutionMode,
} from "../../../agent/swarm.js";
import { buildRequestScope } from "../../scope.js";
import { isPrivateHost } from "../../../tools/cloud.js";
import { tenantKeyFor, type WorkspaceRouteDeps } from "./shared.js";

/** Weak ETag over the serialized tenant snapshot. */
function snapshotEtag(rawJson: string): string {
  let h = 2166136261;
  for (let i = 0; i < rawJson.length; i++) {
    h ^= rawJson.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `W/"ag-${h.toString(16)}-${rawJson.length}"`;
}

/** Reject swarm target URLs outside the public http(s) surface. */
function sanitizeSwarmAgents(agents: SwarmSubAgentSpec[]): SwarmSubAgentSpec[] {
  return agents.map((a) => {
    let safeTargetUrl: string | undefined;
    if (typeof a.targetUrl === "string" && a.targetUrl.trim()) {
      try {
        const raw = a.targetUrl.trim();
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        if (
          (u.protocol === "http:" || u.protocol === "https:") &&
          !isPrivateHost(u.hostname) &&
          /^[a-zA-Z0-9_.-]+$/.test(u.hostname)
        ) {
          const port = u.port ? `:${u.port}` : "";
          safeTargetUrl = `${u.protocol}//${u.hostname}${port}${u.pathname}${u.search}`;
        }
      } catch {}
    }
    return { ...a, targetUrl: safeTargetUrl };
  });
}

/** Workspace hub: state hydration, tasks, files, memories, schedules and swarms. */
export function registerAgenticStateRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { requireAuth } = deps;

  // 3b. Agentic Workspace Hub Snapshot (Tasks, Files, Memories, Schedules) with DB hydration & ETag
  app.get("/api/workspace/agentic-state", { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantKey = tenantKeyFor((req as any).user);
    await hydrateTenantAgenticState(tenantKey);
    const snapshot = getTenantAgenticSnapshot(tenantKey);
    const rawJson = JSON.stringify(snapshot);
    const etag = snapshotEtag(rawJson);
    reply.header("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      reply.status(304);
      return "";
    }
    return { success: true, ...snapshot };
  });

  // 3b-sync. Non-Destructive Sync (Merges client local state + DB state + memory state)
  app.post("/api/workspace/agentic-state/sync", { preHandler: [requireAuth] }, async (req) => {
    const tenantKey = tenantKeyFor((req as any).user);
    const body = (req.body || {}) as any;
    const merged = await syncTenantAgenticState(tenantKey, {
      files: Array.isArray(body.files) ? body.files : undefined,
      tasks: Array.isArray(body.tasks) ? body.tasks : undefined,
      memories: Array.isArray(body.memories) ? body.memories : undefined,
      schedules: Array.isArray(body.schedules) ? body.schedules : undefined,
    });
    return { success: true, ...merged };
  });

  // 3c. Interactive Task Planner Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "create_plan" | "add_task" | "update_task" | "list_tasks" | "clear_completed";
      tasks?: string[];
      title?: string;
      taskId?: number;
      status?: "pending" | "in_progress" | "completed";
      priority?: "low" | "medium" | "high";
      notes?: string;
    };
  }>("/api/workspace/agent-tasks", { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantKey = tenantKeyFor((req as any).user);
    const body = req.body || {};
    const message = await executeManageAgentTasks(
      {
        operation: body.operation || "list_tasks",
        tasks: body.tasks,
        title: body.title,
        taskId: body.taskId,
        status: body.status,
        priority: body.priority,
        notes: body.notes,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return { success: true, message, ...getTenantAgenticSnapshot(tenantKey) };
  });

  // 3d. Interactive Workspace File System Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "write" | "append" | "read" | "list" | "delete" | "search";
      filename?: string;
      content?: string;
      query?: string;
    };
  }>("/api/workspace/files", { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantKey = tenantKeyFor((req as any).user);
    const body = req.body || {};
    const message = await executeManageWorkspaceFiles(
      {
        operation: body.operation || "list",
        filename: body.filename,
        content: body.content,
        query: body.query,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return { success: true, message, ...getTenantAgenticSnapshot(tenantKey) };
  });

  // 3e. Interactive Long-Term Memory Operations from Workspace UI
  app.post<{
    Body: {
      operation?: "remember" | "recall" | "list" | "forget";
      key?: string;
      fact?: string;
      query?: string;
      tags?: string[];
    };
  }>("/api/workspace/memories", { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantKey = tenantKeyFor((req as any).user);
    const body = req.body || {};
    const message = await executeManageAgentMemory(
      {
        operation: body.operation || "list",
        key: body.key,
        fact: body.fact,
        query: body.query,
        tags: body.tags,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return { success: true, message, ...getTenantAgenticSnapshot(tenantKey) };
  });

  // 3g. Interactive Autonomous Scheduled Monitors from Workspace UI
  app.post<{
    Body: {
      operation?: "create_schedule" | "list_schedules" | "run_now" | "pause_schedule" | "resume_schedule" | "delete_schedule";
      scheduleId?: number;
      name?: string;
      actionType?: ScheduledActionType;
      intervalMinutes?: number;
      targetUrl?: string;
      query?: string;
      code?: string;
      outputFilename?: string;
    };
  }>("/api/workspace/schedules", { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantKey = tenantKeyFor((req as any).user);
    const body = req.body || {};
    const message = await executeManageAgentSchedules(
      {
        operation: body.operation || "list_schedules",
        scheduleId: body.scheduleId,
        name: body.name,
        actionType: body.actionType,
        intervalMinutes: body.intervalMinutes,
        targetUrl: body.targetUrl,
        query: body.query,
        code: body.code,
        outputFilename: body.outputFilename,
      },
      tenantKey
    );
    if (message.startsWith("Error:")) {
      reply.status(400);
      return { success: false, error: message };
    }
    return { success: true, message, ...getTenantAgenticSnapshot(tenantKey) };
  });

  // 3h. Interactive Multi-Agent Swarm Dispatcher from Workspace UI
  app.post<{
    Body: {
      objective?: string;
      mode?: SwarmExecutionMode;
      agents?: SwarmSubAgentSpec[];
      saveDeliverableAs?: string;
    };
  }>("/api/workspace/swarm", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = (req as any).user;
    const tenantKey = tenantKeyFor(user);
    const body = req.body || {};
    const objective = String(body.objective || "").trim();
    const agents = Array.isArray(body.agents) ? body.agents : [];
    if (!objective || agents.length === 0) {
      reply.status(400);
      return { success: false, error: "Swarm objective and at least one sub-agent are required." };
    }

    const scope = await buildRequestScope(user);
    const result = await executeAgentSwarm({
      objective,
      mode: body.mode || "hybrid_dag",
      agents: sanitizeSwarmAgents(agents),
      saveDeliverableAs: body.saveDeliverableAs,
      scope,
    });
    return { success: true, swarm: result, ...getTenantAgenticSnapshot(tenantKey) };
  });

  app.get("/api/workspace/swarm-history", { preHandler: [requireAuth] }, async (req) => {
    const tenantKey = tenantKeyFor((req as any).user);
    return { success: true, history: getTenantSwarmHistory(tenantKey) };
  });
}
