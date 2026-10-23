import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { registerConversationRoutes } from "./workspace/conversations.js";
import { registerAgenticStateRoutes } from "./workspace/agenticState.js";
import { registerExecuteCodeRoute } from "./workspace/executeCode.js";
import { registerApiKeyRoutes } from "./workspace/apiKeys.js";
import { registerPlatformCredentialRoutes } from "./workspace/platformCredentials.js";
import { registerBuiltInMcpRoute } from "./workspace/mcpServer.js";

export interface WorkspaceRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * User Workspace Routes: Chat Conversation Persistence, Agentic Workspace Hub
 * (Tasks, Files, Long-Term Memory), & Personal API Keys.
 *
 * Endpoints are grouped in `./workspace/`:
 * - `conversations`      — conversations and chat history
 * - `agenticState`       — hub snapshot/sync, tasks, files, memories, schedules, swarms
 * - `executeCode`        — sandbox runner with guest gate and AI code generation
 * - `apiKeys`            — personal API keys
 * - `platformCredentials`— platform connections and MCP connection test
 * - `mcpServer`          — built-in sovereign MCP JSON-RPC server
 * - `mcpPolicy`          — shared MCP URL policy helpers
 */
export async function workspaceRoutes(app: FastifyInstance, options: WorkspaceRouteOptions): Promise<void> {
  const deps = { requireAuth: options.requireAuth };

  registerConversationRoutes(app, deps);
  registerAgenticStateRoutes(app, deps);
  registerExecuteCodeRoute(app, deps);
  registerApiKeyRoutes(app, deps);
  registerPlatformCredentialRoutes(app, deps);
  registerBuiltInMcpRoute(app, deps);
}
