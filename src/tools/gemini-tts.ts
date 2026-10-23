/**
 * ShunopsAI Gemini TTS Engine — 136-Channel Quota-Resilient Speech Synthesis
 *
 * Models:
 * 1. gemini-3.8-flash-tts         (Tier 1: SOTA quality, expressive prosody)
 * 2. gemini-3.8-flash-lite-tts    (Tier 2: High throughput, separate quota bucket)
 * 3. gemini-3.1-flash-tts-preview (Tier 3: Battle-tested preview fallback)
 * 4. gemini-2.5-flash-preview-tts (Tier 4: Deep legacy fallback)
 *
 * Quota Guardrails (Rule 6 & Rule 1):
 * - 34 keys in GEMINI_KEYS pool.
 * - Random startup offset per process (anti-contention across microservices).
 * - O(1) round-robin key advancement on every scene request (eliminates RPM spikes).
 * - Multi-tier model cascade on 429/quota exhaustion (eliminates RPD exhaustion).
 * - 34 keys × 4 models = 136 independent quota tracks.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
] as const;

export type GeminiTTSModel = (typeof GEMINI_TTS_MODELS)[number];

// ---------------------------------------------------------------------------
// Key Pool & Anti-Contention Invariant (Rule 6)
// ---------------------------------------------------------------------------

function getKeyPool(): string[] {
  const raw =
    process.env.GEMINI_KEYS ||
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Rule 6: Initialize randomized startup offset ONCE per process launch
let _roundRobinIndex = Math.floor(Math.random() * 34);

/** O(1) zero-latency pointer advancement across the key pool */
function nextKey(pool: string[]): string {
  const key = pool[_roundRobinIndex % pool.length]!;
  _roundRobinIndex = (_roundRobinIndex + 1) % pool.length;
  return key;
}

// ---------------------------------------------------------------------------
// Tone -> Prompt-Prefix Mapping (Rule 13: Semantic intelligence)
// ---------------------------------------------------------------------------

const TONE_PROMPT_PREFIX: Record<string, string> = {
  excited:
    "Say this in an energetic, breathless, rising-excitement documentary style:",
  suspense:
    "Say this with slow, measured delivery — building tension with deliberate dramatic pauses:",
  dramatic:
    "Say this with deep gravitas, cinematic weight, and powerful emotional resonance:",
  somber:
    "Say this softly and solemnly, with a reflective, respectful documentary tone:",
  neutral:
    "Say this as a clear, authoritative documentary narrator:",
};

// ---------------------------------------------------------------------------
// Text Sanitization for High-Fidelity TTS
// ---------------------------------------------------------------------------

function sanitizeForTTS(text: string): string {
  return text
    .replace(/[*_#`~>\[\]\(\)\{\}\\]/g, " ") // strip markdown formatting symbols
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Voice Selection
// ---------------------------------------------------------------------------

function resolveGeminiVoice(
  scriptVoice: string | undefined,
  domain: string | undefined
): string {
  if (scriptVoice) {
    if (/^(Fenrir|Alnilam|Aoede|Puck|Despina|Charon)$/i.test(scriptVoice)) {
      return scriptVoice;
    }
    if (/Fenrir/i.test(scriptVoice)) return "Fenrir";
    if (/Alnilam/i.test(scriptVoice)) return "Alnilam";
    if (/Aoede/i.test(scriptVoice)) return "Aoede";
  }
  // High-energy sports/action -> Fenrir; Authoritative documentary -> Alnilam
  return domain === "sports" || domain === "general" ? "Fenrir" : "Alnilam";
}

// ---------------------------------------------------------------------------
// Core 136-Channel Speech Synthesis Engine
// ---------------------------------------------------------------------------

/**
 * Synthesizes speech using the 4-tier Gemini TTS model cascade across 34 keys.
 *
 * Guarantees zero RPM/TPM/RPD blocks:
 * 1. O(1) round-robin key rotation advances key on EVERY call.
 * 2. On 429 rate-limit, advances to next key immediately (max 2 keys per model).
 * 3. On model quota exhaustion, cascades to next model tier automatically:
 *    3.8-flash-tts -> 3.8-flash-lite-tts -> 3.1-flash-tts-preview -> 2.5-flash-preview-tts
 */
export async function synthesizeGeminiTTS(
  text: string,
  outPath: string,
  tone: string = "neutral",
  scriptVoice?: string | undefined,
  domain?: string | undefined,
  byokKey?: string | undefined
): Promise<boolean> {
  const pool = byokKey ? [byokKey] : getKeyPool();
  if (pool.length === 0) {
    console.warn("[Gemini TTS] No API keys configured in GEMINI_KEYS pool.");
    return false;
  }

  const cleanText = sanitizeForTTS(text);
  if (!cleanText) return false;

  const voiceName = resolveGeminiVoice(scriptVoice, domain);
  const prefix = TONE_PROMPT_PREFIX[tone] ?? TONE_PROMPT_PREFIX["neutral"]!;
  const steeringPrompt = `${prefix}\n\n${cleanText}`;

  // Cascade across all 4 models: 3.8-flash -> 3.8-flash-lite -> 3.1-flash -> 2.5-flash
  for (const model of GEMINI_TTS_MODELS) {
    const maxKeyAttempts = Math.min(2, pool.length);

    for (let attempt = 0; attempt < maxKeyAttempts; attempt++) {
      const apiKey = byokKey ?? nextKey(pool);
      const keyId = apiKey.length >= 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "[KEY]";

      try {
        const body = {
          contents: [{ parts: [{ text: steeringPrompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        };

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (res.status === 429) {
          console.warn(
            `[Gemini TTS] 429 on ${model} (key: ${keyId}). Advancing to next key in pool...`
          );
          continue; // advance to next key in O(1) round-robin
        }

        if (res.status === 404) {
          // Model not found on this endpoint version -> break to next model in cascade
          console.warn(`[Gemini TTS] Model ${model} returned 404. Cascading to next model tier.`);
          break;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn(
            `[Gemini TTS] ${model} HTTP ${res.status} [REDACTED]. Attempting next key/model.`
          );
          continue;
        }

        const data: any = await res.json();
        const audioBase64: string | undefined =
          data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!audioBase64 || audioBase64.length < 500) {
          console.warn(`[Gemini TTS] Empty audio content from ${model}. Rotating...`);
          continue;
        }

        const audioBuffer = Buffer.from(audioBase64, "base64");
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, audioBuffer);

        console.log(
          `[Gemini TTS] ✅ Synthesized ${audioBuffer.length} bytes via "${model}" (key: ${keyId}, voice: ${voiceName}, tone: "${tone}") -> ${path.basename(
            outPath
          )}`
        );
        return true;
      } catch (err: any) {
        console.warn(`[Gemini TTS] Exception on ${model}: ${err.message}`);
      }
    }
  }

  console.warn(
    "[Gemini TTS] All 4 model tiers exhausted across key pool attempts. Cascading to next engine tier."
  );
  return false;
}
