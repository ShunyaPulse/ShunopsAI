import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { isGoogleCloudTTSAvailable, synthesizeGoogleCloudTTS, resolveGCPVoice } from "./gcp-tts.js";

const execFileAsync = promisify(execFile);

// ==========================================
// ShunopsAI SOTA Speech Synthesis Engine: Kokoro-82M + Edge-TTS + Neural2 Cascade
// Kokoro-82M: Open-weight 82M parameter neural TTS (ElevenLabs-quality, 0 API cost)
// Cascades: Kokoro-82M ➔ Google Cloud Neural2 ➔ Edge-TTS
// ==========================================

export const KOKORO_CURATED_VOICES = {
  us_female: "af_heart",   // Clear, warm, articulate female narrator
  us_male: "am_adam",      // Deep, cinematic, documentary male voice
  uk_female: "bf_emma",    // BBC documentary anchor tone
  uk_male: "bm_george",    // Authoritative intellectual tone
  hindi_female: "hf_alpha",
  hindi_male: "hm_omega",
};

let cachedKokoroAvailability: boolean | null = null;

/**
 * Checks if Kokoro ONNX or Python package is present in the host/runner environment.
 */
export async function isKokoroAvailable(): Promise<boolean> {
  if (cachedKokoroAvailability !== null) {
    return cachedKokoroAvailability;
  }

  try {
    const { stdout } = await execFileAsync("python", [
      "-c",
      "import kokoro; print('KOKORO_READY')",
    ], { timeout: 3000 });

    cachedKokoroAvailability = stdout.includes("KOKORO_READY");
    return cachedKokoroAvailability;
  } catch {
    cachedKokoroAvailability = false;
    return false;
  }
}

/**
 * Resolves voice identifier for Kokoro.
 */
export function resolveKokoroVoice(requestedVoice?: string, language = "English"): string {
  if (requestedVoice && Object.values(KOKORO_CURATED_VOICES).includes(requestedVoice as any)) {
    return requestedVoice;
  }
  const isHindi = /hindi/i.test(language) || (requestedVoice && requestedVoice.toLowerCase().includes("hindi"));
  if (isHindi) {
    return requestedVoice && requestedVoice.toLowerCase().includes("female")
      ? KOKORO_CURATED_VOICES.hindi_female
      : KOKORO_CURATED_VOICES.hindi_male;
  }
  return requestedVoice && requestedVoice.toLowerCase().includes("female")
    ? KOKORO_CURATED_VOICES.us_female
    : KOKORO_CURATED_VOICES.us_male;
}

/**
 * Synthesizes audio using Kokoro-82M runner.
 */
export async function synthesizeKokoroTTS(
  text: string,
  outPath: string,
  options?: { voice?: string; language?: string; speed?: number }
): Promise<boolean> {
  const isReady = await isKokoroAvailable();
  if (!isReady) return false;

  const voice = resolveKokoroVoice(options?.voice, options?.language);
  const speed = options?.speed ?? 1.0;

  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    // Execute Kokoro synthesis script via Python runner safely escaped
    const safeText = JSON.stringify(text);
    const safeOut = JSON.stringify(outPath.replace(/\\/g, "/"));
    const safeVoice = JSON.stringify(voice);
    const script = `
import kokoro
import soundfile as sf
pipeline = kokoro.KPipeline(lang_code='a')
generator = pipeline(${safeText}, voice=${safeVoice}, speed=${speed})
for _, _, audio in generator:
    sf.write(${safeOut}, audio, 24000)
    break
`;

    await execFileAsync("python", ["-c", script], { timeout: 15000 });

    if (fsSync.existsSync(outPath) && (await fs.stat(outPath)).size > 500) {
      console.log(`[Kokoro-82M TTS] ✅ Synthesized using "${voice}" -> ${path.basename(outPath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(`[Kokoro-82M TTS] Notice: Kokoro execution failed (${err.message}). Cascading to fallback...`);
    return false;
  }
}

/**
 * Edge-TTS fallback synthesis (uses edge-tts CLI tool).
 */
export async function synthesizeEdgeTTS(
  text: string,
  outPath: string,
  voice = "en-IN-PrabhatNeural",
  rate = "+0%"
): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await execFileAsync("edge-tts", [
      "--text",
      text,
      "--write-media",
      outPath,
      "--voice",
      voice,
      "--rate",
      rate,
    ], { timeout: 15000 });

    if (fsSync.existsSync(outPath) && (await fs.stat(outPath)).size > 500) {
      console.log(`[Edge-TTS] ✅ Synthesized audio using "${voice}" -> ${path.basename(outPath)}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Unified Multi-Tier Speech Synthesis Cascade:
 * - Hindi Content: Tier 1: Google Cloud Neural2 (Documentary Studio) ➔ Tier 2: Microsoft Edge-TTS (Madhur/Swara)
 * - English Content: Tier 1: Kokoro-82M (Kaggle GPU / ONNX SOTA) ➔ Tier 2: Google Cloud Neural2 ➔ Tier 3: Edge-TTS
 */
export async function synthesizeUnifiedSpeech(
  text: string,
  outPath: string,
  options?: {
    voice?: string;
    language?: string;
    gcpKey?: string;
    speed?: number;
  }
): Promise<{ success: boolean; tierUsed: "kokoro" | "gcp" | "edge" | "none" }> {
  const isHindi = /hindi/i.test(options?.language || "") || (options?.voice && /hindi|madhur|swara/i.test(options.voice));

  // 1. For Hindi Content: Kokoro lacks native Hindi datasets.
  // Directly prioritize Google Cloud Neural2 -> Microsoft Edge-TTS
  if (isHindi) {
    if (isGoogleCloudTTSAvailable(options?.gcpKey)) {
      const gcpSuccess = await synthesizeGoogleCloudTTS(text, outPath, {
        voiceName: options?.voice,
        language: "Hindi",
        gcpKey: options?.gcpKey,
      });
      if (gcpSuccess) {
        return { success: true, tierUsed: "gcp" };
      }
    }

    const edgeVoice = options?.voice && /swara|female/i.test(options.voice) ? "hi-IN-SwaraNeural" : "hi-IN-MadhurNeural";
    const edgeSuccess = await synthesizeEdgeTTS(text, outPath, edgeVoice);
    if (edgeSuccess) {
      return { success: true, tierUsed: "edge" };
    }

    return { success: false, tierUsed: "none" };
  }

  // 2. For English Content: Prioritize Kokoro-82M (Option A: Kaggle GPU / ONNX)
  const kokoroSuccess = await synthesizeKokoroTTS(text, outPath, options);
  if (kokoroSuccess) {
    return { success: true, tierUsed: "kokoro" };
  }

  // Fallback 1 for English: Google Cloud Neural2
  if (isGoogleCloudTTSAvailable(options?.gcpKey)) {
    const gcpSuccess = await synthesizeGoogleCloudTTS(text, outPath, {
      voiceName: options?.voice,
      language: options?.language,
      gcpKey: options?.gcpKey,
    });
    if (gcpSuccess) {
      return { success: true, tierUsed: "gcp" };
    }
  }

  // Fallback 2 for English: Edge-TTS
  const edgeSuccess = await synthesizeEdgeTTS(text, outPath, "en-IN-PrabhatNeural");
  if (edgeSuccess) {
    return { success: true, tierUsed: "edge" };
  }

  return { success: false, tierUsed: "none" };
}

