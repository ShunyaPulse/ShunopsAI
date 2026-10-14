import OpenAI from "openai";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  executeNeonSql,
  executeRedisCommand,
  manageGitHub,
  manageCloudRun,
  manageCloudflare,
  inspectWebsite,
  manageComputeEngine,
} from "../tools/cloud.js";
import { startVideoJob, manageKaggle, publishJobToYouTube } from "../tools/video.js";
import { requestHumanApproval } from "../tools/safety.js";
import { runComprehensiveSentinelScan, formatSentinelReportMarkdown, autoHealService } from "../tools/sentinel.js";
import { runCloudflareAiInference } from "../tools/cloudflare-ai.js";
import { runDualModelConsensus } from "../ai/consensus.js";
import { runAutoAlertResolver } from "../tools/code-scanner-resolver.js";
import { resolveInsideProject, listDirectoryTree, assertAccessible } from "./sandbox.js";
import {
  resolveNeon,
  resolveRedis,
  resolveGitHub,
  resolveCloudflare,
  isToolAllowedForScope,
  hostToolRefusal,
  type ToolScope,
} from "./scope.js";
import { searchKnowledgeHybrid, indexKnowledgeDocument } from "../server/db.js";

const execAsync = promisify(exec);

// ==========================================
// Real & Safe Execution Tools
// ==========================================

export interface ToolDefinition {
  schema: OpenAI.ChatCompletionTool;
  /**
   * `scope` identifies whose accounts this run may touch. Platform tools resolve
   * credentials from it and refuse (rather than escalate to server credentials)
   * when the caller has not connected that platform.
   */
  execute: (args: any, scope?: ToolScope) => Promise<string>;
}

export type ToolName =
  | "run_shell_command"
  | "read_file"
  | "write_file"
  | "list_directory"
  | "execute_neon_sql"
  | "execute_redis_command"
  | "manage_github"
  | "manage_cloud_run"
  | "manage_cloudflare"
  | "inspect_website"
  | "manage_compute_engine"
  | "produce_video"
  | "manage_kaggle"
  | "publish_to_youtube"
  | "ask_user_confirmation"
  | "sentinel_health_check"
  | "auto_heal_service"
  | "run_cloudflare_ai"
  | "dual_model_consensus"
  | "resolve_code_scanning_alerts"
  | "search_knowledge_base"
  | "index_knowledge_document"
  | "execute_sandboxed_code";

