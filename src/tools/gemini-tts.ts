/**
 * ShunopsAI Gemini TTS Engine — 136-Channel Indian-Steered Speech Synthesis
 *
 * Models:
 * 1. gemini-3.8-flash-tts         (Tier 1: SOTA quality, expressive Indian prosody)
 * 2. gemini-3.8-flash-lite-tts    (Tier 2: High throughput, separate quota bucket)
 * 3. gemini-3.1-flash-tts-preview (Tier 3: Battle-tested preview fallback)
 * 4. gemini-2.5-flash-preview-tts (Tier 4: Deep legacy fallback)
 *
 * Voice Persona Architecture (Tested & User Verified):
 * - Documentary / Science / Space / History / General -> Aoede (Authentic Indian documentary anchor)
 * - Sports / Action / High-Energy -> Fenrir (Indian sports commentator with breathless excitement)
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
// Indian Persona & Cadence Steering (Tested & User-Verified)
// ---------------------------------------------------------------------------

const INDIAN_PERSONA_BASE =
  "You are an authentic Indian documentary narrator and commentator with a natural, crisp Indian accent and pronunciation. Speak with natural Indian cadence and rhythm, without any foreign or American accent.";

const TONE_PROMPT_PREFIX: Record<string, string> = {
  excited:
    `${INDIAN_PERSONA_BASE} Speak with intense rising excitement, breathless energy, and celebratory Indian sports commentary style:`,
  suspense:
    `${INDIAN_PERSONA_BASE} Deliver this mystery with slow, suspenseful pacing, deliberate dramatic pauses, and deep investigative gravitas:`,
  dramatic:
    `${INDIAN_PERSONA_BASE} Deliver this historic turning point with deep gravitas, cinematic weight, and powerful emotional resonance:`,
  somber:
    `${INDIAN_PERSONA_BASE} Speak softly, solemnly, and respectfully with a reflective Indian documentary tone:`,
  neutral:
    `${INDIAN_PERSONA_BASE} Deliver this as an articulate, clear, and engaging Indian documentary anchor:`,
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
// Voice Selection (Aoede = Documentary / Fenrir = Sports)
// ---------------------------------------------------------------------------

function resolveGeminiVoice(
  scriptVoice: string | undefined,
  domain: string | undefined
): string {
  if (scriptVoice) {
    if (/^(Aoede|Fenrir|Puck|Alnilam|Despina|Charon)$/i.test(scriptVoice)) {
      return scriptVoice;
    }
    if (/aoede/i.test(scriptVoice)) return "Aoede";
    if (/fenrir/i.test(scriptVoice)) return "Fenrir";
  }
  // User verified: Aoede is the superior documentary/general anchor; Fenrir for sports action
  return domain === "sports" ? "Fenrir" : "Aoede";
}

// ---------------------------------------------------------------------------
// Core 136-Channel Speech Synthesis Engine
// ---------------------------------------------------------------------------

/**
 * Synthesizes speech using the 4-tier Gemini TTS model cascade across 34 keys.
 * Enforces Indian persona & cadence steering on all outputs.
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
          console.warn(`[Gemini TTS] Model ${model} returned 404. Cascading to next model tier.`);
          break;
        }

        if (!res.ok) {
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
