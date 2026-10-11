import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  createApiKey,
  listUserApiKeys,
  deleteApiKey,
} from "../db.js";

export interface WorkspaceRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * User Workspace Routes: Chat Conversation Persistence & Personal API Keys.
 */
export async function workspaceRoutes(app: FastifyInstance, options: WorkspaceRouteOptions): Promise<void> {
  const { requireAuth } = options;

  // 1. Get Chat History for Authenticated User
  app.get("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const messages = await getChatHistory(userId, 100);
    return { success: true, messages };
  });

  // 2. Save Chat Message
  app.post<{ Body: { role: "user" | "assistant"; message: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id || 0;
      const { role, message } = req.body || {};

      if (!message || (role !== "user" && role !== "assistant")) {
        reply.status(400);
        return { error: "Valid role ('user' or 'assistant') and message required." };
      }

      await saveChatMessage(userId, role, message);
      return { success: true };
    }
  );

  // 3. Clear Chat History
  app.delete("/api/workspace/chat-history", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    await clearChatHistory(userId);
    return { success: true, message: "Chat history cleared." };
  });

  // 4. List Personal API Keys
  app.get("/api/user/api-keys", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const keys = await listUserApiKeys(userId);
    return { success: true, keys };
  });

  // 5. Create Personal API Key
  app.post<{ Body: { name?: string } }>(
    "/api/user/api-keys",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to generate an API key." };
      }

      const name = (req.body?.name || "Personal API Key").trim().slice(0, 64);
      const newKey = await createApiKey(userId, name);
      return {
        success: true,
        id: newKey.id,
        key: newKey.rawKey,
        keyPrefix: newKey.keyPrefix,
        message: "API key generated. Please save this secret key now, as it cannot be displayed again.",
      };
    }
  );

  // 6. Revoke Personal API Key
  app.delete<{ Params: { id: string } }>(
    "/api/user/api-keys/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const userId = user?.id;
      const keyId = Number(req.params.id);

      if (!userId || !keyId) {
        reply.status(400);
        return { error: "Valid key ID required." };
      }

      const deleted = await deleteApiKey(userId, keyId);
      if (!deleted) {
        reply.status(404);
        return { error: "Key not found." };
      }

      return { success: true, message: "API key revoked." };
    }
  );
}
