import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { GoogleAuth } from "google-auth-library";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

let cachedAuth: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth | null {
  if (cachedAuth) return cachedAuth;

  const credsJson = process.env.GCP_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const keyPath = process.env.GCP_SA_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  try {
    if (credsJson) {
      const credentials = typeof credsJson === "string" && credsJson.trim().startsWith("{")
        ? JSON.parse(credsJson)
        : JSON.parse(Buffer.from(credsJson, "base64").toString("utf-8"));
      cachedAuth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      return cachedAuth;
    }

    if (keyPath && fsSync.existsSync(keyPath)) {
      cachedAuth = new GoogleAuth({
        keyFilename: keyPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      return cachedAuth;
    }

    cachedAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    return cachedAuth;
  } catch (err: any) {
    console.warn(`[GCP TTS] Warning: Could not initialize GoogleAuth: ${err.message}`);
    return null;
  }
}

/**
 * Checks if Google Cloud Text-to-Speech credentials exist in the environment or custom override.
 */
export function isGoogleCloudTTSAvailable(customKey?: string): boolean {
  if (customKey && customKey.trim().length > 0) return true;
  const apiKey = process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY;
  const credsJson = process.env.GCP_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const keyPath = process.env.GCP_SA_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return Boolean(apiKey || credsJson || (keyPath && fsSync.existsSync(keyPath)));
}

/**
 * Curated Google Cloud Text-to-Speech Neural2 / Chirp 3 HD voices (Always Free Tier: 1M chars/mo).
 */
export const GCP_TTS_VOICES = {
  // Google Cloud Chirp 3 HD Generative Foundation Voices (Always Free Tier: 1M chars/mo)
  hindi_male: "hi-IN-Chirp3-HD-Fenrir",        // Dynamic male narrator (Sports/Action)
  hindi_male_doc: "hi-IN-Chirp3-HD-Alnilam",    // Deep authoritative documentary anchor
  hindi_female: "hi-IN-Chirp3-HD-Aoede",        // Articulate television documentary anchor
  hindi_female_soft: "hi-IN-Chirp3-HD-Despina", // Measured, warm narrative voice
  english_in_male: "en-IN-Chirp3-HD-Fenrir",    // Natural Indian English documentary narrator
  english_in_female: "en-IN-Chirp3-HD-Aoede",   // Natural Indian English documentary anchor
  english_us_male: "en-US-Chirp3-HD-Fenrir",    // Classic US documentary narrator
  english_us_female: "en-US-Chirp3-HD-Aoede",   // Modern US journalistic anchor
  // Legacy Neural2 Fallbacks
  legacy_hindi_male: "hi-IN-Neural2-B",
  legacy_hindi_doc: "hi-IN-Neural2-C",
};

/**
 * Maps a generic voice name or language to a top-tier Google Cloud Chirp 3 HD voice.
 */
export function resolveGCPVoice(requestedVoice?: string, language = "Hindi"): { name: string; languageCode: string } {
  if (requestedVoice && (requestedVoice.startsWith("hi-IN-Chirp3-HD-") || requestedVoice.startsWith("en-IN-Chirp3-HD-") || requestedVoice.startsWith("en-US-Chirp3-HD-"))) {
    return { name: requestedVoice, languageCode: requestedVoice.slice(0, 5) };
  }
  if (requestedVoice && requestedVoice.startsWith("hi-IN-Neural2-")) {
    return { name: requestedVoice, languageCode: "hi-IN" };
  }
  if (requestedVoice && requestedVoice.startsWith("en-IN-Neural2-")) {
    return { name: requestedVoice, languageCode: "en-IN" };
  }
  if (requestedVoice && requestedVoice.startsWith("en-US-Neural2-")) {
    return { name: requestedVoice, languageCode: "en-US" };
  }

  const isHindi =
    /hindi/i.test(language) ||
    Boolean(requestedVoice && (/hindi/i.test(requestedVoice) || requestedVoice.toLowerCase().startsWith("hi-")));
  if (isHindi) {
    if (requestedVoice && (requestedVoice.toLowerCase().includes("female") || requestedVoice.toLowerCase().includes("swara") || requestedVoice.toLowerCase().includes("aoede"))) {
      return { name: GCP_TTS_VOICES.hindi_female, languageCode: "hi-IN" };
    }
    return { name: GCP_TTS_VOICES.hindi_male, languageCode: "hi-IN" };
  }

  if (requestedVoice && (requestedVoice.toLowerCase().includes("female") || requestedVoice.toLowerCase().includes("neerja") || requestedVoice.toLowerCase().includes("aoede"))) {
    return { name: GCP_TTS_VOICES.english_in_female, languageCode: "en-IN" };
  }

  return { name: GCP_TTS_VOICES.english_in_male, languageCode: "en-IN" };
}

// ---------------------------------------------------------------------------
// Google Cloud Gemini-TTS Style Prompts
// ---------------------------------------------------------------------------

const GCP_GEMINI_STYLE_PROMPTS: Record<string, string> = {
  excited:
    "You are an authentic Indian sports commentator. Speak with intense rising excitement, breathless energy, and natural Indian cadence.",
  suspense:
    "You are an authentic Indian documentary narrator. Speak with slow, suspenseful pacing, deliberate dramatic pauses, and deep investigative gravitas.",
  dramatic:
    "You are an authentic Indian documentary anchor. Speak with deep gravitas, cinematic weight, and powerful emotional resonance.",
  somber:
    "You are an authentic Indian documentary narrator. Speak softly, solemnly, and respectfully with a reflective Indian documentary tone.",
  neutral:
    "You are an authentic Indian documentary anchor. Speak with natural Indian cadence, clear articulation, and engaging warmth.",
};

// ---------------------------------------------------------------------------
// SSML Tone Wrapper for Chirp 3 HD Emotion (Natural Pitch, Anti-Robotic)
// ---------------------------------------------------------------------------

/**
 * Wraps narration text in SSML prosody tags matching the scene emotional tone.
 * Pitch calibrated to +0st on excited to avoid robotic chipmunk artifacts.
 */
export function buildSSMLWithTone(text: string, tone: string): string | undefined {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  switch (tone) {
    case "excited":
      return `<speak><prosody rate="106%" pitch="+0st">${escaped}</prosody></speak>`;
    case "suspense":
      return `<speak><break time="300ms"/><prosody rate="95%">${escaped}</prosody></speak>`;
    case "dramatic":
      return `<speak><prosody rate="96%" volume="+1dB">${escaped}</prosody></speak>`;
    case "somber":
      return `<speak><prosody rate="90%" pitch="-1st" volume="-1dB">${escaped}</prosody></speak>`;
    default:
      return undefined; // neutral: plain text, no SSML
  }
}

async function callGCPTTS(payload: any, customKey: string | undefined): Promise<Buffer | null> {
  // Mode A: Direct API Key
  if (customKey && !customKey.startsWith("{")) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(customKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.audioContent ? Buffer.from(data.audioContent, "base64") : null;
  }

  // Mode B: Service Account OAuth Token
  const auth = customKey && customKey.startsWith("{")
    ? new GoogleAuth({
        credentials: JSON.parse(customKey),
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      })
    : getAuthClient();

  if (!auth) return null;
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse?.token;
  if (!accessToken) return null;

  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  return data.audioContent ? Buffer.from(data.audioContent, "base64") : null;
}

/**
 * Synthesizes speech using Google Cloud Text-to-Speech API.
 * Cascade order for Google Cloud users:
 * 1. Google Cloud Gemini-TTS ("gemini-3.1-flash-tts-preview" with { prompt, text })
 * 2. Google Cloud Chirp 3 HD ("hi-IN-Chirp3-HD-Aoede" / "Fenrir" with SSML)
 * Always Free Tier gives 1,000,000 characters/month free.
 */
export async function synthesizeGoogleCloudTTS(
  text: string,
  outPath: string,
  options?: {
    voiceName?: string | undefined;
    language?: string | undefined;
    speakingRate?: number | undefined;
    gcpKey?: string | undefined;
    tone?: string | undefined;
  }
): Promise<boolean> {
  const customKey = options?.gcpKey?.trim() || process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY;
  const voiceMeta = resolveGCPVoice(options?.voiceName, options?.language);
  const speakingRate = options?.speakingRate ?? 1.0;
  const stylePrompt = GCP_GEMINI_STYLE_PROMPTS[options?.tone ?? "neutral"] ?? GCP_GEMINI_STYLE_PROMPTS["neutral"]!;
  const geminiVoiceName = /fenrir/i.test(voiceMeta.name) ? "Fenrir" : "Aoede";

  try {
    // Tier 1: Try Google Cloud Gemini-TTS with official { prompt, text } separation
    const gcpGeminiPayload = {
      input: {
        prompt: stylePrompt,
        text: text,
      },
      voice: {
        languageCode: voiceMeta.languageCode,
        name: geminiVoiceName,
        model_name: "gemini-3.1-flash-tts-preview",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        sampleRateHertz: 44100,
      },
    };

    let buf = await callGCPTTS(gcpGeminiPayload, customKey);
    if (buf) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buf);
      console.log(`[GCP TTS] ✅ Synthesized ${buf.length} bytes via Google Cloud Gemini-TTS ("gemini-3.1-flash-tts-preview", voice: ${geminiVoiceName})`);
      return true;
    }

    // Tier 2: Cascade to Google Cloud Chirp 3 HD with SSML prosody
    const ssml = options?.tone ? buildSSMLWithTone(text, options.tone) : undefined;
    const chirpPayload = {
      input: ssml ? { ssml } : { text },
      voice: {
        languageCode: voiceMeta.languageCode,
        name: voiceMeta.name,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        sampleRateHertz: 44100,
      },
    };

    buf = await callGCPTTS(chirpPayload, customKey);
    if (buf) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buf);
      console.log(`[GCP TTS] ✅ Synthesized ${buf.length} bytes via Google Cloud Chirp 3 HD ("${voiceMeta.name}")`);
      return true;
    }
  } catch (err: any) {
    console.warn(`[GCP TTS] Synthesis error: ${err.message}`);
  }

  return false;
}

export {
  synthesizeKokoroTTS,
  isKokoroAvailable,
  synthesizeEdgeTTS,
  synthesizeUnifiedSpeech,
  KOKORO_CURATED_VOICES,
} from "./kokoro-tts.js";
