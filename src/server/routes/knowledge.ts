import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  searchKnowledgeHybrid,
  indexKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeStats,
} from "../db.js";
import { isAdminUser } from "../scope.js";

export interface KnowledgeRouteOptions {
  requireAuth: preHandlerHookHandler;
}

export async function knowledgeRoutes(
  app: FastifyInstance,
  options: KnowledgeRouteOptions
): Promise<void> {
  const { requireAuth } = options;

  // 0. Inspect Hybrid Knowledge Engine & Embedding Cache Stats
  app.get("/api/knowledge/stats", { preHandler: [requireAuth] }, async () => {
    return {
      success: true,
      stats: getKnowledgeStats(),
    };
  });

  // 1. Search knowledge base via Neon Lakebase Hybrid Search (Public / Authenticated)
  app.get<{
    Querystring: { q?: string; category?: string; limit?: string };
  }>("/api/knowledge/search", async (req, reply) => {
    const query = req.query.q?.trim();
    if (!query) {
      reply.status(400);
      return { success: false, error: "Search query 'q' parameter is required." };
    }

    const category = req.query.category?.trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);

    const results = await searchKnowledgeHybrid(query, {
      category: category || undefined,
      limit,
    });

    return {
      success: true,
      query,
      category: category || null,
      results,
      engine: getKnowledgeStats().activeTier,
    };
  });

  // 2. Index a new knowledge document (Admin/Operator only — matches host-tier tool policy)
  app.post<{
    Body: {
      title: string;
      content: string;
      category?: string;
      metadata?: Record<string, any>;
    };
  }>("/api/knowledge/index", { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return { success: false, error: "Access denied. Administrator privileges required to modify the global knowledge base." };
    }

    const { title, content, category, metadata } = req.body || {};
    if (!title || !content) {
      reply.status(400);
      return { success: false, error: "Both 'title' and 'content' are required." };
    }

    const doc = await indexKnowledgeDocument(
      title,
      content,
      category || "general",
      metadata || {}
    );

    return {
      success: true,
      document: doc,
    };
  });

  // 3. Delete a knowledge document (Admin/Operator only)
  app.delete<{
    Params: { id: string };
  }>("/api/knowledge/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return { success: false, error: "Access denied. Administrator privileges required to delete knowledge documents." };
    }

    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      reply.status(400);
      return { success: false, error: "Valid document ID required." };
    }

    const deleted = await deleteKnowledgeDocument(id);
    return {
      success: deleted,
    };
  });
}
