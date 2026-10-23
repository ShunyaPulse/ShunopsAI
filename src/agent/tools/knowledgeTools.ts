import { searchKnowledgeHybrid, indexKnowledgeDocument } from "../../server/db.js";
import { persistSandboxWrittenFiles, resolveTenantKey } from "../../tools/agentic.js";
import type { ToolScope } from "../scope.js";
import type { ToolGroup } from "./types.js";

/** Retrieval over the platform knowledge base plus the isolated code sandbox. */
export const knowledgeTools: ToolGroup<
  "search_knowledge_base" | "index_knowledge_document" | "execute_sandboxed_code"
> = {
  search_knowledge_base: {
    schema: {
      type: "function",
      function: {
        name: "search_knowledge_base",
        description:
          "Searches the platform knowledge base, documentation, architecture records, and runbooks using Neon Lakebase Hybrid Search (BM25 Full-Text + 768-dim Vector RRF ranking).",
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
            matchType: r.matchType,
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
    execute: async (args: { code: string; timeoutMs?: number }, scope?: ToolScope) => {
      const { executeInSandbox } = await import("../sandbox/runner.js");
      const { getTenantFilesMap } = await import("../../tools/agentic.js");
      const tenantKey = resolveTenantKey(scope?.userId, scope?.kind);
      const workspaceFiles = getTenantFilesMap(tenantKey);
      const res = await executeInSandbox(args.code, {
        timeoutMs: args.timeoutMs,
        workspaceFiles,
      });
      if (!res.success) {
        return `Execution Failed (in ${res.executionTimeMs}ms):\nError: ${res.error}\nLogs: ${res.logs.join("\n") || "none"}`;
      }
      const savedFiles = await persistSandboxWrittenFiles(res.writtenFiles, tenantKey);
      const output = [
        `Executed successfully in ${res.executionTimeMs}ms (${res.engine || "sandbox"}).`,
        savedFiles.length > 0 ? `Saved Workspace Files: ${savedFiles.join(", ")}` : "",
        res.result !== null ? `Return Value: ${JSON.stringify(res.result, null, 2)}` : "",
        res.logs.length > 0 ? `Console Output:\n${res.logs.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return output || "Code executed successfully with no output.";
    },
  },
};
