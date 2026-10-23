import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isGoogleCloudTTSAvailable,
  synthesizeGoogleCloudTTS,
  resolveGCPVoice,
} from "../gcp-tts.js";
import { isKokoroAvailable, synthesizeKokoroTTS } from "../kokoro-tts.js";
import { resolveEdgeVoice, sanitizeNarrationForTTS, synthesizeLocalEdgeTTS } from "./tts.js";
import type { VideoScript } from "./types.js";

const MIN_AUDIO_BYTES = 500;

export interface NarrationSynthesis {
  gcpVoiceName: string | null;
  edgeVoiceName: string;
  gcpSuccessCount: number;
  edgeSuccessCount: number;
}

function sceneAudioPath(audioDir: string, index: number): string {
  return path.join(audioDir, `a${String(index).padStart(3, "0")}.mp3`);
}

/** Kokoro is the English Tier 1 engine (Kaggle GPU or local). */
async function tryKokoro(
  narration: string,
  outMp3: string,
  language: string,
  isHindi: boolean
): Promise<boolean> {
  if (isHindi) return false;
  if (!(await isKokoroAvailable())) return false;
  return synthesizeKokoroTTS(narration, outMp3, { language, speed: 1.0 });
}

/** Google Cloud Neural2 with two attempts per scene. */
async function tryGoogleCloudTTS(
  narration: string,
  outMp3: string,
  sceneNumber: number,
  opts: { voiceName: string; language: string; speakingRate: number; gcpKey?: string | undefined }
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ok = await synthesizeGoogleCloudTTS(narration, outMp3, {
        voiceName: opts.voiceName,
        language: opts.language,
        speakingRate: opts.speakingRate,
        gcpKey: opts.gcpKey,
      });
      if (ok) return true;
    } catch (err: any) {
      console.warn(`[Video] ⚠️ Scene ${sceneNumber} Google Cloud TTS attempt ${attempt} failed: ${err.message}`);
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

/** Edge-TTS with three attempts and linear backoff. */
async function tryEdgeTTS(
  narration: string,
  outMp3: string,
  voice: { name: string; pitch: string; rate: string },
  language: string,
  sceneNumber: number
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await synthesizeLocalEdgeTTS(
      narration,
      outMp3,
      voice.name,
      voice.pitch,
      voice.rate,
      language
    );
    if (ok) return true;
    console.warn(`[Video] ⚠️ Scene ${sceneNumber} Edge-TTS attempt ${attempt}/3 failed.`);
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return false;
}

/**
 * Pre-synthesize every scene's narration before any GPU work starts:
 * English -> Kokoro, then Google Cloud Neural2, then local Edge-TTS.
 */
export async function synthesizeNarration(
  script: VideoScript,
  language: string,
  audioDir: string,
  gcpKey?: string
): Promise<NarrationSynthesis> {
  const gcpAvailable = isGoogleCloudTTSAvailable(gcpKey);
  const gcpVoice = gcpAvailable ? resolveGCPVoice(script.voice, language) : null;
  const edgeVoice = resolveEdgeVoice(script.voice, language, script.domain || "general");

  console.log(
    gcpAvailable
      ? `[Video] 🎙️ Google Cloud Neural2 detected as Tier 1 Priority (${gcpVoice?.name}). Best-to-worst fallback: Tier 1 (Google Cloud Neural2) ➔ Tier 2 (Edge-TTS)...`
      : `[Video] 🎙️ No Google Cloud credentials. Running Tier 1 (Edge-TTS pre-synthesis [${edgeVoice.name}, pitch=${edgeVoice.pitch}, rate=${edgeVoice.rate}])...`
  );

  let gcpSuccessCount = 0;
  let edgeSuccessCount = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const sc = script.scenes[i];
    if (!sc) continue;
    const outMp3 = sceneAudioPath(audioDir, i);
    const isHindi =
      /hindi/i.test(language) ||
      Boolean(script.voice && (/hindi|neural2|madhur|swara/i.test(script.voice) || script.voice.startsWith("hi-")));

    let synthesized = await tryKokoro(sc.narration, outMp3, language, isHindi);

    if (!synthesized && gcpAvailable && gcpVoice) {
      const sanitizedNarration = sanitizeNarrationForTTS(sc.narration, language);
      synthesized = await tryGoogleCloudTTS(sanitizedNarration, outMp3, i + 1, {
        voiceName: gcpVoice.name,
        language,
        speakingRate: script.domain === "sports" ? 1.04 : 1.0,
        gcpKey,
      });
      if (synthesized) {
        gcpSuccessCount++;
      } else {
        console.warn(`[Video] ⚠️ Scene ${i + 1} Google Cloud TTS failed after 2 attempts. Falling back to local Edge-TTS...`);
      }
    }

    if (!synthesized) {
      synthesized = await tryEdgeTTS(sc.narration, outMp3, edgeVoice, language, i + 1);
      if (synthesized) edgeSuccessCount++;
    }

    if (!synthesized) {
      throw new Error(`[Video] Fatal: Audio synthesis failed for scene ${i + 1} after all attempts. Aborting job immediately to prevent launching a GPU kernel on a mute video.`);
    }
  }

  // Strict invariant: every scene must have pre-packaged audio before dataset creation
  for (let i = 0; i < script.scenes.length; i++) {
    const chkMp3 = sceneAudioPath(audioDir, i);
    try {
      const st = await fs.stat(chkMp3);
      if (st.size < MIN_AUDIO_BYTES) {
        throw new Error(`Scene audio ${path.basename(chkMp3)} is too small (${st.size} bytes).`);
      }
    } catch (err: any) {
      throw new Error(`[Video] Fatal: Pre-packaged audio verification failed for scene ${i + 1} (${chkMp3}): ${err.message}. Aborting dispatch to protect Kaggle GPU resources.`);
    }
  }

  return {
    gcpVoiceName: gcpVoice?.name ?? null,
    edgeVoiceName: edgeVoice.name,
    gcpSuccessCount,
    edgeSuccessCount,
  };
}

/** Re-synthesize any missing scene audio for an existing job dataset. */
export async function healMissingNarration(
  script: VideoScript,
  audioDir: string
): Promise<boolean> {
  const gcpAvailable = isGoogleCloudTTSAvailable();
  const gcpVoice = gcpAvailable ? resolveGCPVoice(script.voice, script.language) : null;
  const edgeVoice = resolveEdgeVoice(script.voice, script.language);

  let anySynthesized = false;
  for (let i = 0; i < script.scenes.length; i++) {
    const outMp3 = sceneAudioPath(audioDir, i);
    const stat = await fs.stat(outMp3).catch(() => null);
    if (stat && stat.size >= MIN_AUDIO_BYTES) continue;

    const sc = script.scenes[i];
    if (!sc) continue;

    let ok = false;
    if (gcpAvailable && gcpVoice) {
      ok = await synthesizeGoogleCloudTTS(sc.narration, outMp3, {
        voiceName: gcpVoice.name,
        language: script.language,
      });
    }
    if (!ok) {
      ok = await synthesizeLocalEdgeTTS(sc.narration, outMp3, edgeVoice.name, edgeVoice.pitch);
    }
    if (ok) anySynthesized = true;
  }
  return anySynthesized;
}

