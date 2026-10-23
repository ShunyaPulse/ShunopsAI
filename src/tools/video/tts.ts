import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { VideoDomain } from "./types.js";

const execFileAsync = promisify(execFile);
const EDGE_TTS_TIMEOUT_MS = 30000;
const MIN_AUDIO_BYTES = 500;

/** Curated Microsoft Edge-TTS voices for non-GCP users. */
export function resolveEdgeVoice(
  requestedVoice?: string,
  language = "Hindi",
  domain: VideoDomain = "general"
): { name: string; pitch: string; rate: string } {
  const isHindi = /hindi/i.test(language) || (requestedVoice && requestedVoice.toLowerCase().includes("hi"));
  const defaultRate = domain === "sports" ? "+4%" : "+0%";
  const defaultPitch = domain === "sports" ? "+0Hz" : (domain === "science" || domain === "space" || domain === "technology" || domain === "history" ? "-2Hz" : "+0Hz");

  if (isHindi) {
    if (requestedVoice && (requestedVoice.toLowerCase().includes("swara") || requestedVoice.toLowerCase().includes("female"))) {
      return { name: "hi-IN-SwaraNeural", pitch: defaultPitch, rate: defaultRate };
    }
    // Natural, crisp male Hindi voice
    return { name: "hi-IN-MadhurNeural", pitch: defaultPitch, rate: defaultRate };
  }

  // English
  if (requestedVoice && (requestedVoice.toLowerCase().includes("neerja") || requestedVoice.toLowerCase().includes("female"))) {
    return { name: "en-IN-NeerjaExpressiveNeural", pitch: defaultPitch, rate: defaultRate };
  }
  return { name: "en-IN-PrabhatNeural", pitch: defaultPitch, rate: defaultRate };
}

/**
 * Standardizes Hindi text and English acronyms for flawless TTS pronunciation.
 * Prevents voice synthesis engines from garbling acronyms, awkward numbers, and irregular conjuncts.
 */
export function sanitizeNarrationForTTS(text: string, language = "Hindi"): string {
  if (!/hindi/i.test(language)) return text;

  let s = text;

  // 1. Expand English acronyms to natural Hindi hyphenated syllables
  s = s.replace(/\bUNSC\b/g, "यू-एन-एस-सी");
  s = s.replace(/\bNATO\b/g, "नाटो");
  s = s.replace(/\bISRO\b/g, "इसरो");
  s = s.replace(/\bNASA\b/g, "नासा");
  s = s.replace(/\bAI\b/g, "ए-आई");
  s = s.replace(/\bGPU\b/g, "जी-पी-यू");
  s = s.replace(/\bCPU\b/g, "सी-पी-यू");
  s = s.replace(/\bWHO\b/g, "डब्ल्यू-एच-ओ");
  s = s.replace(/\bWTO\b/g, "डब्ल्यू-टी-ओ");
  s = s.replace(/\bUN\b/g, "संयुक्त राष्ट्र");

  // 2. Fix garbled phonetic pronunciations reported in production renders
  s = s.replace(/चीरती\s+हुई/g, "पार करती हुई");
  s = s.replace(/\bह्यूम\b/g, "हमें");

  // 3. Normalize numbers with commas so engines don't stutter (e.g. 1,465 -> 1465)
  s = s.replace(/(\d+),(\d+)/g, (_match, p1, p2) => `${p1}${p2}`);

  return s;
}

/**
 * Pre-synthesizes narration locally using Microsoft Edge-TTS via python -m edge_tts.
 * Packages ready audio into the Kaggle dataset to bypass Kaggle datacenter IP 403 Forbidden blocks.
 */
export async function synthesizeLocalEdgeTTS(
  text: string,
  outPath: string,
  voice = "hi-IN-MadhurNeural",
  pitch = "+0Hz",
  rate = "+0%",
  language = "Hindi"
): Promise<boolean> {
  const sanitizedText = sanitizeNarrationForTTS(text, language);
  const tmpTxt = path.join(os.tmpdir(), `edge_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  try {
    await fs.writeFile(tmpTxt, sanitizedText, "utf-8");
    const args = ["-m", "edge_tts", "-f", tmpTxt, "-v", voice, "--pitch", pitch, "--rate", rate, "--write-media", outPath];
    await execFileAsync("python", args, { timeout: EDGE_TTS_TIMEOUT_MS });
    const stat = await fs.stat(outPath);
    return stat.size > MIN_AUDIO_BYTES;
  } catch (err: any) {
    return false;
  } finally {
    await fs.unlink(tmpTxt).catch(() => {});
  }
}
