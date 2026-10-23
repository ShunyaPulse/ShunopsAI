/**
 * Gemini 3.1 Flash TTS — Emotion-Steered Speech Synthesis
 *
 * Uses gemini-3.1-flash-tts-preview via AI Studio (NOT Enterprise).
 * Reads from the 34-key GEMINI_KEYS pool with O(1) round-robin + 1-retry
 * before cascading out (Rule 6).
 *
 * BANNED: gemini-3.8-flash-tts / gemini-3.8-flash-lite-tts  — Enterprise only.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

// ---------------------------------------------------------------------------
// Key pool (O(1) round-robin per Rule 6)
// ---------------------------------------------------------------------------

let _roundRobinIndex = 0;

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

function nextKey(pool: string[]): string {
  const key = pool[_roundRobinIndex % pool.length]!;
  _roundRobinIndex = (_roundRobinIndex + 1) % pool.length;
  return key;
}

// ---------------------------------------------------------------------------
// Tone → Prompt-prefix map (semantic, not topic-hardcoded — Rule 13)
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
// Voice selection
// ---------------------------------------------------------------------------

/**
 * Maps script voice name / language to a Gemini built-in voice name.
 * Fenrir = high-energy narrator; Alnilam = deep authoritative anchor.
 */
function resolveGeminiVoice(
  scriptVoice: string | undefined,
  domain: string | undefined
): string {
  if (scriptVoice) {
    // Pass through Gemini native voice names directly
    if (/^(Fenrir|Alnilam|Aoede|Puck|Despina|Charon)$/i.test(scriptVoice)) {
      return scriptVoice;
    }
    // Infer from Chirp3-HD voice names used in GCP
    if (/Fenrir/i.test(scriptVoice)) return "Fenrir";
    if (/Alnilam/i.test(scriptVoice)) return "Alnilam";
    if (/Aoede/i.test(scriptVoice)) return "Aoede";
  }
  // Domain-based selection: sports/general → Fenrir (dynamic); others → Alnilam (deep anchor)
  return domain === "sports" || domain === "general" ? "Fenrir" : "Alnilam";
}

// ---------------------------------------------------------------------------
// Core synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesizes speech using Gemini 3.1 Flash TTS Preview.
 *
 * @param text        Narration text to synthesize.
 * @param outPath     Absolute path for the output MP3 file.
 * @param tone        Scene emotional tone (from VideoScript.scenes[].tone).
 * @param scriptVoice Optional: GCP-style voice name used to infer Gemini voice.
 * @param domain      Optional: video domain for voice selection.
 * @param byokKey     Optional: per-request BYOK key override.
 * @returns           true on success, false on any failure (never throws).
 */
export async function synthesizeGeminiTTS(
  text: string,
  outPath: string,
  tone: string = "neutral",
  scriptVoice?: string,
  domain?: string,
  byokKey?: string
): Promise<boolean> {
  const pool = byokKey ? [byokKey] : getKeyPool();
  if (pool.length === 0) {
    console.warn("[Gemini TTS] No API keys available in GEMINI_KEYS pool.");
    return false;
  }

  const voiceName = resolveGeminiVoice(scriptVoice, domain);
  const prefix = TONE_PROMPT_PREFIX[tone] ?? TONE_PROMPT_PREFIX["neutral"]!;
  const steeringPrompt = `${prefix}\n\n${text}`;

  // Up to 2 key attempts before cascading out (Rule 6)
  const maxAttempts = Math.min(2, pool.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = byokKey ?? nextKey(pool);
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
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 429) {
        console.warn(`[Gemini TTS] 429 rate-limit on attempt ${attempt + 1}. Rotating key...`);
        continue; // advance to next key via nextKey() on next loop iteration
      }

      if (!res.ok) {
        console.warn(`[Gemini TTS] HTTP ${res.status} on attempt ${attempt + 1}. Cascading.`);
        return false;
      }

      const data: any = await res.json();
      const audioBase64: string | undefined =
        data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioBase64) {
        console.warn(`[Gemini TTS] Empty audio payload on attempt ${attempt + 1}.`);
        continue;
      }

      const audioBuffer = Buffer.from(audioBase64, "base64");
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, audioBuffer);
      console.log(
        `[Gemini TTS] ✅ Synthesized ${audioBuffer.length} bytes | tone="${tone}" voice="${voiceName}" -> ${path.basename(outPath)}`
      );
      return true;
    } catch (err: any) {
      console.warn(`[Gemini TTS] Attempt ${attempt + 1} exception: ${err.message}`);
    }
  }

  return false;
}

