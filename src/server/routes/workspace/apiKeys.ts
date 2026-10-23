import type { FastifyInstance } from "fastify";
import { createApiKey, listUserApiKeys, deleteApiKey } from "../../db.js";
import type { WorkspaceRouteDeps } from "./shared.js";

const API_KEY_NAME_MAX = 64;

/** Personal API keys: list, create (shown once), revoke. */
export function registerApiKeyRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { requireAuth } = deps;

  // 4. List Personal API Keys
  app.get("/api/user/api-keys", { preHandler: [requireAuth] }, async (req) => {
    const userId = (req as any).user?.id || 0;
    const keys = await listUserApiKeys(userId);
    return { success: true, keys };
  });

  // 5. Create Personal API Key
  app.post<{ Body: { name?: string } }>(
    "/api/user/api-keys",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        reply.status(401);
        return { error: "Authentication required to generate an API key." };
      }

      const name = (req.body?.name || "Personal API Key").trim().slice(0, API_KEY_NAME_MAX);
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

  // 7. Revoke Personal API Key
  app.delete<{ Params: { id: string } }>(
    "/api/user/api-keys/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user?.id;
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
