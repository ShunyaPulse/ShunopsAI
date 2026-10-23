import type { FastifyInstance } from "fastify";
import {
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  listConversations,
  createConversation,
  deleteConversation,
} from "../../db.js";
import type { WorkspaceRouteDeps } from "./shared.js";

/** Chat conversation persistence: list, upsert, delete, and message history. */
export function registerConversationRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { requireAuth } = deps;

  // 1a. List Conversations for Authenticated User
  app.get("/api/workspace/conversations", { preHandler: [requireAuth] }, async (req) => {
    const userId = (req as any).user?.id || 0;
    const conversations = await listConversations(userId);
    return { success: true, conversations };
  });

  // 1b. Create or Upsert Conversation
  app.post<{ Body: { id: string; title?: string } }>(
    "/api/workspace/conversations",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id || 0;
      const { id, title } = req.body || {};
      if (!id) {
        reply.status(400);
        return { error: "Conversation ID required." };
      }
      const conversation = await createConversation(userId, id, title || "New Conversation");
      return { success: true, conversation };
    }
  );

  // 1c. Delete Specific Conversation
  app.delete<{ Params: { id: string } }>(
    "/api/workspace/conversations/:id",
    { preHandler: [requireAuth] },
    async (req) => {
      const userId = (req as any).user?.id || 0;
      await deleteConversation(userId, req.params.id);
      return { success: true, message: "Conversation deleted." };
    }
  );

  // 1d. Get Chat History for Authenticated User (by conversationId)
  app.get<{ Querystring: { conversationId?: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req) => {
      const userId = (req as any).user?.id || 0;
      const { conversationId } = req.query || {};
      const messages = await getChatHistory(userId, 100, conversationId);
      return { success: true, messages, conversationId: conversationId || "default" };
    }
  );

  // 2. Save Chat Message
  app.post<{ Body: { role: "user" | "assistant"; message: string; conversationId?: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id || 0;
      const { role, message, conversationId } = req.body || {};

      if (!message || (role !== "user" && role !== "assistant")) {
        reply.status(400);
        return { error: "Valid role ('user' or 'assistant') and message required." };
      }

      await saveChatMessage(userId, role, message, conversationId || "default");
      return { success: true };
    }
  );

  // 3. Clear Chat History
  app.delete<{ Querystring: { conversationId?: string } }>(
    "/api/workspace/chat-history",
    { preHandler: [requireAuth] },
    async (req) => {
      const userId = (req as any).user?.id || 0;
      const { conversationId } = req.query || {};
      if (conversationId && conversationId !== "all") {
        await deleteConversation(userId, conversationId);
        return { success: true, message: `Conversation ${conversationId} cleared.` };
      }
      await clearChatHistory(userId);
      return { success: true, message: "Chat history cleared." };
    }
  );
}
