import type { FastifyInstance } from "fastify";

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
    };
  }>("/api/portal/verify", async (req, reply) => {
    const body = req.body || {};
    const groq = typeof body.groq === "string" ? body.groq.trim() : "";
    const gemini = typeof body.gemini === "string" ? body.gemini.trim() : "";
    const github = typeof body.github === "string" ? body.github.trim() : "";
    const hf = typeof body.hf === "string" ? body.hf.trim() : "";

    const results: Record<string, { valid: boolean; message: string }> = {};

    // 1. Verify Groq API Key
    if (groq) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
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

    // 2. Verify Google Gemini API Key
    if (gemini) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${gemini}`,
          { signal: AbortSignal.timeout(6000) }
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

    return {
      success: true,
      testedAt: new Date().toISOString(),
      results,
    };
  });
}
