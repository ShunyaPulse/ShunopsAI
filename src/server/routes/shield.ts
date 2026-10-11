import type { FastifyInstance } from "fastify";
import { generateShieldChallenge } from "../middleware/bot-shield.js";

/**
 * Public Bot-Shield Challenge Endpoint (Kanban-Cloud pattern).
 * Provides a lightweight cryptographic puzzle for legitimate browsers
 * to solve before issuing anonymous heavy requests.
 */
export async function shieldRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/shield/challenge", async (_req, reply) => {
    const challenge = generateShieldChallenge();
    const turnstileSiteKey =
      process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
      process.env.TURNSTILE_SITE_KEY ||
      "";

    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return {
      ...challenge,
      turnstileSiteKey,
    };
  });
}
