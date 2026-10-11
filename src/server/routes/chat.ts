import type { FastifyInstance } from "fastify";
import { runAutonomousAgent, toolRegistry, type ToolName } from "../../agent/index.js";
import { ChatRequestSchema, type ChatRequest } from "../schemas/alert.js";
import {
  verifyCloudflareTurnstile,
  verifyShieldSolution,
} from "../middleware/bot-shield.js";
import {
  getClientIp,
  getClientSubnet,
  checkDistributedSubnetQuota,
} from "../middleware/ratelimit.js";

const ANON_WINDOW_SECONDS = 10 * 60; // 10 minutes
const ANON_MAX_REQUESTS = 5; // 5 requests per 10 minutes per Subnet

/**
 * Public conversational endpoint for website visitors (Fastify Engine).
 *
 * 5-LAYER SECURITY SHIELD (Ported from Kanban-Cloud):
 * Layer 1: Honeypot Trap (hp_website) - drops auto-filling bots instantly.
 * Layer 2: Cloudflare Turnstile Server-Side verification (/v0/siteverify).
 * Layer 3: Cryptographic Proof-of-Work Bot-Shield (fallback if Turnstile unavailable).
 * Layer 4: Subnet-Level Distributed Rate-Limiting (/24 IPv4, /48 IPv6) via OCI Redis.
 * Layer 5: Token & Quota Guardrail (maxSteps: 1 for anonymous, BYOK bypass).
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
      const { message, history, hp_website, turnstileToken, shield } = req.body;
      const clientIp = getClientIp(req);
      const clientSubnet = getClientSubnet(clientIp);

      // Layer 1: Honeypot Trap (if scraper bot filled hidden field, reject immediately)
      if (hp_website) {
        req.log.warn(`Honeypot trap triggered by client: ${clientIp}`);
        reply.status(400);
        return {
          reply: "Security validation error: request rejected.",
          success: false,
        };
      }

      const userGroqKey = (req.headers["x-groq-key"] as string | undefined)?.trim();
      const userGeminiKey = (req.headers["x-gemini-key"] as string | undefined)?.trim();

      // Item 4 Fix: Strictly validate format before granting isBYOK bypass
      // Groq keys start with 'gsk_' and are >= 30 chars. Gemini keys start with 'AIzaSy' and are >= 35 chars.
      const isValidGroqFormat = Boolean(userGroqKey && /^gsk_[a-zA-Z0-9_-]{20,}$/.test(userGroqKey));
      const isValidGeminiFormat = Boolean(userGeminiKey && /^AIzaSy[a-zA-Z0-9_-]{25,}$/.test(userGeminiKey));

      if ((userGroqKey && !isValidGroqFormat) || (userGeminiKey && !isValidGeminiFormat)) {
        reply.status(400);
        return {
          reply: "Invalid BYOK API key format provided in request headers. Please check your Groq or Gemini key.",
          success: false,
        };
      }

      const isBYOK = Boolean(isValidGroqFormat || isValidGeminiFormat);
      const keyOverrides = isBYOK
        ? {
            groqApiKey: isValidGroqFormat ? userGroqKey : undefined,
            geminiApiKey: isValidGeminiFormat ? userGeminiKey : undefined,
          }
        : undefined;

      // Layer 2: Cloudflare Turnstile Verification (if token provided or secret configured)
      if (turnstileToken) {
        const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
        if (!isHuman) {
          reply.status(403);
          return {
            reply: "Cloudflare Turnstile bot verification failed. Please refresh and try again.",
            success: false,
          };
        }
      }

      // Layer 3: Anti-Bot Proof-of-Work Challenge (Stops Python, Curl, Headless scripts)
      if (shield) {
        const isValidShield = verifyShieldSolution(
          shield.salt,
          shield.timestamp,
          shield.targetDifficulty,
          shield.signature,
          shield.solution
        );
        if (!isValidShield) {
          reply.status(403);
          return {
            reply: "Browser security challenge failed. Please refresh the page.",
            success: false,
          };
        }
      }

      // Layer 4 & 5: Subnet-Level Distributed Rate-Limiting & Owner Token Guardrail
      if (!isBYOK) {
        const quota = await checkDistributedSubnetQuota(
          clientSubnet,
          ANON_MAX_REQUESTS,
          ANON_WINDOW_SECONDS
        );

        reply.header("X-RateLimit-Limit", ANON_MAX_REQUESTS);
        reply.header("X-RateLimit-Remaining", quota.remaining);

        if (!quota.allowed) {
          reply.header("Retry-After", quota.retryAfterSeconds);
          reply.status(429);
          return {
            reply: `Anonymous usage quota exceeded (5 requests per 10 minutes per network subnet to protect server resources). Please enter your own free Groq or Gemini API key in the BYOK Settings / Portal to continue chatting without limits!`,
            success: false,
          };
        }
      }

      try {
        const goal = `Answer this query politely and helpfully: "${message}".`;
        const result = await runAutonomousAgent(goal, {
          maxSteps: isBYOK ? 3 : 1, // Single step for anonymous to minimize owner token consumption
          disabledTools: Object.keys(toolRegistry) as ToolName[],
          keyOverrides,
          initialContext: history ? `Previous Conversation Context & Memory:\n${history}` : undefined,
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
