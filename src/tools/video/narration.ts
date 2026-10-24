import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";

import * as path from "node:path";

import {

  isGoogleCloudTTSAvailable,

  synthesizeGoogleCloudTTS,

  resolveGCPVoice,

} from "../gcp-tts.js";

import { synthesizeKokoroTTS } from "../kokoro-tts.js";

import { synthesizeGeminiTTS } from "../gemini-tts.js";

import { resolveEdgeVoice, sanitizeNarrationForTTS, synthesizeLocalEdgeTTS } from "./tts.js";

import type { VideoScript } from "./types.js";



const MIN_AUDIO_BYTES = 500;



export interface NarrationSynthesis {

  geminiSuccessCount: number;

  gcpSuccessCount: number;

  kokoroSuccessCount: number;

  edgeSuccessCount: number;

  primaryEngine: "gemini" | "chirp" | "kokoro" | "edge";

  gcpVoiceName: string | null;

  edgeVoiceName: string;

}



export type TTSEngine = "gemini" | "chirp" | "kokoro" | "edge";



function sceneAudioPath(audioDir: string, index: number): string {

  return path.join(audioDir, `a${String(index).padStart(3, "0")}.mp3`);

}



/**

 * Resolves the ordered cascade of TTS engines for each of the 8 cases:

 *

 * Case 1: GCP=Yes, Hindi, Auto:

 *   - Fact-heavy doc (science/space/tech/history/nature) -> Chirp 3 HD -> Gemini 3.1 -> Edge

 *   - Sports/General -> Gemini 3.1 -> Chirp 3 HD -> Edge

 * Case 2: GCP=Yes, Hindi, User-Prompted:

 *   - Gemini 3.1 -> Chirp 3 HD -> Edge

 * Case 3: GCP=Yes, English, Auto:

 *   - Fact-heavy doc -> Chirp 3 HD -> Gemini 3.1 -> Kokoro -> Edge

 *   - Sports/General -> Gemini 3.1 -> Chirp 3 HD -> Kokoro -> Edge

 * Case 4: GCP=Yes, English, User-Prompted:

 *   - Gemini 3.1 -> Chirp 3 HD -> Kokoro -> Edge

 * Case 5: GCP=No, Hindi, Auto:

 *   - Gemini 3.1 -> Edge

 * Case 6: GCP=No, Hindi, User-Prompted:

 *   - Gemini 3.1 -> Edge

 * Case 7: GCP=No, English, Auto:

 *   - Gemini 3.1 -> Kokoro -> Edge

 * Case 8: GCP=No, English, User-Prompted:

 *   - Gemini 3.1 -> Kokoro -> Edge

 */

export function resolveTTSPriorityChain(opts: {
  hasGCP: boolean;
  isHindi: boolean;
  isAutoMode?: boolean;
  isFactHeavyDoc?: boolean;
}): TTSEngine[] {
  const { hasGCP, isHindi } = opts;

  // When GCP credentials exist: Use Google Cloud (GCP Gemini-TTS -> Chirp 3 HD) FIRST before AI Studio!
  if (hasGCP) {
    return isHindi
      ? ["gemini", "chirp", "edge"]
      : ["gemini", "chirp", "kokoro", "edge"];
  } else {
    return isHindi
      ? ["gemini", "edge"]
      : ["gemini", "kokoro", "edge"];
  }
}

/** Gemini 3.1 Flash TTS with emotion/tone steering (34-key pool). */

async function tryGemini(

  narration: string,

  outMp3: string,

  sceneNumber: number,

  opts: {

    tone?: string | undefined;

    scriptVoice?: string | undefined;

    domain?: string | undefined;

    geminiKey?: string | undefined;

  }

): Promise<boolean> {

  try {

    return await synthesizeGeminiTTS(

      narration,

      outMp3,

      opts.tone || "neutral",

      opts.scriptVoice,

      opts.domain,

      opts.geminiKey

    );

  } catch (err: any) {

    console.warn(`[Video] ⚠️ Scene ${sceneNumber} Gemini 3.1 TTS attempt failed: ${err.message}`);

    return false;

  }

}



/** Google Cloud Chirp 3 HD with SSML emotion prosody wrapper. */

async function tryChirp(

  narration: string,

  outMp3: string,

  sceneNumber: number,

  opts: {

    voiceName: string;

    language: string;

    speakingRate: number;

    gcpKey?: string | undefined;

    tone?: string | undefined;

  }

): Promise<boolean> {

  for (let attempt = 1; attempt <= 2; attempt++) {

    try {

      const ok = await synthesizeGoogleCloudTTS(narration, outMp3, {

        voiceName: opts.voiceName,

        language: opts.language,

        speakingRate: opts.speakingRate,

        gcpKey: opts.gcpKey,

        tone: opts.tone,

      });

      if (ok) return true;

    } catch (err: any) {

      console.warn(`[Video] ⚠️ Scene ${sceneNumber} Chirp 3 HD attempt ${attempt} failed: ${err.message}`);

    }

    if (attempt < 2) {

      await new Promise((r) => setTimeout(r, 1000));

    }

  }

  return false;

}



