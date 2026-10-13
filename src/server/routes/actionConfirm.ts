import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { verifyActionToken, executeConfirmedAction } from "../../tools/registry.js";
import { getRedisClient } from "../redis.js";

export const ActionConfirmSchema = Type.Object({
  sessionId: Type.Optional(Type.String()),
  actionId: Type.String({ minLength: 1 }),
  approved: Type.Boolean(),
  actionType: Type.String({ minLength: 1 }),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  token: Type.String({ minLength: 1 }),
  expiresAt: Type.Number(),
});

export type ActionConfirmBody = Static<typeof ActionConfirmSchema>;

// In-memory replay guard fallback (24 hours TTL) when Redis is unavailable
const consumedActionsMem = new Map<string, number>();

/**
 * Fastify counterpart for edge widget action confirmations (/api/action/confirm).
 *
 * Verifies cryptographic HMAC-SHA256 signature minted with ACTION_SECRET,
 * enforces replay prevention via distributed Redis (or in-memory sliding TTL),
 * and executes or cancels the requested sensitive action.
 */
export async function actionConfirmRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ActionConfirmBody }>(
    "/api/action/confirm",
    {
      schema: {
        body: ActionConfirmSchema,
      },
    },
    async (req, reply) => {
      const { actionId, actionType, payload, expiresAt, token, approved, sessionId } = req.body;
      const secret = process.env.ACTION_SECRET;

      if (!secret) {
        reply.status(503);
        return {
          success: false,
          message: "Action confirmation is unavailable: ACTION_SECRET is not configured on this server.",
        };
      }

      const isSignatureValid = await verifyActionToken(
        actionId,
        actionType,
        payload || {},
        expiresAt,
        token,
        secret
      );

      if (!isSignatureValid) {
        reply.status(403);
        return {
          success: false,
          actionId,
          status: "failed",
          message: "Security validation error: Action token is invalid or has expired.",
        };
      }

      // Replay prevention: verify actionId has not been previously consumed
      const redis = getRedisClient();
      const consumedKey = `action_consumed:${actionId}`;

      let replayBlocked = false;
      const now = Date.now();

      // 1. In-memory check (process-local atomic defense)
      const existingMem = consumedActionsMem.get(actionId);
      if (existingMem && existingMem > now) {
        replayBlocked = true;
      } else {
        consumedActionsMem.set(actionId, now + 86400 * 1000);
      }

      // 2. Distributed Redis check (cross-runner defense)
      if (!replayBlocked && redis) {
        try {
          const already = await redis.get(consumedKey);
          if (already) {
            replayBlocked = true;
          } else {
            await redis.set(consumedKey, "1", "EX", 86400); // 24-hour TTL
          }
        } catch {}
      }

      if (replayBlocked) {
        reply.status(409);
        return {
          success: false,
          actionId,
          status: "failed",
          message: "Security validation error: Action token has already been consumed (replay prevention).",
        };
      }

      // If user declined the action
      if (!approved) {
        return {
          success: true,
          actionId,
          status: "rejected",
          message: `Action "${actionType}" was rejected by the user.`,
        };
      }

      // Execute the authorized command
      const outcome = await executeConfirmedAction(
        actionType,
        payload || {},
        process.env as any,
        sessionId || "unknown"
      );

      return outcome;
    }
  );
}
