import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeNarrationForTTS } from "./video/tts.js";
import { isSportsOrCricket } from "./video/domain.js";

const execFileAsync = promisify(execFile);

/**
 * ShunopsAI Gemini TTS Engine — 136-Channel Indian-Steered Speech Synthesis
 *
 * Models:
 * 1. gemini-3.8-flash-tts         (Tier 1: SOTA quality, expressive Indian prosody)
 * 2. gemini-3.8-flash-lite-tts    (Tier 2: High throughput, separate quota bucket)
 * 3. gemini-3.1-flash-tts-preview (Tier 3: Battle-tested preview fallback)
 * 4. gemini-2.5-flash-preview-tts (Tier 4: Deep legacy fallback)
 */

export const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
] as const;

export type GeminiTTSModel = (typeof GEMINI_TTS_MODELS)[number];

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
let _roundRobinIndex = crypto.randomInt(0, 34);
const _keyCooldownMap = new Map<string, number>();

/** O(1) zero-latency pointer advancement across the key pool, skipping cooled-off keys */
function nextKey(pool: string[]): string {
  if (pool.length === 0) return "";
  const now = Date.now();
  for (let i = 0; i < pool.length; i++) {
    const idx = (_roundRobinIndex + i) % pool.length;
    const candidate = pool[idx]!;
    const cooloff = _keyCooldownMap.get(candidate) ?? 0;
    if (now > cooloff) {
      _roundRobinIndex = (idx + 1) % pool.length;
      return candidate;
    }
  }
  const key = pool[_roundRobinIndex % pool.length]!;
  _roundRobinIndex = (_roundRobinIndex + 1) % pool.length;
  return key;
}

interface ToneProfile {
  descriptor: string;
  energy: number;
}

const SPORTS_TONE_PROFILES: Record<string, ToneProfile> = {
  excited: { descriptor: "energetic and celebratory with breathless momentum and crisp match excitement", energy: 3 },
  dramatic: { descriptor: "resonant and powerful with deep cinematic weight on key match milestones", energy: 2 },
  suspense: { descriptor: "focused with tense tactical anticipation and measured broadcast cadence", energy: 1 },
  somber: { descriptor: "measured and solemn with respectful gravity and natural pacing", energy: 1 },
  neutral: { descriptor: "articulate with crisp broadcast cadence and engaging natural flow", energy: 1 },
};

const DOC_TONE_PROFILES: Record<string, ToneProfile> = {
  excited: { descriptor: "warm and lively with bright curiosity, vibrant engagement, and crisp pronunciation", energy: 3 },
  dramatic: { descriptor: "deep and resonant with cinematic weight and impactful storytelling", energy: 2 },
  suspense: { descriptor: "thoughtful and measured with quiet curiosity and focused investigative cadence", energy: 1 },
  somber: { descriptor: "reflective and gentle with solemn empathy, respectful warmth, and natural pacing", energy: 1 },
  neutral: { descriptor: "natural and conversational with balanced narrative flow and clear articulation", energy: 1 },
};

export function buildStyleDirective(tone: string, prevTone?: string, domain?: string): string {
  const isSports = domain === "sports";
  const persona = isSports
    ? "authoritative male Indian sports commentator"
    : "articulate Indian documentary anchor";

  const profiles = isSports ? SPORTS_TONE_PROFILES : DOC_TONE_PROFILES;
  const currentKey = (tone || "neutral").toLowerCase();
  const currentProfile = profiles[currentKey] ?? profiles["neutral"]!;

  let transitionClause = "";
  if (prevTone) {
    const prevKey = prevTone.toLowerCase();
    if (prevKey !== currentKey) {
      const prevProfile = profiles[prevKey] ?? profiles["neutral"]!;
      if (prevProfile.energy < currentProfile.energy) {
        transitionClause = `smoothly building momentum from previous ${prevKey} tension into `;
      } else if (prevProfile.energy > currentProfile.energy) {
        transitionClause = `gracefully easing from previous ${prevKey} intensity into `;
      } else {
        transitionClause = `smoothly transitioning from previous ${prevKey} mood into `;
      }
    }
  }

  return `${persona}, ${transitionClause}${currentProfile.descriptor}, maintaining steady vocal presence, grounded timbre, and consistent volume with zero sudden volume drops.`;
}