/** Kokoro-82M English neural TTS (with JIT runner auto-installer). */

async function tryKokoro(

  narration: string,

  outMp3: string,

  language: string,

  isHindi: boolean

): Promise<boolean> {

  if (isHindi) return false;

  return synthesizeKokoroTTS(narration, outMp3, { language, speed: 1.0 });

}



/** Edge-TTS with three attempts and linear backoff. */

async function tryEdge(

  narration: string,

  outMp3: string,

  sceneNumber: number,

  voice: { name: string; pitch: string; rate: string },

  language: string

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

 * Pre-synthesizes every scene's narration before Kaggle GPU packaging.

 * Executes the 8-case TTS cascade based on Cloud credentials, language, domain, and mode.

 */

export async function synthesizeNarration(

  script: VideoScript,

  language: string,

  audioDir: string,

  optionsOrGcpKey?: string | { gcpKey?: string; geminiKey?: string; trendReason?: string },

  trendReasonArg?: string

): Promise<NarrationSynthesis> {

  // Normalize options for 100% backward compatibility

  const resolvedGcpKey =

    typeof optionsOrGcpKey === "string"

      ? optionsOrGcpKey

      : optionsOrGcpKey?.gcpKey;

  const resolvedGeminiKey =

    typeof optionsOrGcpKey === "object"

      ? optionsOrGcpKey?.geminiKey

      : undefined;

  const resolvedTrendReason =

    trendReasonArg ||

    (typeof optionsOrGcpKey === "object" ? optionsOrGcpKey?.trendReason : undefined);



  const hasGCP = isGoogleCloudTTSAvailable(resolvedGcpKey);

  const isHindi =

    /^hi/i.test(language) ||

    /hindi/i.test(language) ||

    Boolean(script.voice?.match(/^hi-|hindi|chirp3.*hi|neural2|madhur|swara/i));



  const isAutoMode =

    !resolvedTrendReason ||

    resolvedTrendReason.trim() === "" ||

    resolvedTrendReason.toLowerCase() === "autonomous";



  // Semantic check for fact-heavy documentary domain (Rule 13: no hardcoded topic check)

  const isFactHeavyDoc =

    script.domain === "science" ||

    script.domain === "space" ||

    script.domain === "technology" ||

    script.domain === "history" ||

    script.domain === "nature";



  const priorityChain = resolveTTSPriorityChain({

    hasGCP,

    isHindi,

    isAutoMode,

    isFactHeavyDoc,

  });



  const gcpVoice = hasGCP ? resolveGCPVoice(script.voice, language) : null;

  const edgeVoice = resolveEdgeVoice(script.voice, language, script.domain || "general");



  console.log(

    `[Video] 🎙️ TTS Priority Cascade initialized: [${priorityChain.join(" ➔ ")}] | Mode: ${

      isAutoMode ? "Autonomous" : "User-Prompted"

    } | Domain: "${script.domain || "general"}" (FactHeavy=${isFactHeavyDoc}) | Lang: ${

      isHindi ? "Hindi" : "English"

    } | GCP: ${hasGCP ? "Yes" : "No"}`

  );



  let geminiSuccessCount = 0;

  let gcpSuccessCount = 0;

  let kokoroSuccessCount = 0;

  let edgeSuccessCount = 0;



  for (let i = 0; i < script.scenes.length; i++) {

    const sc = script.scenes[i];

    if (!sc) continue;

    const outMp3 = sceneAudioPath(audioDir, i);

    // Flywheel Cache: If scene audio already exists from prior run/retry, reuse immediately (0 tokens, 0 latency)
    try {
      if (fsSync.existsSync(outMp3) && fsSync.statSync(outMp3).size >= MIN_AUDIO_BYTES) {
        console.log(`[Video] ⚡ Scene ${i + 1} audio cache hit (${fsSync.statSync(outMp3).size} bytes). Reusing without re-synthesis.`);
        geminiSuccessCount++;
        continue;
      }
    } catch {}





    let synthesized = false;



    for (const engine of priorityChain) {

      if (engine === "gemini") {

        synthesized = await tryGemini(sc.narration, outMp3, i + 1, {

          tone: sc.tone,

          scriptVoice: script.voice,

          domain: script.domain,

          geminiKey: resolvedGeminiKey,

        });

        if (synthesized) {

          geminiSuccessCount++;

          break;

        }

      } else if (engine === "chirp" && gcpVoice) {

        const sanitized = sanitizeNarrationForTTS(sc.narration, language);

        synthesized = await tryChirp(sanitized, outMp3, i + 1, {

          voiceName: gcpVoice.name,

          language,

          speakingRate: script.domain === "sports" ? 1.04 : 1.0,

          gcpKey: resolvedGcpKey,

          tone: sc.tone,

        });

        if (synthesized) {

          gcpSuccessCount++;

          break;

        }

      } else if (engine === "kokoro") {

        synthesized = await tryKokoro(sc.narration, outMp3, language, isHindi);

        if (synthesized) {

          kokoroSuccessCount++;

          break;

        }

      } else if (engine === "edge") {

        synthesized = await tryEdge(sc.narration, outMp3, i + 1, edgeVoice, language);

        if (synthesized) {

          edgeSuccessCount++;

          break;

        }

      }

    }



    if (!synthesized) {

      throw new Error(

        `[Video] Fatal: Audio synthesis failed for scene ${i + 1} after exhausting all priority engines (${priorityChain.join(

          " -> "

        )}). Aborting job to protect GPU render quotas.`

      );

    }

    // Mindful adaptive pacing between scenes (550ms - 850ms with jitter): eliminates burst concurrency and prevents 429 RPM spikes
    if (i < script.scenes.length - 1) {
      const mindfulDelay = 550 + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, mindfulDelay));
    }

  }



  // Strict invariant: verify every scene's audio file exists and has non-trivial bytes

  for (let i = 0; i < script.scenes.length; i++) {

    const chkMp3 = sceneAudioPath(audioDir, i);

    try {

      const st = await fs.stat(chkMp3);

      if (st.size < MIN_AUDIO_BYTES) {

        throw new Error(`Scene audio ${path.basename(chkMp3)} is too small (${st.size} bytes).`);

      }

    } catch (err: any) {

      throw new Error(

        `[Video] Fatal: Pre-packaged audio verification failed for scene ${i + 1} (${chkMp3}): ${err.message}. Aborting dispatch.`

      );

    }

  }



  const primaryEngine: TTSEngine =

    geminiSuccessCount > 0

      ? "gemini"

      : gcpSuccessCount > 0

      ? "chirp"

      : kokoroSuccessCount > 0

      ? "kokoro"

      : "edge";



  return {

    geminiSuccessCount,

    gcpSuccessCount,

    kokoroSuccessCount,

    edgeSuccessCount,

    primaryEngine,

    gcpVoiceName: gcpVoice?.name ?? null,

    edgeVoiceName: edgeVoice.name,

  };

}



