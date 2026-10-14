import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { getUserUsageAndPlan, PLAN_LIMITS } from "../db.js";

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
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tokenLimit: usage.tokenLimit,
      limit: usage.tokenLimit,
      remainingTokens: Math.max(0, usage.tokenLimit - usage.totalTokens),
      remaining: Math.max(0, usage.tokenLimit - usage.totalTokens),
      lastResetAt: usage.lastResetAt,
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
          tokenLimit: PLAN_LIMITS.community,
          queryLimit: "1.5M Tokens / Mo",
          features: [
            "1,500,000 Total Tokens / Month (Free Tier)",
            "Full input & output token metering",
            "Single-step ReAct fast answers",
            "Neon Postgres multi-tenancy",
            "Standard community support",
          ],
        },
        {
          id: "byok",
          name: "BYOK Unlimited",
          price: "Free (Bring Your Own Key)",
          tokenLimit: PLAN_LIMITS.byok,
          queryLimit: "Unlimited",
          features: [
            "Unlimited Token Allowance (BYOK)",
            "3 steps autonomous multi-turn reasoning",
            "Direct zero-cost Groq & Gemini LPU inference",
            "Personal API Keys & Telegram alert routing",
          ],
        },
        {
          id: "pro",
          name: "Pro Autonomous Sentinel",
          price: "$29 / month",
          tokenLimit: PLAN_LIMITS.pro,
          queryLimit: "25M Tokens / Mo",
          features: [
            "25,000,000 High-Capacity Tokens / Month",
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