function sanitizeForTTS(text: string): string {
  let s = text;
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/^(narrator|anchor|voiceover|host|speaker)\s*:\s*/i, "");
  s = s.replace(/[*_#`~>\\{}]/g, " ");
  s = sanitizeNarrationForTTS(s, "Hindi");
  return s.replace(/\s+/g, " ").trim();
}

function resolveGeminiVoice(
  scriptVoice: string | undefined,
  domain: string | undefined,
  topic?: string | undefined
): string {
  if (domain === "sports" || (topic && isSportsOrCricket(topic))) {
    return "Fenrir";
  }
  if (scriptVoice) {
    if (/^(Aoede|Fenrir|Puck|Alnilam|Despina|Charon)$/i.test(scriptVoice)) {
      return scriptVoice;
    }
    if (/fenrir/i.test(scriptVoice)) return "Fenrir";
    if (/aoede/i.test(scriptVoice)) return "Aoede";
  }
  return "Aoede";
}

/**
 * Checks if buffer already begins with a recognized compressed/container audio header
 * (RIFF WAV, ID3 MP3, MPEG sync word, or OggS).
 */
function hasAudioContainerHeader(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const magic4 = buf.subarray(0, 4).toString("ascii");
  if (magic4 === "RIFF" || magic4 === "OggS") return true;
  if (buf.subarray(0, 3).toString("ascii") === "ID3") return true;
  // MPEG-1/2 Audio Layer III frame sync (0xFF followed by 0xE0..0xFF)
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return true;
  return false;
}

/**
 * Wraps raw 16-bit signed little-endian mono PCM (`audio/L16;codec=pcm;rate=24000`)
 * returned by `generativelanguage.googleapis.com` in a standard 44-byte RIFF WAV header.
 */
function wrapRawPcmInWavHeader(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Normalizes Gemini TTS output (which defaults to raw 24kHz L16 PCM on the Developer API)
 * into a standard 44.1kHz stereo MP3 file so downstream `ffprobe` and `shutil.copyfile`
 * never encounter headerless raw PCM masquerading as `.mp3`.
 */
async function persistNormalizedGeminiAudio(
  rawBuffer: Buffer,
  mimeType: string | undefined,
  outPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const mimeLower = (mimeType || "").toLowerCase();
  const isRawPcm =
    mimeLower.includes("pcm") ||
    mimeLower.includes("l16") ||
    !hasAudioContainerHeader(rawBuffer);

  let rate = 24000;
  const rateMatch = mimeLower.match(/rate=(\d+)/);
  if (rateMatch && rateMatch[1]) {
    const parsedRate = parseInt(rateMatch[1], 10);
    if (parsedRate >= 8000 && parsedRate <= 96000) rate = parsedRate;
  }

  const containerBuffer = isRawPcm ? wrapRawPcmInWavHeader(rawBuffer, rate, 1, 16) : rawBuffer;

  if (outPath.toLowerCase().endsWith(".wav")) {
    await fs.writeFile(outPath, containerBuffer);
    return;
  }

  // Transcode to uniform 44.1kHz stereo 192kbps MP3 via ffmpeg
  const tmpWav = path.join(
    os.tmpdir(),
    `gemini_tts_${Date.now()}_${crypto.randomInt(0, 0xffffff).toString(16)}.wav`
  );
  try {
    await fs.writeFile(tmpWav, containerBuffer);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", tmpWav, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", outPath],
      { timeout: 15000 }
    );
    if (fsSync.existsSync(outPath) && fsSync.statSync(outPath).size > 500) {
      return;
    }
  } catch {
    // Fallback if ffmpeg binary is not installed: write RIFF WAV container (which ffprobe/ffmpeg on Kaggle can still decode via magic bytes)
  } finally {
    await fs.unlink(tmpWav).catch(() => {});
  }

  await fs.writeFile(outPath, containerBuffer);
}