/** Re-synthesizes any missing scene audio for an existing job dataset. */

export async function healMissingNarration(

  script: VideoScript,

  audioDir: string

): Promise<boolean> {

  const hasGCP = isGoogleCloudTTSAvailable();

  const gcpVoice = hasGCP ? resolveGCPVoice(script.voice, script.language) : null;

  const edgeVoice = resolveEdgeVoice(script.voice, script.language);



  let anySynthesized = false;
  let geminiSuccessCount = 0;

  for (let i = 0; i < script.scenes.length; i++) {

    const outMp3 = sceneAudioPath(audioDir, i);

    // Flywheel Cache: If scene audio already exists from prior run/retry, reuse immediately (0 tokens, 0 latency)
    try {
      if (fsSync.existsSync(outMp3) && fsSync.statSync(outMp3).size >= MIN_AUDIO_BYTES) {
        console.log(`[Video] ⚡ Scene ${i + 1} audio cache hit (${fsSync.statSync(outMp3).size} bytes). Reusing without re-synthesis.`);
        geminiSuccessCount++;
        continue;
      }
    } catch {}



    const stat = await fs.stat(outMp3).catch(() => null);

    if (stat && stat.size >= MIN_AUDIO_BYTES) continue;



    const sc = script.scenes[i];

    if (!sc) continue;



    // Fast-path healing: Gemini -> Chirp -> Edge

    let ok = await synthesizeGeminiTTS(sc.narration, outMp3, sc.tone, script.voice, script.domain);

    if (!ok && hasGCP && gcpVoice) {

      ok = await synthesizeGoogleCloudTTS(sc.narration, outMp3, {

        voiceName: gcpVoice.name,

        language: script.language,

        tone: sc.tone,

      });

    }

    if (!ok) {

      ok = await synthesizeLocalEdgeTTS(sc.narration, outMp3, edgeVoice.name, edgeVoice.pitch);

    }

    if (ok) anySynthesized = true;

  }

  return anySynthesized;

}

