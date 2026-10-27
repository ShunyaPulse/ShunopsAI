import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isGoogleCloudTTSAvailable, synthesizeGoogleCloudTTS } from "./gcp-tts.js";

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

let cachedPythonBin: string | null = null;
let cachedKokoroAvailability: boolean | null = null;

/**
 * Resolves the available Python executable (`python3` or `python`) across Linux/macOS/Windows.
 */
export async function resolvePythonBin(): Promise<string> {
  if (cachedPythonBin) return cachedPythonBin;
  const candidates = os.platform() === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ["--version"], { timeout: 3000 });
      cachedPythonBin = bin;
      return bin;
    } catch {
      // try next candidate
    }
  }
  cachedPythonBin = "python3";
  return cachedPythonBin;
}

/**
 * Checks if Kokoro ONNX or Python package is present in the host/runner environment.
 */
export async function isKokoroAvailable(): Promise<boolean> {
  if (cachedKokoroAvailability !== null) {
    return cachedKokoroAvailability;
  }

  try {
    const pyBin = await resolvePythonBin();
    const { stdout } = await execFileAsync(pyBin, [
      "-c",
      "import kokoro; print('KOKORO_READY')",
    ], { timeout: 5000 });

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
  const reqLower = (requestedVoice || "").toLowerCase();
  const isHindi = /hindi/i.test(language) || reqLower.includes("hindi") || reqLower.startsWith("hi-");
  if (isHindi) {
    return reqLower.includes("female") || reqLower.includes("swara")
      ? KOKORO_CURATED_VOICES.hindi_female
      : KOKORO_CURATED_VOICES.hindi_male;
  }
  if (reqLower.includes("ryan") || reqLower.includes("en-gb") || reqLower.includes("british") || reqLower.includes("george")) {
    return reqLower.includes("female") ? KOKORO_CURATED_VOICES.uk_female : KOKORO_CURATED_VOICES.uk_male;
  }
  return reqLower.includes("female") || reqLower.includes("neerja") || reqLower.includes("aria")
    ? KOKORO_CURATED_VOICES.us_female
    : KOKORO_CURATED_VOICES.us_male;
}

/**
 * Synthesizes audio using Kokoro-82M runner.
 * Concatenates all multi-sentence generator chunks and transcodes WAV -> 44.1kHz MP3 via ffmpeg.
 */
export async function synthesizeKokoroTTS(
  text: string,
  outPath: string,
  options?: { voice?: string | undefined; language?: string | undefined; speed?: number | undefined }
): Promise<boolean> {
  const isReady = await isKokoroAvailable();
  if (!isReady) return false;

  const voice = resolveKokoroVoice(options?.voice, options?.language);
  const langCode = voice.startsWith("b") ? "b" : (voice.startsWith("h") ? "h" : "a");
  const speed = options?.speed ?? 1.0;
  const tmpWav = path.join(os.tmpdir(), `kokoro_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const pyBin = await resolvePythonBin();

    // Execute Kokoro synthesis script via Python runner safely escaped, joining all chunks
    const safeText = JSON.stringify(text);
    const safeWav = JSON.stringify(tmpWav.replace(/\\/g, "/"));
    const safeVoice = JSON.stringify(voice);
    const safeLang = JSON.stringify(langCode);
    const script = `
import kokoro
import numpy as np
import soundfile as sf
pipeline = kokoro.KPipeline(lang_code=${safeLang})
generator = pipeline(${safeText}, voice=${safeVoice}, speed=${speed})
chunks = []
for _, _, audio in generator:
    if audio is not None and len(audio) > 0:
        chunks.append(audio)
if chunks:
    full_audio = np.concatenate(chunks)
    sf.write(${safeWav}, full_audio, 24000)
`;

    await execFileAsync(pyBin, ["-c", script], { timeout: 25000 });

    if (!fsSync.existsSync(tmpWav) || (await fs.stat(tmpWav)).size <= 300) {
      return false;
    }

    if (outPath.toLowerCase().endsWith(".wav")) {
      await fs.copyFile(tmpWav, outPath);
    } else {
      // Transcode 24kHz WAV to standardized 44.1kHz stereo MP3 so concat demuxer never drifts
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        tmpWav,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outPath,
      ], { timeout: 15000 });
    }

    if (fsSync.existsSync(outPath) && (await fs.stat(outPath)).size > 500) {
      console.log(`[Kokoro-82M TTS] ✅ Synthesized using "${voice}" -> ${path.basename(outPath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(`[Kokoro-82M TTS] Notice: Kokoro execution failed (${err.message}). Cascading to fallback...`);
    return false;
  } finally {
    await fs.unlink(tmpWav).catch(() => {});
  }
}

export interface KokoroBatchItem {
  text: string;
  outPath: string;
  voice?: string;
  language?: string;
  speed?: number;
}

/**
 * High-Performance Single-Process Batch Kokoro Synthesis.
 * Loads the 82M KPipeline into memory once and synthesizes all scenes sequentially,
 * avoiding per-scene Python startup and model reload overhead.
 */
export async function synthesizeKokoroBatch(
  items: KokoroBatchItem[]
): Promise<{ successCount: number; total: number }> {
  if (items.length === 0) return { successCount: 0, total: 0 };
  if (items.length === 1) {
    const it = items[0]!;
    const ok = await synthesizeKokoroTTS(it.text, it.outPath, {
      voice: it.voice,
      language: it.language,
      speed: it.speed,
    });
    return { successCount: ok ? 1 : 0, total: 1 };
  }

  const pyBin = await resolvePythonBin();
  const tmpFiles: string[] = [];

  const preparedItems = items.map((it) => {
    const voice = resolveKokoroVoice(it.voice, it.language);
    const langCode = voice.startsWith("b") ? "b" : voice.startsWith("h") ? "h" : "a";
    const tmpWav = path.join(os.tmpdir(), `kokoro_b_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    tmpFiles.push(tmpWav);
    return {
      text: it.text,
      outPath: it.outPath,
      tmpWav: tmpWav.replace(/\\/g, "/"),
      voice,
      langCode,
      speed: it.speed ?? 1.0,
    };
  });

  const pyScript = `
import json, sys, os
import kokoro
import numpy as np
import soundfile as sf

pipelines = {}
items = json.loads(sys.argv[1])
results = []

for item in items:
    out_wav = item["tmpWav"]
    text = item["text"]
    voice = item["voice"]
    lang = item["langCode"]
    speed = item.get("speed", 1.0)
    try:
        if lang not in pipelines:
            pipelines[lang] = kokoro.KPipeline(lang_code=lang)
        pipeline = pipelines[lang]
        gen = pipeline(text, voice=voice, speed=speed)
        chunks = [a for _, _, a in gen if a is not None and len(a) > 0]
        if chunks:
            full = np.concatenate(chunks)
            sf.write(out_wav, full, 24000)
            results.append({"tmpWav": out_wav, "ok": True})
        else:
            results.append({"tmpWav": out_wav, "ok": False, "err": "empty audio"})
    except Exception as e:
        results.append({"tmpWav": out_wav, "ok": False, "err": str(e)})

print(json.dumps(results))
`;

  let successCount = 0;
  const timeoutMs = Math.max(30000, items.length * 6000);

  try {
    const { stdout } = await execFileAsync(pyBin, ["-c", pyScript, JSON.stringify(preparedItems)], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    let results: Array<{ tmpWav: string; ok: boolean; err?: string }> = [];
    try {
      results = JSON.parse(stdout.trim());
    } catch {
      console.warn("[Kokoro-82M Batch] Failed to parse batch json output, falling back to individual synthesis.");
    }

    const resultMap = new Map(results.map((r) => [r.tmpWav, r.ok]));

    for (const prep of preparedItems) {
      await fs.mkdir(path.dirname(prep.outPath), { recursive: true });
      const wasOk = resultMap.get(prep.tmpWav);

      if (wasOk && fsSync.existsSync(prep.tmpWav) && (await fs.stat(prep.tmpWav)).size > 300) {
        if (prep.outPath.toLowerCase().endsWith(".wav")) {
          await fs.copyFile(prep.tmpWav, prep.outPath);
          successCount++;
        } else {
          try {
            await execFileAsync("ffmpeg", [
              "-y",
              "-i",
              prep.tmpWav,
              "-ar",
              "44100",
              "-ac",
              "2",
              "-c:a",
              "libmp3lame",
              "-b:a",
              "192k",
              prep.outPath,
            ], { timeout: 15000 });
            if (fsSync.existsSync(prep.outPath) && (await fs.stat(prep.outPath)).size > 500) {
              successCount++;
            }
          } catch {
            const fallbackOk = await synthesizeKokoroTTS(prep.text, prep.outPath, {
              voice: prep.voice,
              speed: prep.speed,
            });
            if (fallbackOk) successCount++;
          }
        }
      } else {
        const fallbackOk = await synthesizeKokoroTTS(prep.text, prep.outPath, {
          voice: prep.voice,
          speed: prep.speed,
        });
        if (fallbackOk) successCount++;
      }
    }
  } catch (err: any) {
    console.warn(`[Kokoro-82M Batch] Batch execution failed: ${err.message}. Cascading individual fallbacks.`);
    for (const it of items) {
      const ok = await synthesizeKokoroTTS(it.text, it.outPath, {
        voice: it.voice,
        language: it.language,
        speed: it.speed,
      });
      if (ok) successCount++;
    }
  } finally {
    for (const tmp of tmpFiles) {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  return { successCount, total: items.length };
}

/**
 * Edge-TTS fallback synthesis using a temp file (`-f`) to prevent CLI flag-injection on leading hyphens/quotes,
 * followed by 44.1kHz MP3 standardization if ffmpeg is available.
 */
export async function synthesizeEdgeTTS(
  text: string,
  outPath: string,
  voice = "en-IN-PrabhatNeural",
  rate = "+0%",
  pitch = "+0Hz"
): Promise<boolean> {
  const tmpTxt = path.join(os.tmpdir(), `edge_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const tmpRawMp3 = path.join(os.tmpdir(), `edge_raw_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(tmpTxt, text, "utf-8");

    const pyBin = await resolvePythonBin();
    let generated = false;

    try {
      await execFileAsync(pyBin, [
        "-m",
        "edge_tts",
        "-f",
        tmpTxt,
        "-v",
        voice,
        "--rate",
        rate,
        "--pitch",
        pitch,
        "--write-media",
        tmpRawMp3,
      ], { timeout: 25000 });
      generated = fsSync.existsSync(tmpRawMp3) && (await fs.stat(tmpRawMp3)).size > 500;
    } catch {
      // Fallback to direct edge-tts CLI binary with -f
      await execFileAsync("edge-tts", [
        "-f",
        tmpTxt,
        "--write-media",
        tmpRawMp3,
        "--voice",
        voice,
        "--rate",
        rate,
        "--pitch",
        pitch,
      ], { timeout: 25000 });
      generated = fsSync.existsSync(tmpRawMp3) && (await fs.stat(tmpRawMp3)).size > 500;
    }

    if (!generated) return false;

    // Normalize sample rate to 44.1kHz if ffmpeg is available so mixed GCP + Edge-TTS concat never drifts
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        tmpRawMp3,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outPath,
      ], { timeout: 15000 });
    } catch {
      await fs.copyFile(tmpRawMp3, outPath);
    }

    if (fsSync.existsSync(outPath) && (await fs.stat(outPath)).size > 500) {
      console.log(`[Edge-TTS] ✅ Synthesized audio using "${voice}" -> ${path.basename(outPath)}`);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await fs.unlink(tmpTxt).catch(() => {});
    await fs.unlink(tmpRawMp3).catch(() => {});
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
    voice?: string | undefined;
    language?: string | undefined;
    gcpKey?: string | undefined;
    speed?: number | undefined;
    rate?: string | undefined;
    pitch?: string | undefined;
  }
): Promise<{ success: boolean; tierUsed: "kokoro" | "gcp" | "edge" | "none" }> {
  const isHindi =
    /hindi/i.test(options?.language || "") ||
    Boolean(options?.voice && /hindi|madhur|swara|hi-in/i.test(options.voice)) ||
    /[\u0900-\u097F]/.test(text);

  const speed = options?.speed ?? 1.0;
  const rate = options?.rate ?? (speed !== 1.0 ? `${speed >= 1 ? "+" : ""}${Math.round((speed - 1) * 100)}%` : "+0%");
  const pitch = options?.pitch ?? "+0Hz";

  // 1. For Hindi Content: Directly prioritize Google Cloud Neural2 -> Microsoft Edge-TTS
  if (isHindi) {
    if (isGoogleCloudTTSAvailable(options?.gcpKey)) {
      const gcpSuccess = await synthesizeGoogleCloudTTS(text, outPath, {
        voiceName: options?.voice,
        language: "Hindi",
        speakingRate: speed,
        gcpKey: options?.gcpKey,
      });
      if (gcpSuccess) {
        return { success: true, tierUsed: "gcp" };
      }
    }

    const edgeVoice = options?.voice && /swara|female/i.test(options.voice) ? "hi-IN-SwaraNeural" : "hi-IN-MadhurNeural";
    const edgeSuccess = await synthesizeEdgeTTS(text, outPath, edgeVoice, rate, pitch);
    if (edgeSuccess) {
      return { success: true, tierUsed: "edge" };
    }

    return { success: false, tierUsed: "none" };
  }

  // 2. For English Content: Prioritize Kokoro-82M (Option A: Kaggle GPU / ONNX)
  const kokoroSuccess = await synthesizeKokoroTTS(text, outPath, {
    voice: options?.voice,
    language: options?.language,
    speed,
  });
  if (kokoroSuccess) {
    return { success: true, tierUsed: "kokoro" };
  }

  // Fallback 1 for English: Google Cloud Neural2
  if (isGoogleCloudTTSAvailable(options?.gcpKey)) {
    const gcpSuccess = await synthesizeGoogleCloudTTS(text, outPath, {
      voiceName: options?.voice,
      language: options?.language || "English",
      speakingRate: speed,
      gcpKey: options?.gcpKey,
    });
    if (gcpSuccess) {
      return { success: true, tierUsed: "gcp" };
    }
  }

  // Fallback 2 for English: Edge-TTS
  const reqV = (options?.voice || "").toLowerCase();
  const edgeEngVoice = reqV.includes("ryan") || reqV.includes("bm_")
    ? "en-GB-RyanNeural"
    : reqV.includes("guy") || reqV.includes("am_")
      ? "en-US-GuyNeural"
      : reqV.includes("female") || reqV.includes("af_") || reqV.includes("neerja")
        ? "en-IN-NeerjaExpressiveNeural"
        : "en-IN-PrabhatNeural";

  const edgeSuccess = await synthesizeEdgeTTS(text, outPath, edgeEngVoice, rate, pitch);
  if (edgeSuccess) {
    return { success: true, tierUsed: "edge" };
  }

  return { success: false, tierUsed: "none" };
}