export const toolRegistry: Record<ToolName, ToolDefinition> = {
  run_shell_command: {
    schema: {
      type: "function",
      function: {
        name: "run_shell_command",
        description:
          "Executes a shell command on the host system within a timeout (default 30s) and returns stdout and stderr.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute (e.g., 'npm test', 'git status', 'ls -la', 'dir')",
            },
            cwd: {
              type: "string",
              description: "Optional working directory relative to current working directory",
            },
            timeoutMs: {
              type: "number",
              description: "Optional execution timeout in milliseconds (default: 30000ms)",
            },
          },
          required: ["command"],
        },
      },
    },
    execute: async (args: { command: string; cwd?: string; timeoutMs?: number }) => {
      let workingDir = process.cwd();
      try {
        workingDir = args.cwd ? resolveInsideProject(args.cwd) : process.cwd();
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
      // Cap timeout to 60 seconds maximum to prevent runner lockups
      const timeout = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 60000);

      try {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: workingDir,
          timeout,
          maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        });

        const outputParts: string[] = [];
        if (stdout && stdout.trim().length > 0) {
          outputParts.push(`--- STDOUT ---\n${stdout.trim()}`);
        }
        if (stderr && stderr.trim().length > 0) {
          outputParts.push(`--- STDERR ---\n${stderr.trim()}`);
        }
        if (outputParts.length === 0) {
          outputParts.push("(Command executed successfully with no output)");
        }

        return outputParts.join("\n\n");
      } catch (error: any) {
        const stdoutPart = error.stdout ? `\nStdout:\n${error.stdout.trim()}` : "";
        const stderrPart = error.stderr ? `\nStderr:\n${error.stderr.trim()}` : "";
        return `Command Failed (Exit code: ${error.code ?? "unknown"}): ${error.message}${stdoutPart}${stderrPart}`;
      }
    },
  },

  read_file: {
    schema: {
      type: "function",
      function: {
        name: "read_file",
        description: "Reads and returns the complete text content of a file at the specified path.",
        parameters: {
          type: "object",
          properties: {
            filepath: {
              type: "string",
              description: "Relative or absolute path to the file to read",
            },
          },
          required: ["filepath"],
        },
      },
    },
    execute: async (args: { filepath: string }) => {
      try {
        const targetPath = assertAccessible(args.filepath);
        const content = await fs.readFile(targetPath, "utf-8");
        const lines = content.split("\n").length;
        return `--- File: ${args.filepath} (${lines} lines, ${content.length} bytes) ---\n${content}`;
      } catch (error: any) {
        return `Error reading file "${args.filepath}": ${error.message}`;
      }
    },
  },

  write_file: {
    schema: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Writes content to a file at the target path, creating any required parent directories automatically.",
        parameters: {
          type: "object",
          properties: {
            filepath: {
              type: "string",
              description: "Target file path (relative or absolute)",
            },
            content: {
              type: "string",
              description: "Text content to write to the file",
            },
          },
          required: ["filepath", "content"],
        },
      },
    },
    execute: async (args: { filepath: string; content: string }) => {
      try {
        const targetPath = assertAccessible(args.filepath);
        const parentDir = path.dirname(targetPath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(targetPath, args.content, "utf-8");
        return `Successfully wrote ${args.content.length} characters to "${args.filepath}".`;
      } catch (error: any) {
        return `Error writing file "${args.filepath}": ${error.message}`;
      }
    },
  },

  list_directory: {
    schema: {
      type: "function",
      function: {
        name: "list_directory",
        description:
          "Lists directory contents recursively as a tree structure, automatically ignoring node_modules and .git folders.",
        parameters: {
          type: "object",
          properties: {
            directoryPath: {
              type: "string",
              description: "Directory path to inspect (defaults to current project root '.')",
            },
            maxDepth: {
              type: "number",
              description: "Maximum folder depth recursion (default: 3)",
            },
          },
        },
      },
    },
    execute: async (args: { directoryPath?: string; maxDepth?: number }) => {
      let targetDir: string;
      try {
        targetDir = resolveInsideProject(args.directoryPath || ".");
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
      const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : 3;

      try {
        const tree = await listDirectoryTree(targetDir, maxDepth);
        if (tree.length === 0) {
          return `Directory "${args.directoryPath || "."}" is empty.`;
        }
        return `Directory structure for "${args.directoryPath || "."}":\n${tree.join("\n")}`;
      } catch (error: any) {
        return `Error listing directory "${args.directoryPath || "."}": ${error.message}`;
      }
    },
  },

  execute_neon_sql: {
    schema: {
      type: "function",
      function: {
        name: "execute_neon_sql",
        description: "Executes raw SQL queries on Neon Serverless Postgres. Returns rows or error message.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The SQL statement to execute (e.g. 'SELECT * FROM users LIMIT 10')",
            },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args: { query: string }, scope?: ToolScope) => {
      const credential = resolveNeon(scope);
      if (!credential.ok) return credential.message;
      return await executeNeonSql(
        args.query,
        credential.source === "user" ? { connectionString: credential.value } : {}
      );
    },
  },

  execute_redis_command: {
    schema: {
      type: "function",
      function: {
        name: "execute_redis_command",
        description: "Executes Redis commands on OCI VM Redis (e.g. GET, SET, KEYS, INFO, PING).",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Redis command name (e.g. 'PING', 'GET', 'SET', 'KEYS')",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description: "Arguments for the Redis command (e.g. ['mykey', 'myvalue'])",
            },
          },
          required: ["command"],
        },
      },
    },
    execute: async (args: { command: string; args?: string[] }, scope?: ToolScope) => {
      const credential = resolveRedis(scope);
      if (!credential.ok) return credential.message;
      return await executeRedisCommand(
        args.command,
        args.args || [],
        credential.source === "user" ? { url: credential.value } : {}
      );
    },
  },

  manage_github: {
    schema: {
      type: "function",
      function: {
        name: "manage_github",
        description: "Manages GitHub issues, pull requests, code scanning alerts, and branches via gh CLI or API.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: [
                "list_repos",
                "list_issues",
                "get_issue",
                "create_issue",
                "create_pr",
                "list_prs",
                "code_scanning_alerts",
                "list_branches",
              ],
              description: "GitHub action to perform. Use 'list_repos' to see all repositories accessible with the token.",
            },
            repo: {
              type: "string",
              description: "Target repository (e.g. 'owner/repo' or just 'repo'). If only the repo name is given, it is automatically resolved using the user's authenticated GitHub account.",
            },
            issueNumber: { type: "number", description: "Issue number for get_issue" },
            prNumber: { type: "number", description: "Pull request number" },
            title: { type: "string", description: "Title for new issue or PR" },
            body: { type: "string", description: "Body / description for new issue or PR" },
            head: { type: "string", description: "Head branch for PR" },
            base: { type: "string", description: "Base branch for PR (default: main)" },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (args: any, scope?: ToolScope) => {
      const credential = resolveGitHub(scope);
      if (!credential.ok) return credential.message;
      return await manageGitHub(
        args,
        credential.source === "user" ? { token: credential.value } : {}
      );
    },
  },

  manage_cloud_run: {
    schema: {
      type: "function",
      function: {
        name: "manage_cloud_run",
        description: "Manages Google Cloud Run services and logs via gcloud CLI.",
        parameters: {
          type: "object",
          properties: {
            subcommand: {
              type: "string",
              description: "gcloud run subcommand (e.g. 'services list', 'revisions list', 'services describe my-service')",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description: "Additional arguments or flags (e.g. ['--region=us-central1'])",
            },
          },
          required: ["subcommand"],
        },
      },
    },
    execute: async (args: { subcommand: string; args?: string[] }) => {
      return await manageCloudRun(args.subcommand, args.args || []);
    },
  },

  manage_cloudflare: {
    schema: {
      type: "function",
      function: {
        name: "manage_cloudflare",
        description: "Manages Cloudflare Workers and Workers AI inference via wrangler CLI.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Wrangler command (e.g. 'deploy', 'tail', 'types')",
            },
          },
          required: ["command"],
        },
      },
    },
    execute: async (args: { command: string }) => {
      return await manageCloudflare(args.command);
    },
  },

  inspect_website: {
    schema: {
      type: "function",
      function: {
        name: "inspect_website",
        description:
          "Checks the live HTTP status, latency, response headers, and content snippet of any website or API endpoint to diagnose errors, outages, or UI health.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Full URL of the website or endpoint (e.g. 'https://mywebsite.com' or 'http://localhost:8080/health')",
            },
          },
          required: ["url"],
        },
      },
    },
    execute: async (args: { url: string }) => {
      return await inspectWebsite(args.url);
    },
  },

  manage_compute_engine: {
    schema: {
      type: "function",
      function: {
        name: "manage_compute_engine",
        description:
          "Inspects the configured Google Cloud Compute Engine VM over SSH: CPU/RAM utilization metrics, running Docker and PM2 services, or disk usage. Falls back to local-host diagnostics (clearly labelled) when GCE_* is not configured.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["metrics", "services", "disk"],
              description: "Diagnostic target: 'metrics' (CPU & RAM), 'services' (PM2 & Docker containers), or 'disk' (disk space)",
            },
          },
          required: ["action"],
        },
      },
    },
    execute: async (args: { action: "metrics" | "services" | "disk" }) => {
      return await manageComputeEngine(args.action);
    },
  },

  produce_video: {
    schema: {
      type: "function",
      function: {
        name: "produce_video",
        description:
          "Starts the autonomous long-form YouTube video pipeline: Gemini writes a SEO script (title, description, tags, chapters, scenes), then a Kaggle GPU kernel renders narration (edge-tts), visuals, Ken Burns editing, and word-accurate captions into an MP4. Returns a kernel ref immediately; observe it with manage_kaggle.",
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Video topic / angle" },
            minutes: { type: "number", description: "Target length in minutes (4-10, default 5)" },
            language: { type: "string", description: "Narration language, e.g. 'English' or 'Hindi' (default English)" },
          },
          required: ["topic"],
        },
      },
    },
    execute: async (args: { topic: string; minutes?: number; language?: string }) => {
      const mins = Math.min(Math.max(args.minutes ?? 5, 1), 10);
      try {
        return await startVideoJob(args.topic, mins, args.language || "English");
      } catch (e: any) {
        return `produce_video failed: ${e.message}`;
      }
    },
  },

  manage_kaggle: {
    schema: {
      type: "function",
      function: {
        name: "manage_kaggle",
        description:
          "Observe Kaggle kernels (model training or video renders): list your kernels, check run status, or download output files and the execution log tail.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "status", "output"], description: "list | status | output" },
            ref: { type: "string", description: "Kernel ref 'owner/slug' (required for status/output)" },
          },
          required: ["action"],
        },
      },
    },
    execute: async (args: { action: "list" | "status" | "output"; ref?: string }) => {
      return await manageKaggle(args.action, args.ref);
    },
  },

  publish_to_youtube: {
    schema: {
      type: "function",
      function: {
        name: "publish_to_youtube",
        description:
          "Uploads a rendered video job to YouTube with title, custom thumbnail, chapters, tags, SEO description, and private visibility.",
        parameters: {
          type: "object",
          properties: {
            jobIdOrPath: {
              type: "string",
              description: "Job ID (e.g. 'muthvnxq') or directory path containing video.mp4 and meta.json (e.g. 'output')",
            },
            privacy: {
              type: "string",
              enum: ["private", "unlisted", "public"],
              description: "Visibility status on YouTube (defaults to 'private')",
            },
          },
          required: ["jobIdOrPath"],
        },
      },
    },
    execute: async (args: { jobIdOrPath: string; privacy?: "private" | "unlisted" | "public" }) => {
      return await publishJobToYouTube(args.jobIdOrPath, args.privacy || "private");
    },
  },

  ask_user_confirmation: {
    schema: {
      type: "function",
      function: {
        name: "ask_user_confirmation",
        description:
          "Explicitly prompts the human user for approval before performing sensitive, destructive, or high-risk actions (e.g. DROP TABLE, rm -rf, force push, deleting cloud services).",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Brief name of the action (e.g. 'Delete Cloud Run service')",
            },
            commandOrPayload: {
              type: "string",
              description: "Exact command or query to be run",
            },
            riskReason: {
              type: "string",
              description: "Explanation of why this action is risky or irreversible",
            },
          },
          required: ["action", "commandOrPayload", "riskReason"],
        },
      },
    },
    execute: async (args: { action: string; commandOrPayload: string; riskReason: string }, scope?: ToolScope) => {
      const res = await requestHumanApproval(args.action, args.commandOrPayload, args.riskReason, {
        userId: scope?.userId,
        username: scope?.username,
      });
      return res.approved ? `APPROVED: ${res.message}` : `REJECTED: ${res.message}`;
    },
  },

  sentinel_health_check: {
    schema: {
      type: "function",
      function: {
        name: "sentinel_health_check",
        description:
          "Runs comprehensive autonomous infrastructure health checks across Neon Postgres, OCI Redis, Cloudflare Workers AI, Google Cloud Run services, Kaggle GPU pipelines, and Compute host.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    execute: async () => {
      const summary = await runComprehensiveSentinelScan();
      return formatSentinelReportMarkdown(summary);
    },
  },

  auto_heal_service: {
    schema: {
      type: "function",
      function: {
        name: "auto_heal_service",
        description:
          "Executes automated self-healing remediation on a degraded or down service (e.g. Redis, Neon, Cloudflare, Cloud Run).",
        parameters: {
          type: "object",
          properties: {
            serviceName: {
              type: "string",
              description: "Name of the service to heal (e.g. 'OCI Redis', 'Neon', 'Cloudflare')",
            },
            reason: {
              type: "string",
              description: "Reason or error reported",
            },
          },
          required: ["serviceName"],
        },
      },
    },
    execute: async (args: { serviceName: string; reason?: string }) => {
      const result = await autoHealService(args.serviceName, args.reason);
      return JSON.stringify(result, null, 2);
    },
  },

  run_cloudflare_ai: {
    schema: {
      type: "function",
      function: {
        name: "run_cloudflare_ai",
        description:
          "Executes prompt inference or generates text embeddings on Cloudflare Workers AI using models like Llama 3.1 8B or custom LoRA adapters.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The prompt or instruction to send to Cloudflare Workers AI",
            },
            model: {
              type: "string",
              description: "Optional model name (defaults to CLOUDFLARE_AI_MODEL or @cf/meta/llama-3.1-8b-instruct)",
            },
          },
          required: ["prompt"],
        },
      },
    },
    execute: async (args: { prompt: string; model?: string }, scope?: ToolScope) => {
      const credential = resolveCloudflare(scope);
      if (!credential.ok) return credential.message;
      return await runCloudflareAiInference(
        {
          prompt: args.prompt,
          ...(args.model ? { model: args.model } : {}),
        },
        credential.source === "user" ? credential.value : {}
      );
    },
  },

  dual_model_consensus: {
    schema: {
      type: "function",
      function: {
        name: "dual_model_consensus",
        description:
          "Runs a strict 2-round multi-agent peer review & debate between Model 1 (Proposer) and Model 2 (Auditor) to reach a verified, high-accuracy consensus on critical, complex, or high-risk architectural/code decisions.",
        parameters: {
          type: "object",
          properties: {
            taskGoal: {
              type: "string",
              description: "The core question, problem statement, or task requiring consensus deliberation",
            },
            context: {
              type: "string",
              description: "Optional relevant context (code snippet, error logs, requirements, or architecture)",
            },
            maxRounds: {
              type: "number",
              description: "Debate round limit (default: 2 rounds). Both models are strictly turn-aware.",
            },
          },
          required: ["taskGoal"],
        },
      },
    },
    execute: async (args: { taskGoal: string; context?: string; maxRounds?: number }) => {
      const result = await runDualModelConsensus(args.taskGoal, {
        context: args.context,
        maxRounds: args.maxRounds ?? 2,
      });
      return JSON.stringify({
        consensusReached: result.consensusReached,
        roundsCompleted: result.roundsCompleted,
        finalDecision: result.finalDecision,
        auditCritique: result.auditCritique.slice(0, 1000),
      }, null, 2);
    },
  },

  resolve_code_scanning_alerts: {
    schema: {
      type: "function",
      function: {
        name: "resolve_code_scanning_alerts",
        description:
          "Fetches open GitHub Code Scanning alerts (CodeQL, Semgrep, Trivy), inspects the flagged source code, generates automated security patches, runs typecheck, and pushes fixes to GitHub.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of alerts to fix in this run (default: 5)",
            },
          },
        },
      },
    },
    execute: async (args: { limit?: number }) => {
      const result = await runAutoAlertResolver(args.limit ?? 5);
      return JSON.stringify(result, null, 2);
    },
  },

  search_knowledge_base: {
    schema: {
      type: "function",
      function: {
        name: "search_knowledge_base",
        description:
          "Searches the platform knowledge base, documentation, architecture records, and runbooks using Neon Lakebase Hybrid Search (BM25 Full-Text + Vector ranking).",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query or keyword phrase to find in documents and architecture guides.",
            },
            category: {
              type: "string",
              description: "Optional category filter (e.g., 'database', 'cloud', 'architecture', 'security').",
            },
            limit: {
              type: "number",
              description: "Maximum number of search results to return (default: 5).",
            },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args: { query: string; category?: string; limit?: number }) => {
      try {
        const results = await searchKnowledgeHybrid(args.query, {
          category: args.category,
          limit: args.limit ?? 5,
        });
        if (results.length === 0) {
          return `No knowledge base documents matched query "${args.query}".`;
        }
        return JSON.stringify(
          results.map((r) => ({
            id: r.document.id,
            title: r.document.title,
            category: r.document.category,
            content: r.document.content.slice(0, 500),
            score: r.score,
          })),
          null,
          2
        );
      } catch (err: any) {
        return `Error searching knowledge base: ${err.message}`;
      }
    },
  },

  index_knowledge_document: {
    schema: {
      type: "function",
      function: {
        name: "index_knowledge_document",
        description:
          "Stores and indexes a new document, technical runbook, or incident post-mortem into the Neon Lakebase Hybrid Knowledge Search system.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the knowledge document.",
            },
            content: {
              type: "string",
              description: "Detailed content, documentation, or runbook instructions.",
            },
            category: {
              type: "string",
              description: "Category classification (e.g., 'architecture', 'database', 'cloud', 'incident').",
            },
            metadata: {
              type: "object",
              description: "Optional metadata object (author, tags, version, etc.).",
            },
          },
          required: ["title", "content"],
        },
      },
    },
    execute: async (args: { title: string; content: string; category?: string; metadata?: Record<string, any> }) => {
      try {
        const doc = await indexKnowledgeDocument(
          args.title,
          args.content,
          args.category || "general",
          args.metadata || {}
        );
        return `Successfully indexed document ID #${doc.id}: "${doc.title}" in category "${doc.category}".`;
      } catch (err: any) {
        return `Error indexing knowledge document: ${err.message}`;
      }
    },
  },
  execute_sandboxed_code: {
    schema: {
      type: "function",
      function: {
        name: "execute_sandboxed_code",
        description:
          "Executes arbitrary JavaScript in an isolated, memory-safe sandbox (zero host filesystem/network access). Use for math calculations, data transformations, parsing JSON, regex manipulation, or logic verification.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute. Can return a value or log using console.log.",
            },
            timeoutMs: {
              type: "number",
              description: "Optional execution timeout in milliseconds (max 10000ms, default 3000ms).",
            },
          },
          required: ["code"],
        },
      },
    },
    execute: async (args: { code: string; timeoutMs?: number }) => {
      const { executeInSandbox } = await import("./sandbox/runner.js");
      const res = await executeInSandbox(args.code, { timeoutMs: args.timeoutMs });
      if (!res.success) {
        return `Execution Failed (in ${res.executionTimeMs}ms):\nError: ${res.error}\nLogs: ${res.logs.join("\n") || "none"}`;
      }
      const output = [
        `Executed successfully in ${res.executionTimeMs}ms.`,
        res.result !== null ? `Return Value: ${JSON.stringify(res.result, null, 2)}` : "",
        res.logs.length > 0 ? `Console Output:\n${res.logs.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return output || "Code executed successfully with no output.";
    },
  },
};

/**
 * Scope enforcement, applied once across the whole registry so an individual
 * tool cannot forget it: host-tier tools refuse to run for a user scope, and
 * every tool receives the scope of the run.
 */
for (const [name, definition] of Object.entries(toolRegistry)) {
  const executeWithScope = definition.execute;
  definition.execute = async (args: any, scope?: ToolScope) => {
    const toolName = name as ToolName;
    if (!isToolAllowedForScope(toolName, scope)) {
      return hostToolRefusal(toolName);
    }
    return executeWithScope(args, scope);
  };
}

export const registeredTools: OpenAI.ChatCompletionTool[] = Object.values(toolRegistry).map(
  (t) => t.schema
);
