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

// Bounded in-memory replay guard fallback (24 hours TTL) when Redis is unavailable
const consumedActionsMem = new Map<string, number>();
const MAX_CONSUMED_ACTIONS_MEM = 10_000;

function pruneConsumedActionsMem(now: number): void {
  if (consumedActionsMem.size < MAX_CONSUMED_ACTIONS_MEM) return;
  for (const [key, exp] of consumedActionsMem) {
    if (exp <= now) consumedActionsMem.delete(key);
  }
  while (consumedActionsMem.size >= MAX_CONSUMED_ACTIONS_MEM) {
    const oldest = consumedActionsMem.keys().next().value;
    if (oldest === undefined) break;
    consumedActionsMem.delete(oldest);
  }
}

/**
 * Fastify counterpart for edge widget action confirmations (/api/action/confirm).
 *
 * Verifies cryptographic HMAC-SHA256 signature minted with ACTION_SECRET,
 * enforces atomic replay prevention via distributed Redis (`SET ... NX`) or
 * bounded in-memory sliding TTL, and executes or cancels the requested sensitive action.
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

      // Replay prevention: atomically verify and mark actionId as consumed
      const redis = getRedisClient();
      const consumedKey = `action_consumed:${actionId}`;

      let replayBlocked = false;
      const now = Date.now();

      // 1. In-memory check (process-local atomic defense with bounded size)
      const existingMem = consumedActionsMem.get(actionId);
      if (existingMem && existingMem > now) {
        replayBlocked = true;
      } else {
        pruneConsumedActionsMem(now);
        consumedActionsMem.set(actionId, now + 86400 * 1000);
      }

      // 2. Distributed Redis atomic SET NX check (eliminates cross-instance TOCTOU race)
      if (!replayBlocked && redis) {
        try {
          const acquired = await redis.set(consumedKey, "1", "EX", 86400, "NX");
          if (acquired !== "OK") {
            replayBlocked = true;
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
