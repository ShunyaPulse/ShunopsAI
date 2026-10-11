import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { getUserUsageAndPlan, PLAN_LIMITS, findUserBySessionToken } from "../db.js";

export interface BillingRouteOptions {
  requireAuth: preHandlerHookHandler;
}

/**
 * Billing, Plans & Metering Usage Routes.
 */
export async function billingRoutes(app: FastifyInstance, options: BillingRouteOptions): Promise<void> {
  const { requireAuth } = options;

  // 1. Get current user usage & active plan
  app.get("/api/billing/usage", { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    const userId = user?.id || 0;
    const usage = await getUserUsageAndPlan(userId);
    return {
      success: true,
      plan: usage.plan,
      queryCount: usage.queryCount,
      limit: usage.limit,
      remaining: Math.max(0, usage.limit - usage.queryCount),
    };
  });

  // 2. Get available plan specifications
  app.get("/api/billing/plans", async () => {
    return {
      success: true,
      plans: [
        {
          id: "community",
          name: "Community Free",
          price: "$0 / month",
          queryLimit: PLAN_LIMITS.community,
          features: [
            "100 AI Queries / Month",
            "Single-step ReAct fast answers",
            "Neon Postgres multi-tenancy",
            "Standard community support",
          ],
        },
        {
          id: "byok",
          name: "BYOK Unlimited",
          price: "Free (Bring Your Own Key)",
          queryLimit: "Unlimited",
          features: [
            "Unlimited AI Queries",
            "3 steps autonomous multi-turn reasoning",
            "Direct zero-cost Groq & Gemini LPU inference",
            "Personal API Keys & Telegram alert routing",
          ],
        },
        {
          id: "pro",
          name: "Pro Autonomous Sentinel",
          price: "$29 / month",
          queryLimit: PLAN_LIMITS.pro,
          features: [
            "10,000 High-Capacity Queries / Month",
            "Up to 6 steps autonomous agent tool execution",
            "Continuous multi-cloud self-healing",
            "Priority Groq 120B reasoning consensus",
            "Dedicated webhook endpoints",
          ],
        },
      ],
    };
  });
}