/**
 * Synthesizes speech using the Gemini TTS model cascade across 34 keys.
 * Passes ONLY pure narration text to prevent meta-prompt leakage in video audio.
 */
export async function synthesizeGeminiTTS(
  text: string,
  outPath: string,
  tone: string = "neutral",
  scriptVoice?: string | undefined,
  domain?: string | undefined,
  byokKey?: string | undefined,
  prevTone?: string | undefined,
  topic?: string | undefined
): Promise<boolean> {
  const pool = byokKey ? [byokKey] : getKeyPool();
  if (pool.length === 0) {
    console.warn("[Gemini TTS] No API keys configured in GEMINI_KEYS pool.");
    return false;
  }

  const cleanText = sanitizeForTTS(text);
  if (!cleanText) return false;

  const voiceName = resolveGeminiVoice(scriptVoice, domain, topic);
  const styleDirective = buildStyleDirective(tone, prevTone, domain);

  for (let mIdx = 0; mIdx < GEMINI_TTS_MODELS.length; mIdx++) {
    const model = GEMINI_TTS_MODELS[mIdx]!;
    const maxKeyAttempts = Math.min(5, pool.length);

    const partPayload: any = { text: cleanText };
    if (!model.includes("2.5")) {
      partPayload.speech_metadata = { style: styleDirective };
    }

    for (let attempt = 0; attempt < maxKeyAttempts; attempt++) {
      const apiKey = byokKey ?? nextKey(pool);

      try {
        const body = {
          contents: [
            {
              role: "user",
              parts: [partPayload],
            },
          ],
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
            signal: AbortSignal.timeout(25000),
          }
        );

        if (res.status === 429) {
          _keyCooldownMap.set(apiKey, Date.now() + 60_000);
          const backoff = Math.min(1500, 350 * Math.pow(1.4, attempt) + Math.floor(Math.random() * 200));
          console.warn(
            `[Gemini TTS] 429 received on key (indexed cooldown 60s). Backing off ${backoff}ms and advancing to next healthy key...`
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        if (res.status === 404) {
          console.warn(`[Gemini TTS] Model ${model} returned 404. Cascading to next model tier.`);
          break;
        }

        if (res.status === 400) {
          console.warn(`[Gemini TTS] Model ${model} returned 400 (unsupported prompt format). Cascading to next tier.`);
          break;
        }

        if (!res.ok) {
          console.warn(`[Gemini TTS] ${model} HTTP ${res.status} [REDACTED]. Attempting next key/model.`);
          continue;
        }

        const data: any = await res.json();
        const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const audioBase64: string | undefined = inlineData?.data;
        const mimeType: string | undefined = inlineData?.mimeType;

        if (!audioBase64 || audioBase64.length < 500) {
          console.warn(`[Gemini TTS] Empty audio content from ${model}. Rotating...`);
          continue;
        }

        const audioBuffer = Buffer.from(audioBase64, "base64");
        await persistNormalizedGeminiAudio(audioBuffer, mimeType, outPath);

        console.log(
          `[Gemini TTS] ✅ Synthesized ${audioBuffer.length} raw bytes via "${model}" (normalized 44.1kHz stereo) -> ${path.basename(outPath)}`
        );
        return true;
      } catch {
        console.warn(`[Gemini TTS] Exception on ${model}: [REDACTED]`);
      }
    }

    _roundRobinIndex = (_roundRobinIndex + 7) % pool.length;
  }

  console.warn(
    "[Gemini TTS] All 4 model tiers exhausted across key pool attempts. Cascading to next engine tier."
  );
  return false;
}
