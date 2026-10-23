import { requestHumanApproval } from "../../tools/safety.js";
import {
  runComprehensiveSentinelScan,
  formatSentinelReportMarkdown,
  autoHealService,
} from "../../tools/sentinel.js";
import { runCloudflareAiInference } from "../../tools/cloudflare-ai.js";
import { runDualModelConsensus } from "../../ai/consensus.js";
import { runAutoAlertResolver } from "../../tools/code-scanner-resolver.js";
import { extractTargetRepo } from "../../core/repos.js";
import { resolveCloudflare, type ToolScope } from "../scope.js";
import type { ToolGroup } from "./types.js";

/** Human-approval gate, health remediation, consensus and security operations. */
export const opsTools: ToolGroup<
  | "ask_user_confirmation"
  | "sentinel_health_check"
  | "auto_heal_service"
  | "run_cloudflare_ai"
  | "dual_model_consensus"
  | "resolve_code_scanning_alerts"
> = {
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
    execute: async (args: { taskGoal: string; context?: string; maxRounds?: number }, scope?: ToolScope) => {
      const keyOverrides =
        scope?.keyOverrides ||
        (scope?.credentials?.github?.token || scope?.credentials?.cloudflare
          ? {
              githubToken: scope.credentials.github?.token,
              cloudflareAccountId: scope.credentials.cloudflare?.accountId,
              cloudflareApiToken: scope.credentials.cloudflare?.apiToken,
            }
          : undefined);
      const result = await runDualModelConsensus(args.taskGoal, {
        context: args.context,
        maxRounds: args.maxRounds ?? 2,
        keyOverrides,
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
            repo: {
              type: "string",
              description:
                "Target GitHub repository slug or name (e.g. 'ShunyaPulse/ShunopsAI', 'ShunyaPulse/SaralGati', or 'kanban-cloud'). Defaults to local repo.",
            },
          },
        },
      },
    },
    execute: async (args: { limit?: number; repo?: string }) => {
      const targetRepo = extractTargetRepo(args.repo);
      const result = await runAutoAlertResolver(args.limit ?? 5, targetRepo);
      return JSON.stringify(result, null, 2);
    },
  },
};
