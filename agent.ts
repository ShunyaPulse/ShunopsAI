import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  executeNeonSql,
  executeRedisCommand,
  manageGitHub,
  manageCloudRun,
  manageCloudflare,
  inspectWebsite,
  manageComputeEngine,
} from "./src/tools/cloud.js";
import { startVideoJob, manageKaggle, publishJobToYouTube } from "./src/tools/video.js";
import { requestHumanApproval, isActionSensitive } from "./src/tools/safety.js";
import { runComprehensiveSentinelScan, formatSentinelReportMarkdown, autoHealService } from "./src/tools/sentinel.js";
import { runCloudflareAiInference } from "./src/tools/cloudflare-ai.js";
import { runDualModelConsensus } from "./src/ai/consensus.js";
import { runAutoAlertResolver } from "./src/tools/code-scanner-resolver.js";

const execAsync = promisify(exec);

// Load environment variables
dotenv.config();

// ANSI Color helper for clean, readable terminal logs
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

// ==========================================
// 1. Multi-Provider Model Configuration & Fallback Chain
// ==========================================

export interface ModelTarget {
  provider: "groq" | "gemini" | "openrouter";
  model: string;
  name: string;
}

export const AGENT_MODELS_CHAIN: ModelTarget[] = [
  // 1. Primary Choice (#1 Highest Quality)
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (Primary #1)" },

  // 2. OpenRouter High-Capability Fallback Chain
  { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (1M Context)" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" },
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "qwen/qwen3.8-27b:free", name: "Qwen 3.8 27B (OpenRouter)" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },

  // 3. Groq Fallback (Ultra-Fast Zero-Lag LPU Execution)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning Fallback)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (Fast Tool Calling)" },

  // 4. Google AI Studio Fallback (Gemini Key Pool with Active 1/5 Quota)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (AI Studio 34-Key Pool)" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.5-flash", name: "Gemini 3.5 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview (Active 1/5)" },
];

export const PRIMARY_MODEL = AGENT_MODELS_CHAIN[0]?.model ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
export const FALLBACK_MODELS = AGENT_MODELS_CHAIN.slice(1).map((t) => t.model);

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// ==========================================
// 2. Real & Safe Execution Tools
// ==========================================

export interface ToolDefinition {
  schema: OpenAI.ChatCompletionTool;
  execute: (args: any) => Promise<string>;
}

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "dist",
  "build",
  ".next",
  "coverage",
]);

// ==========================================
// Workspace Sandboxing & Secret Protection
// ==========================================

const PROJECT_ROOT = process.cwd();

