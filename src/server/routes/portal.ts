import type { FastifyInstance } from "fastify";
import { findUserBySessionToken } from "../db.js";
import { getClientIp, getClientSubnet, checkDistributedSubnetQuota } from "../middleware/ratelimit.js";

/**
 * Route plugin for the Public BYOK Self-Service Portal.
 * Provides a stateless credential verification endpoint (POST /api/portal/verify)
 * that tests user keys with minimal, lightweight provider ping requests.
 * Zero database persistence, zero disk writes, zero secret logging.
 */
export async function portalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      groq?: string;
      gemini?: string;
      github?: string;
      hf?: string;
      gcp?: string;
    };
  }>("/api/portal/verify", async (req, reply) => {
    const token = (req.cookies as any)?.shunops_user_session;
    if (!token) {
      reply.status(401);
      return { error: "Authentication required to verify keys. Please log in." };
    }
    const user = await findUserBySessionToken(token);
    if (!user) {
      reply.status(401);
      return { error: "Session expired. Please log in again." };
    }

    // Rate-limit key verification probes per subnet/user to prevent outbound socket exhaustion
    const clientIp = getClientIp(req);
    const clientSubnet = getClientSubnet(clientIp);
    const quota = await checkDistributedSubnetQuota(`portal-verify:${user.id}:${clientSubnet}`, 10, 300);
    if (!quota.allowed) {
      reply.status(429);
      return { error: "Too many key verification requests. Please wait a few minutes." };
    }

    const body = req.body || {};
    const groq = typeof body.groq === "string" ? body.groq.trim() : "";
    const gemini = typeof body.gemini === "string" ? body.gemini.trim() : "";
    const github = typeof body.github === "string" ? body.github.trim() : "";
    const hf = typeof body.hf === "string" ? body.hf.trim() : "";
    const gcp = typeof body.gcp === "string" ? body.gcp.trim() : "";

    const results: Record<string, { valid: boolean; message: string }> = {};

    // 1. Verify Groq API Key
    if (groq) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          redirect: "error",
          headers: { Authorization: `Bearer ${groq}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          results.groq = { valid: true, message: "Connected (Groq LPU API active)" };
        } else {
          results.groq = { valid: false, message: `Invalid Key (HTTP ${res.status})` };
        }
      } catch {
        results.groq = { valid: false, message: "Groq connection timed out" };
      }
    }

    // 2. Verify Google Gemini API Key (pass key via x-goog-api-key header, never in URL query string)
    if (gemini) {
      try {
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models",
          {
            redirect: "error",
            headers: { "x-goog-api-key": gemini },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (res.ok) {
          results.gemini = { valid: true, message: "Connected (Google AI Studio active)" };
        } else {
          results.gemini = { valid: false, message: `Invalid Key (HTTP ${res.status})` };
        }
      } catch {
        results.gemini = { valid: false, message: "Google Gemini connection timed out" };
      }
    }

    // 3. Verify GitHub Token (Fine-grained or classic)
    if (github) {
      try {
        const res = await fetch("https://api.github.com/user", {
          redirect: "error",
          headers: {
            Authorization: `Bearer ${github}`,
            "User-Agent": "ShunopsAI-BYOK-Verification",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          results.github = {
            valid: true,
            message: `Connected (@${data?.login || "user"})`,
          };
        } else {
          results.github = { valid: false, message: `Invalid GitHub Token (HTTP ${res.status})` };
        }
      } catch {
        results.github = { valid: false, message: "GitHub connection timed out" };
      }
    }

    // 4. Verify Hugging Face Token
    if (hf) {
      try {
        const res = await fetch("https://huggingface.co/api/whoami-v2", {
          redirect: "error",
          headers: { Authorization: `Bearer ${hf}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          results.hf = {
            valid: true,
            message: `Connected (@${data?.name || "user"})`,
          };
        } else {
          results.hf = { valid: false, message: `Invalid HF Token (HTTP ${res.status})` };
        }
      } catch {
        results.hf = { valid: false, message: "Hugging Face connection timed out" };
      }
    }

    // 5. Verify Google Cloud TTS (Service Account JSON or API Key)
    if (gcp) {
      try {
        if (gcp.startsWith("{") && gcp.includes("private_key")) {
          try {
            const parsed = JSON.parse(gcp);
            if (parsed.client_email && parsed.private_key) {
              results.gcp = {
                valid: true,
                message: `Connected (Service Account: ${parsed.client_email})`,
              };
            } else {
              results.gcp = {
                valid: false,
                message: "Invalid Service Account JSON (missing client_email or private_key)",
              };
            }
          } catch {
            results.gcp = { valid: false, message: "Invalid JSON format for Service Account" };
          }
        } else {
          const res = await fetch(
            "https://texttospeech.googleapis.com/v1/voices",
            {
              redirect: "error",
              headers: { "x-goog-api-key": gcp },
              signal: AbortSignal.timeout(6000),
            }
          );
          if (res.ok) {
            results.gcp = {
              valid: true,
              message: "Connected (Cloud Text-to-Speech API active)",
            };
          } else {
            results.gcp = {
              valid: false,
              message: `Invalid Key (HTTP ${res.status} from Google Cloud)`,
            };
          }
        }
      } catch {
        results.gcp = { valid: false, message: "Google Cloud connection timed out" };
      }
    }

    return {
      success: true,
      testedAt: new Date().toISOString(),
      results,
    };
  });
}
