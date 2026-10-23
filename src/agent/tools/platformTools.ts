import {
  executeNeonSql,
  executeRedisCommand,
  manageGitHub,
  manageCloudRun,
  manageCloudflare,
  inspectWebsite,
  manageComputeEngine,
  executeWebSearch,
  inspectGcpCloud,
} from "../../tools/cloud.js";
import {
  resolveNeon,
  resolveRedis,
  resolveGitHub,
  resolveWebSearch,
  resolveGcp,
  type ToolScope,
} from "../scope.js";
import type { ToolGroup } from "./types.js";

/**
 * Platform tools. Each one resolves the caller's own credential first and only
 * falls back to server credentials when the scope allows it, so a user run can
 * never silently act on the operator's accounts.
 */
export const platformTools: ToolGroup<
  | "execute_neon_sql"
  | "execute_redis_command"
  | "manage_github"
  | "manage_cloud_run"
  | "manage_cloudflare"
  | "inspect_website"
  | "manage_compute_engine"
  | "web_search"
  | "inspect_gcp_cloud"
> = {
  execute_neon_sql: {
    schema: {
      type: "function",
      function: {
        name: "execute_neon_sql",
        description: "Executes raw SQL queries on Neon Serverless Postgres or Supabase Postgres. Returns rows or error message.",
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
        description: "Executes Redis commands on OCI VM Redis or Upstash Serverless Redis (e.g. GET, SET, KEYS, INFO, PING).",
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
        credential.source === "user" ? credential.value : {}
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
          "Deep website inspection tool that fetches any public URL or API and returns title, meta description, headings, latency, and readable text content. Supports optional focusQuery to extract matching paragraphs from large pages.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Full URL of the website or endpoint (e.g. 'https://mywebsite.com' or 'http://localhost:8080/health')",
            },
            focusQuery: {
              type: "string",
              description: "Optional topic, keyword, or section to extract from large pages (e.g. 'pricing', 'installation', 'docker compose').",
            },
          },
          required: ["url"],
        },
      },
    },
    execute: async (args: { url: string; focusQuery?: string }) => {
      return await inspectWebsite(args.url, args.focusQuery);
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

  web_search: {
    schema: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Performs live internet web search and documentation lookup using the user's connected Tavily AI Search or Brave Web Search API key.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to look up on the live web.",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return (1-10, default: 5).",
            },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args: { query: string; maxResults?: number }, scope?: ToolScope) => {
      const credential = resolveWebSearch(scope);
      return await executeWebSearch(args.query, {
        ...(credential.ok && credential.source === "user" ? credential.value : {}),
        maxResults: args.maxResults,
      });
    },
  },

  inspect_gcp_cloud: {
    schema: {
      type: "function",
      function: {
        name: "inspect_gcp_cloud",
        description:
          "Inspects Google Cloud Platform (GCP) resources — list Cloud Run services, run BigQuery SQL queries, or fetch Cloud Logging entries — using the user's connected GCP credential.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["list_cloud_run_services", "query_bigquery", "list_logs"],
              description: "GCP operation to execute.",
            },
            region: {
              type: "string",
              description: "Optional GCP region for Cloud Run (defaults to '-' for all regions).",
            },
            sqlQuery: {
              type: "string",
              description: "BigQuery Standard SQL query (required when operation is 'query_bigquery').",
            },
            logFilter: {
              type: "string",
              description: "Optional Cloud Logging filter expression (default: 'severity>=ERROR').",
            },
          },
          required: ["operation"],
        },
      },
    },
    execute: async (
      args: {
        operation: "list_cloud_run_services" | "query_bigquery" | "list_logs";
        region?: string;
        sqlQuery?: string;
        logFilter?: string;
      },
      scope?: ToolScope
    ) => {
      const credential = resolveGcp(scope);
      if (!credential.ok) return credential.message;
      return await inspectGcpCloud(
        args,
        credential.source === "user" ? credential.value : {}
      );
    },
  },
};
