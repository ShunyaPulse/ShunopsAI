import {
  executeManageWorkspaceFiles,
  executeManageAgentTasks,
  executeManageAgentMemory,
  executeAgenticPipeline,
  executeManageAgentSchedules,
  resolveTenantKey,
  type AgenticPipelineStep,
  type ScheduledActionType,
} from "../../tools/agentic.js";
import { executeAgentSwarm, type SwarmSubAgentSpec, type SwarmExecutionMode } from "../swarm.js";
import { resolveWebSearch, type ToolScope } from "../scope.js";
import type { ToolGroup } from "./types.js";

/** Persistent workspace primitives: files, tasks, memory, pipelines, swarms, schedules. */
export const agenticTools: ToolGroup<
  | "manage_workspace_files"
  | "manage_agent_tasks"
  | "manage_agent_memory"
  | "run_agentic_pipeline"
  | "delegate_to_agent_swarm"
  | "manage_agent_schedules"
> = {
  manage_workspace_files: {
    schema: {
      type: "function",
      function: {
        name: "manage_workspace_files",
        description:
          "Creates, reads, appends, lists, searches, or deletes files in the user's isolated Agent Workspace File System. Use this whenever the user asks you to write/save code, scripts, markdown reports, notes, or configs.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["write", "append", "read", "list", "delete", "search"],
              description: "File operation to perform.",
            },
            filename: {
              type: "string",
              description: "Relative filename (e.g., 'plan.md', 'script.js', 'notes.txt'). Required for write, append, read, delete.",
            },
            content: {
              type: "string",
              description: "File content to write or append.",
            },
            query: {
              type: "string",
              description: "Search keyword when operation is 'search'.",
            },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (
      args: {
        operation: "write" | "append" | "read" | "list" | "delete" | "search";
        filename?: string;
        content?: string;
        query?: string;
      },
      scope?: ToolScope
    ) => {
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      return await executeManageWorkspaceFiles(args, tenantKey);
    },
  },

  manage_agent_tasks: {
    schema: {
      type: "function",
      function: {
        name: "manage_agent_tasks",
        description:
          "Manages the persistent Agent Task Planner & Checklist for breaking down multi-step goals, adding todos, updating task statuses (pending, in_progress, completed), and tracking progress.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create_plan", "add_task", "update_task", "list_tasks", "clear_completed"],
              description: "Task planner operation to perform.",
            },
            tasks: {
              type: "array",
              items: { type: "string" },
              description: "Array of step titles when operation is 'create_plan'.",
            },
            title: {
              type: "string",
              description: "Task title when operation is 'add_task'.",
            },
            taskId: {
              type: "number",
              description: "Numeric task ID when operation is 'update_task'.",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "New status for the task.",
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Task priority (default: 'medium').",
            },
            notes: {
              type: "string",
              description: "Optional progress notes or findings attached to the task.",
            },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (
      args: {
        operation: "create_plan" | "add_task" | "update_task" | "list_tasks" | "clear_completed" | "delete_task" | "clear_all";
        tasks?: string[];
        title?: string;
        taskId?: number;
        status?: "pending" | "in_progress" | "completed";
        priority?: "low" | "medium" | "high";
        notes?: string;
      },
      scope?: ToolScope
    ) => {
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      return await executeManageAgentTasks(args, tenantKey);
    },
  },

  manage_agent_memory: {
    schema: {
      type: "function",
      function: {
        name: "manage_agent_memory",
        description:
          "Stores and recalls persistent long-term facts, user preferences, tech stack details, and project decisions across sessions using semantic + keyword retrieval.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["remember", "recall", "list", "forget"],
              description: "Memory operation: 'remember' (save a fact), 'recall' (search memories), 'list' (show all), 'forget' (delete by key).",
            },
            key: {
              type: "string",
              description: "Short identifier key for the memory (e.g., 'user_tech_stack', 'deploy_region').",
            },
            fact: {
              type: "string",
              description: "Detailed fact or preference to remember (required when operation is 'remember').",
            },
            query: {
              type: "string",
              description: "Search query when operation is 'recall'.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags for categorizing the memory.",
            },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (
      args: {
        operation: "remember" | "recall" | "list" | "forget";
        key?: string;
        fact?: string;
        query?: string;
        tags?: string[];
      },
      scope?: ToolScope
    ) => {
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      return await executeManageAgentMemory(args, tenantKey);
    },
  },

  run_agentic_pipeline: {
    schema: {
      type: "function",
      function: {
        name: "run_agentic_pipeline",
        description:
          "Executes a multi-step agentic workflow pipeline in a single chained operation (e.g. create_plan -> web_search -> inspect_website -> execute_code -> write_file -> update_task -> remember). Each step output is automatically passed to subsequent execute_code steps via globalThis.pipelineOutputs.",
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              description: "Ordered list of pipeline steps to execute sequentially (up to 8 steps).",
              items: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: [
                      "create_plan",
                      "update_task",
                      "web_search",
                      "inspect_website",
                      "execute_code",
                      "write_file",
                      "read_file",
                      "remember",
                      "recall",
                    ],
                  },
                  tasks: { type: "array", items: { type: "string" } },
                  taskId: { type: "number" },
                  status: { type: "string", enum: ["pending", "in_progress", "completed"] },
                  notes: { type: "string" },
                  query: { type: "string" },
                  url: { type: "string" },
                  focusQuery: { type: "string" },
                  code: { type: "string" },
                  filename: { type: "string" },
                  content: { type: "string" },
                  append: { type: "boolean" },
                  key: { type: "string" },
                  fact: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["action"],
              },
            },
          },
          required: ["steps"],
        },
      },
    },
    execute: async (args: { steps: AgenticPipelineStep[] }, scope?: ToolScope) => {
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      const webCred = resolveWebSearch(scope);
      return await executeAgenticPipeline(
        args,
        tenantKey,
        webCred.ok && webCred.source === "user" ? webCred.value : undefined
      );
    },
  },

  delegate_to_agent_swarm: {
    schema: {
      type: "function",
      function: {
        name: "delegate_to_agent_swarm",
        description:
          "Spawns a coordinated Multi-Agent Swarm of specialized sub-agents (researcher, coder, analyst, auditor) that collaborate on a Shared Blackboard in parallel or sequential handoff mode, optionally saving the synthesized report to a workspace file.",
        parameters: {
          type: "object",
          properties: {
            objective: {
              type: "string",
              description: "Overall objective for the Multi-Agent Swarm.",
            },
            mode: {
              type: "string",
              enum: ["hybrid_dag", "parallel", "sequential"],
              description: "Execution mode: 'hybrid_dag' (Wave 1 parallel research+code -> Wave 2 analyst -> Wave 3 auditor), 'parallel', or 'sequential'. Default: 'hybrid_dag'.",
            },
            agents: {
              type: "array",
              description: "Up to 4 specialized sub-agents to dispatch.",
              items: {
                type: "object",
                properties: {
                  role: {
                    type: "string",
                    enum: ["researcher", "coder", "analyst", "auditor"],
                  },
                  task: { type: "string" },
                  targetUrl: { type: "string" },
                  searchQuery: { type: "string" },
                  code: { type: "string" },
                },
                required: ["role", "task"],
              },
            },
            saveDeliverableAs: {
              type: "string",
              description: "Optional workspace filename (e.g. 'swarm-report.md') to save the synthesized swarm report.",
            },
          },
          required: ["objective", "agents"],
        },
      },
    },
    execute: async (
      args: {
        objective: string;
        mode?: SwarmExecutionMode;
        agents: SwarmSubAgentSpec[];
        saveDeliverableAs?: string;
      },
      scope?: ToolScope
    ) => {
      const res = await executeAgentSwarm({
        objective: args.objective,
        mode: args.mode,
        agents: args.agents,
        saveDeliverableAs: args.saveDeliverableAs,
        scope,
        keyOverrides: scope?.keyOverrides,
      });
      return res.synthesizedReport;
    },
  },

  manage_agent_schedules: {
    schema: {
      type: "function",
      function: {
        name: "manage_agent_schedules",
        description:
          "Creates, lists, runs, pauses, resumes, or deletes recurring Autonomous Scheduled Monitors & Watchdogs (website health monitors, recurring web research digests, or scheduled sandbox jobs) that log outputs to workspace files.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: [
                "create_schedule",
                "list_schedules",
                "run_now",
                "pause_schedule",
                "resume_schedule",
                "delete_schedule",
              ],
            },
            scheduleId: {
              type: "number",
              description: "Schedule ID for run_now, pause_schedule, resume_schedule, or delete_schedule.",
            },
            name: {
              type: "string",
              description: "Human-readable name for the scheduled monitor.",
            },
            actionType: {
              type: "string",
              enum: ["website_monitor", "web_research_digest", "sandbox_script", "swarm_audit"],
              description: "Type of autonomous recurring job.",
            },
            intervalMinutes: {
              type: "number",
              description: "Interval in minutes between runs (5 to 1440, default: 30).",
            },
            targetUrl: {
              type: "string",
              description: "URL to inspect when actionType is 'website_monitor'.",
            },
            query: {
              type: "string",
              description: "Search query or focus keyword.",
            },
            code: {
              type: "string",
              description: "JavaScript code to run when actionType is 'sandbox_script'.",
            },
            outputFilename: {
              type: "string",
              description: "Workspace file where monitor logs/digests are appended (e.g. 'uptime-log.md').",
            },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (
      args: {
        operation:
          | "create_schedule"
          | "list_schedules"
          | "run_now"
          | "pause_schedule"
          | "resume_schedule"
          | "delete_schedule";
        scheduleId?: number;
        name?: string;
        actionType?: ScheduledActionType;
        intervalMinutes?: number;
        targetUrl?: string;
        query?: string;
        code?: string;
        outputFilename?: string;
      },
      scope?: ToolScope
    ) => {
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      return await executeManageAgentSchedules(args, tenantKey);
    },
  },
};
