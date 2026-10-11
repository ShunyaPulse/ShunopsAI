import type { FastifyInstance } from "fastify";
import { runAutonomousAgent, toolRegistry, type ToolName } from "../../agent/index.js";
import { ChatRequestSchema, type ChatRequest } from "../schemas/alert.js";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

// In-memory sliding window rate-limiter for anonymous callers using owner LLM quota
const anonymousRateLimits = new Map<string, RateLimitBucket>();
const ANON_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const ANON_MAX_REQUESTS = 5; // 5 requests per 10 minutes per IP

function checkAnonymousQuota(ip: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = anonymousRateLimits.get(ip);

  // Periodic cleanup if map grows
  if (anonymousRateLimits.size > 10_000) {
    for (const [key, b] of anonymousRateLimits.entries()) {
      if (b.resetAt <= now) anonymousRateLimits.delete(key);
    }
  }

  if (!bucket || bucket.resetAt <= now) {
    anonymousRateLimits.set(ip, { count: 1, resetAt: now + ANON_WINDOW_MS });
    return { allowed: true, remaining: ANON_MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= ANON_MAX_REQUESTS) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  bucket.count += 1;
  return { allowed: true, remaining: ANON_MAX_REQUESTS - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Public conversational endpoint for website visitors (Fastify Engine).
 * Body: { message: string, history?: string }
 *
 * OWNER QUOTA GUARDRAIL:
 * - Anonymous callers (no BYOK header): capped at 5 requests / 10 minutes per IP, maxSteps: 1.
 * - BYOK callers (x-groq-key or x-gemini-key): uses visitor's own quota, standard limits.
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatRequest }>(
    "/api/chat",
    {
      schema: {
        body: ChatRequestSchema,
      },
    },
    async (req, reply) => {
      const { message, history } = req.body;
      const userGroqKey = (req.headers["x-groq-key"] as string | undefined)?.trim();
      const userGeminiKey = (req.headers["x-gemini-key"] as string | undefined)?.trim();

      const isBYOK = Boolean(userGroqKey || userGeminiKey);
      const keyOverrides = isBYOK ? {
        groqApiKey: userGroqKey,
        geminiApiKey: userGeminiKey,
      } : undefined;

      // Strict Quota Guardrail for Owner Keys
      if (!isBYOK) {
        const clientIp = req.ip || (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
        const quota = checkAnonymousQuota(clientIp);

        reply.header("X-RateLimit-Limit", ANON_MAX_REQUESTS);
        reply.header("X-RateLimit-Remaining", quota.remaining);

        if (!quota.allowed) {
          reply.header("Retry-After", quota.retryAfterSeconds);
          reply.status(429);
          return {
            reply: `Anonymous usage quota exceeded (5 requests per 10 minutes to protect server resources). Please enter your own free Groq or Gemini API key in the BYOK Settings / Portal to continue chatting without limits!`,
            success: false,
          };
        }
      }

      try {
        const goal = `Answer this website visitor query politely and helpfully: "${message}". Context/History: ${history || "None"}`;
        const result = await runAutonomousAgent(goal, {
          maxSteps: isBYOK ? 3 : 1, // Single step for anonymous to minimize owner token consumption
          disabledTools: Object.keys(toolRegistry) as ToolName[],
          keyOverrides,
        });

        return {
          reply: result.finalAnswer || "I'm here to help! Could you please clarify your question?",
          success: result.success,
        };
      } catch (error: any) {
        req.log.warn("Chat completion error: [REDACTED]");
        reply.status(500);
        return {
          reply: "Sorry, I encountered an issue processing your request. Please try again shortly.",
        };
      }
    }
  );
}