/** Secret files the agent must never read, write, or list. */
function isSecretPath(filepath: string): boolean {
  const base = path.basename(filepath).toLowerCase();
  if (base === ".env.example") return false;
  if (/^\.env(\.|$)/.test(base)) return true;
  if (/\.(pem|key|p12|pfx)$/.test(base)) return true;
  if (/(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/.test(filepath.toLowerCase())) return true;
  return false;
}

/** Resolve a path and refuse anything outside the project root. */
function resolveInsideProject(p: string): string {
  const resolved = path.resolve(PROJECT_ROOT, p);
  const rel = path.relative(PROJECT_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path "${p}" escapes the project root and is blocked.`);
  }
  return resolved;
}

function assertAccessible(filepath: string): string {
  if (isSecretPath(filepath)) {
    throw new Error(`Access to secret file "${path.basename(filepath)}" is blocked.`);
  }
  return resolveInsideProject(filepath);
}

/** Reconstruct the effective command string a tool will run, for the safety gate. */
function sensitivityPayload(toolName: string, args: Record<string, any>): string {
  const arr = Array.isArray(args.args) ? args.args.join(" ") : "";
  switch (toolName) {
    case "run_shell_command":
      return String(args.command ?? "");
    case "execute_neon_sql":
      return String(args.query ?? "");
    case "execute_redis_command":
      return `${args.command ?? ""} ${arr}`.trim();
    case "manage_cloud_run":
      return `gcloud run ${args.subcommand ?? ""} ${arr}`.trim();
    case "manage_cloudflare":
      return `wrangler ${args.command ?? ""}`.trim();
    default:
      return JSON.stringify(args);
  }
}

/**
 * Recursively list files and directories with exclusion rules
 */
async function listDirectoryTree(
  dirPath: string,
  maxDepth = 3,
  currentDepth = 0,
  ignoreList = DEFAULT_IGNORED_DIRS
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];

  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreList.has(entry.name)) continue;
      if (isSecretPath(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath) || entry.name;

      if (entry.isDirectory()) {
        results.push(`📁 ${relativePath}/`);
        const subEntries = await listDirectoryTree(
          fullPath,
          maxDepth,
          currentDepth + 1,
          ignoreList
        );
        results.push(...subEntries);
      } else {
        results.push(`📄 ${relativePath}`);
      }
    }
  } catch (err: any) {
    results.push(`[Error reading ${dirPath}: ${err.message}]`);
  }
  return results;
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
  | "resolve_code_scanning_alerts";

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
      let workingDir = PROJECT_ROOT;
      try {
        workingDir = args.cwd ? resolveInsideProject(args.cwd) : PROJECT_ROOT;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
      const timeout = args.timeoutMs || 30000;

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
    execute: async (args: { query: string }) => {
      return await executeNeonSql(args.query);
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
    execute: async (args: { command: string; args?: string[] }) => {
      return await executeRedisCommand(args.command, args.args || []);
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
                "list_issues",
                "get_issue",
                "create_issue",
                "create_pr",
                "list_prs",
                "code_scanning_alerts",
                "list_branches",
              ],
              description: "GitHub action to perform",
            },
            repo: {
              type: "string",
              description: "Target repository (owner/repo). Optional if inside git repo",
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
    execute: async (args: any) => {
      return await manageGitHub(args);
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
              description: "Full URL of the website or endpoint (e.g. 'https://mywebsite.com' or 'http://127.0.0.1:8080/health')",
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
    execute: async (args: { action: string; commandOrPayload: string; riskReason: string }) => {
      const res = await requestHumanApproval(args.action, args.commandOrPayload, args.riskReason);
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
    execute: async (args: { prompt: string; model?: string }) => {
      return await runCloudflareAiInference({
        prompt: args.prompt,
        ...(args.model ? { model: args.model } : {}),
      });
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
};

const registeredTools: OpenAI.ChatCompletionTool[] = Object.values(toolRegistry).map(
  (t) => t.schema
);

// ==========================================
// 3. Client & Completion Helper with Failover
// ==========================================

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  initialContext?: string;
  models?: string[];
  targets?: ModelTarget[];
  /** Tools that must never be exposed or executed for this run (least-privilege). */
  disabledTools?: ToolName[];
}

function getGeminiKey(): string {
  const raw = process.env.GEMINI_API_KEY || "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return "dummy-gemini-key";
  return keys[randomInt(0, keys.length)] || "dummy-gemini-key";
}

function createClientForTarget(target: ModelTarget): OpenAI {
  if (target.provider === "groq") {
    return new OpenAI({
      baseURL: GROQ_BASE_URL,
      apiKey: process.env.GROQ_API_KEY || "dummy-groq-key",
    });
  }
  if (target.provider === "gemini") {
    return new OpenAI({
      baseURL: GEMINI_OPENAI_BASE_URL,
      apiKey: getGeminiKey(),
    });
  }
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY || "dummy-openrouter-key",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/nemotron-agent",
      "X-Title": "Nemotron-Autonomous-Agent",
    },
  });
}

/**
 * Call completion API with multi-provider automatic failover across models and providers (Groq -> Gemini -> OpenRouter)
 */
async function callChatCompletionWithFailover(
  messages: OpenAI.ChatCompletionMessageParam[],
  targets: ModelTarget[],
  tools: OpenAI.ChatCompletionTool[],
  temperature = 0.2
): Promise<{ response: OpenAI.ChatCompletion; usedModel: string }> {
  let lastError: any = null;

  for (const target of targets) {
    // If Gemini target, attempt with up to 4 different keys from pool before giving up on that model
    const attempts = target.provider === "gemini" ? 4 : 1;

    for (let att = 0; att < attempts; att++) {
      try {
        const client = createClientForTarget(target);
        console.log(
          `${colors.gray}[Requesting Model]${colors.reset} [${target.provider.toUpperCase()}] ${target.model}`
        );

        const response = await client.chat.completions.create({
          model: target.model,
          messages,
          tools,
          tool_choice: "auto",
          temperature,
        });

        if (response.choices && response.choices.length > 0 && response.choices[0]) {
          return { response, usedModel: `${target.provider.toUpperCase()}:${target.model}` };
        }
        throw new Error(`Model ${target.model} returned empty choices array.`);
      } catch (err: any) {
        lastError = err;
        const statusCode = err?.status || err?.statusCode || "Unknown";
        console.warn(
          `${colors.yellow}[Failover Notice]${colors.reset} [${target.provider}] ${target.model} attempt ${att + 1}/${attempts} failed (${statusCode}: ${err.message}). Trying fallback...`
        );
        if (err?.status === 404) break; // Model does not exist, move to next model
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  throw new Error(
    `All configured multi-provider models failed in failover chain. Last error: ${lastError?.message || lastError}`
  );
}

// ==========================================
// 4. Autonomous Agent Runner Loop
// ==========================================

export async function runAutonomousAgent(
  userGoal: string,
  options: AgentOptions = {}
): Promise<{ success: boolean; finalAnswer?: string; stepsTaken: number; history: OpenAI.ChatCompletionMessageParam[] }> {
  const maxSteps = options.maxSteps ?? 15;
  const temperature = options.temperature ?? 0.2;

  // Resolve model targets
  let targets: ModelTarget[] = AGENT_MODELS_CHAIN;
  if (options.targets && options.targets.length > 0) {
    targets = options.targets;
  } else if (options.models && options.models.length > 0) {
    targets = options.models.map((m) => {
      const match = AGENT_MODELS_CHAIN.find((t) => t.model === m);
      if (match) return match;
      if (m.startsWith("gemini")) return { provider: "gemini", model: m, name: m };
      if (m.includes("gpt-oss") || (m.includes("qwen") && !m.endsWith(":free"))) {
        return { provider: "groq", model: m, name: m };
      }
      return { provider: "openrouter", model: m, name: m };
    });
  }

  // Least-privilege: restrict the toolset exposed to the model for this run.
  const disabled = new Set<ToolName>(options.disabledTools ?? []);
  const activeTools = registeredTools.filter(
    (t) => t.type === "function" && !disabled.has(t.function.name as ToolName)
  );
  const allowedNames = new Set(
    activeTools.map((t) => (t.type === "function" ? t.function.name : ""))
  );

  // System Prompt leveraging Nemotron/Qwen's large context & ReAct methodology
  const systemPrompt = `You are ShunopsAI — an autonomous multi-agent engineering & cloud orchestrator.
You operate as the master brain managing an ecosystem of specialized capabilities:
1. DevOps Sentinel & Self-Healing: sentinel_health_check, auto_heal_service (Neon Postgres, OCI Redis, Cloudflare Workers AI, Google Cloud Run, Kaggle GPU, Host metrics)
2. Cloudflare & Workers AI: run_cloudflare_ai, manage_cloudflare (Llama 3.1, LoRA adapters, embeddings)
3. Serverless Databases & In-Memory: execute_neon_sql (queries on Neon Postgres), execute_redis_command (commands on OCI VM Redis)
4. Cloud Compute & GitOps: manage_cloud_run (Google Cloud Run), manage_compute_engine (GCE/Host), manage_github (issues, pull requests, branches)
5. Content & Media Pipeline: produce_video (Gemini script + Kaggle GPU rendering of 4-10 min videos), manage_kaggle (kernel status, outputs), publish_to_youtube
6. Host & Filesystem: run_shell_command, read_file, write_file, list_directory, inspect_website
7. Multi-Agent Peer Review & Consensus: dual_model_consensus (collaborative 2-round debate between Proposer and Auditor models for high-risk decisions)
8. Safety Guardrail: ask_user_confirmation (ask human approval for sensitive/destructive operations)

# Operating Guidelines for Out-Of-The-Box Tasks:
1. When asked to perform ANY task (no matter how novel, complex, or out of the box):
   - Deconstruct the goal into an action plan.
   - Choose the most direct, high-leverage tools.
   - Execute each step methodically.
   - If an error or barrier arises, diagnose the cause immediately, adjust strategy, and self-heal.
2. For sensitive or irreversible operations (DROP TABLE, DELETE FROM without WHERE, rm -rf, git push --force, gcloud service deletion), you MUST call ask_user_confirmation first.
3. Keep all systems healthy, error-free, and performant. Proactively inspect and heal failing services.
4. Execute efficiently: achieve the goal in 1-4 targeted tool calls and deliver a clear, structured final answer.`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  if (options.initialContext) {
    messages.push({
      role: "system",
      content: `Initial Workspace Context:\n${options.initialContext}`,
    });
  }

  messages.push({ role: "user", content: userGoal });

  console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
  console.log(`${colors.green}${colors.bold}🎯 Autonomous Agent Initiated${colors.reset}`);
  console.log(`${colors.green}Goal:${colors.reset} ${userGoal}`);
  console.log(`${colors.green}Max Steps:${colors.reset} ${maxSteps}`);
  console.log(`${colors.green}Primary Model:${colors.reset} [${targets[0]?.provider.toUpperCase() ?? "UNKNOWN"}] ${targets[0]?.model ?? "unknown"}`);
  console.log(`${colors.green}${colors.bold}========================================${colors.reset}\n`);

  let stepsTaken = 0;

  for (let step = 1; step <= maxSteps; step++) {
    stepsTaken = step;
    console.log(
      `\n${colors.cyan}${colors.bold}--- [Step ${step}/${maxSteps}] ---${colors.reset}`
    );

    try {
      const { response, usedModel } = await callChatCompletionWithFailover(
        messages,
        targets,
        activeTools,
        temperature
      );

      const choice = response.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error("Received an invalid response choice from OpenRouter API.");
      }

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      // Log reasoning / thoughts if returned
      if (assistantMessage.content) {
        console.log(`\n${colors.magenta}${colors.bold}[Agent Reasoning (${usedModel})]${colors.reset}`);
        console.log(`${assistantMessage.content}`);
      }

      const toolCalls = assistantMessage.tool_calls;

      // Final Answer Check: If no tool calls, the agent concluded its task
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
        console.log(`${colors.green}${colors.bold}✅ Task Finished Successfully${colors.reset}`);
        console.log(`${colors.green}${colors.bold}========================================${colors.reset}`);
        console.log(`\n${choice.message.content || "(No text response provided)"}\n`);

        return {
          success: true,
          finalAnswer: choice.message.content || "",
          stepsTaken,
          history: messages,
        };
      }

      // Execute tool calls sequentially or in parallel
      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;

        const toolName = toolCall.function.name;
        let parsedArgs: Record<string, any> = {};

        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
        } catch (parseErr: any) {
          console.error(
            `${colors.red}[Tool Parse Error]${colors.reset} Invalid JSON in arguments for ${toolName}: ${toolCall.function.arguments}`
          );
          parsedArgs = { raw: toolCall.function.arguments };
        }

        console.log(
          `\n${colors.yellow}${colors.bold}[Tool Dispatch]${colors.reset} ${colors.bold}${toolName}${colors.reset}(${JSON.stringify(
            parsedArgs,
            null,
            2
          )})`
        );

        let executionResult: string;
        const toolHandler = (toolRegistry as Record<string, ToolDefinition | undefined>)[toolName];

        if (!allowedNames.has(toolName)) {
          executionResult = `Error: Tool "${toolName}" is not permitted for this task. Allowed tools: ${[...allowedNames].join(", ")}`;
        } else if (!toolHandler) {
          executionResult = `Error: Unknown tool "${toolName}". Available tools: ${Object.keys(
            toolRegistry
          ).join(", ")}`;
        } else {
          // Centralized safety gate: EVERY tool (including shell/git) is checked here,
          // so individual wrappers can no longer bypass the human-in-the-loop guard.
          const payload = sensitivityPayload(toolName, parsedArgs);
          const sensitivity = isActionSensitive(payload);
          if (sensitivity.isSensitive) {
            const approval = await requestHumanApproval(`Tool: ${toolName}`, payload, sensitivity.reason);
            executionResult = approval.approved
              ? await toolHandler.execute(parsedArgs).catch((e: any) => `Error executing tool ${toolName}: ${e.message}`)
              : `Aborted by safety gate: ${approval.message}`;
          } else {
            executionResult = await toolHandler.execute(parsedArgs).catch((e: any) => `Error executing tool ${toolName}: ${e.message}`);
          }
        }

        // Print truncated preview of tool result in console for clean readability
        const resultPreview =
          executionResult.length > 500
            ? executionResult.slice(0, 500) + `\n... [${executionResult.length - 500} more chars]`
            : executionResult;

        console.log(`${colors.blue}[Tool Result]${colors.reset}\n${resultPreview}`);

        // Append tool result message for the next iteration
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: executionResult,
        });
      }
    } catch (loopError: any) {
      console.error(
        `\n${colors.red}${colors.bold}[Step Error]${colors.reset} ${loopError.message}`
      );
      return {
        success: false,
        finalAnswer: `Error during execution: ${loopError.message}`,
        stepsTaken,
        history: messages,
      };
    }
  }

  console.warn(
    `\n${colors.yellow}${colors.bold}[Max Steps Reached]${colors.reset} Agent completed maximum allowed iterations (${maxSteps}).`
  );

  return {
    success: false,
    finalAnswer: "Max steps reached without explicit task completion.",
    stepsTaken,
    history: messages,
  };
}

// ==========================================
// 5. CLI Self-Execution Handler
// ==========================================

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const goal =
    process.argv.slice(2).join(" ") ||
    "Inspect the repository structure, read package.json, create a sample file at './src/agent.json' with agent metadata, and verify that the file exists.";

  runAutonomousAgent(goal, { maxSteps: 15 }).then((result) => {
    if (!result.success && !process.env.OPENROUTER_API_KEY) {
      console.log(
        `\n${colors.gray}Tip: Set OPENROUTER_API_KEY in .env to execute live reasoning on OpenRouter.${colors.reset}`
      );
    }
  });
}
