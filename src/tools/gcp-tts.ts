import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { GoogleAuth } from "google-auth-library";
import * as dotenv from "dotenv";
import { synthesizeGeminiTTS } from "./gemini-tts.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

let cachedAuth: GoogleAuth | null = null;
let cachedProjectId: string | undefined = undefined;
let gcpCloudGeminiCooloffUntil = 0;

/**
 * Attempts to parse a raw JSON string or a base64-encoded JSON string into a Service Account object.
 */
export function parseServiceAccountCredentials(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.client_email && parsed.private_key) {
        return parsed;
      }
      return null;
    }

    // Check if base64-encoded JSON service account
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 64) {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8").trim();
      if (decoded.startsWith("{")) {
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object" && parsed.client_email && parsed.private_key) {
          return parsed;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}


function getAuthClient(): { auth: GoogleAuth; projectId?: string | undefined } | null {
  if (cachedAuth) return { auth: cachedAuth, projectId: cachedProjectId };

  const credsJson = process.env.GCP_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const keyPath = process.env.GCP_SA_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  try {
    if (credsJson) {
      const credentials = typeof credsJson === "string" && credsJson.trim().startsWith("{")
        ? JSON.parse(credsJson)
        : JSON.parse(Buffer.from(credsJson, "base64").toString("utf-8"));
      cachedProjectId = credentials.project_id;
      cachedAuth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      return { auth: cachedAuth, projectId: cachedProjectId };
    }

    if (keyPath && fsSync.existsSync(keyPath)) {
      const fileData = JSON.parse(fsSync.readFileSync(keyPath, "utf-8"));
      cachedProjectId = fileData.project_id;
      cachedAuth = new GoogleAuth({
        keyFilename: keyPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      return { auth: cachedAuth, projectId: cachedProjectId };
    }

    return null;
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
    "You are an authentic Indian sports commentator. Speak with confident, energetic momentum, crisp articulation, and natural broadcast cadence without sudden shouting.",
  suspense:
    "You are an authentic Indian documentary narrator. Speak with focused tension, steady anticipation, and engaging investigative gravitas without dropping vocal volume.",
  dramatic:
    "You are an authentic Indian documentary anchor. Speak with deep gravitas, cinematic weight, and powerful emotional resonance with steady presence.",
  somber:
    "You are an authentic Indian documentary narrator. Speak with gentle reflection, solemn empathy, and natural Indian cadence.",
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
  // Mode A: Service Account OAuth Token (Preferred: supports Vertex AI & Google Cloud Gemini-TTS)
  const customSa = customKey ? parseServiceAccountCredentials(customKey) : null;
  const authInfo = customSa
    ? {
        auth: new GoogleAuth({ credentials: customSa, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }),
        projectId: customSa.project_id as string | undefined,
      }
    : getAuthClient();

  if (authInfo) {
    try {
      const client = await authInfo.auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const accessToken = tokenResponse?.token;
      if (accessToken) {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        };
        if (authInfo.projectId) {
          headers["x-goog-user-project"] = authInfo.projectId;
        }

        const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(25000),
        });

        if (res.status === 429) {
          gcpCloudGeminiCooloffUntil = Date.now() + 45_000;
          console.warn("[GCP TTS] ⚠️ 429 Rate-limit encountered on Google Cloud TTS endpoint. Activating 45s cooloff window.");
        }

        if (res.ok) {
          const data: any = await res.json();
          if (data.audioContent) {
            return Buffer.from(data.audioContent, "base64");
          }
        }
      }
    } catch {
      // Fallback to API Key mode below
    }
  }

  // Mode B: Direct API Key
  const apiKey = (customKey && !customKey.startsWith("{")) ? customKey : (process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY);
  if (apiKey) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429) {
      gcpCloudGeminiCooloffUntil = Date.now() + 45_000;
      console.warn("[GCP TTS] ⚠️ 429 Rate-limit encountered on Google Cloud TTS endpoint (API Key mode). Activating 45s cooloff window.");
    }
    if (res.ok) {
      const data: any = await res.json();
      return data.audioContent ? Buffer.from(data.audioContent, "base64") : null;
    }
  }

  return null;
}

/**
 * Synthesizes speech using Google Cloud Text-to-Speech API.
 * Cascade order for Google Cloud users:
 * 1. Google Cloud Gemini-TTS ("gemini-3.1-flash-tts-preview" with { prompt, text })
 * 2. Google Cloud Chirp 3 HD ("hi-IN-Chirp3-HD-Aoede" / "Fenrir" with SSML)
 * Always Free Tier gives 1,000,000 characters/month free.
 */

/**
 * Splits long text into chunks under Google Cloud TTS's 5000-byte UTF-8 input limit.
 */
export function chunkTextByByteLimit(text: string, maxBytes = 4200): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (Buffer.byteLength(cleaned, "utf-8") <= maxBytes) {
    return [cleaned];
  }

  const sentences = cleaned.split(/(?<=[।.!?;\n])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (Buffer.byteLength(candidate, "utf-8") <= maxBytes) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (Buffer.byteLength(sentence, "utf-8") <= maxBytes) {
        current = sentence;
      } else {
        // Hard split by words if a single sentence exceeds maxBytes
        const words = sentence.split(/\s+/);
        let wordChunk = "";
        for (const w of words) {
          const nextW = wordChunk ? `${wordChunk} ${w}` : w;
          if (Buffer.byteLength(nextW, "utf-8") <= maxBytes) {
            wordChunk = nextW;
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        current = wordChunk;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

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

    let buf: Buffer | null = null;
    if (Date.now() > gcpCloudGeminiCooloffUntil) {
      buf = await callGCPTTS(gcpGeminiPayload, customKey);
    } else {
      const remainingSec = Math.max(1, Math.round((gcpCloudGeminiCooloffUntil - Date.now()) / 1000));
      console.log(`[GCP TTS] ⏱️ Cloud Gemini-TTS in rate-limit cooloff (${remainingSec}s remaining). Directly routing to AI Studio Gemini-TTS pool.`);
    }
    if (buf) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buf);
      console.log(`[GCP TTS] ✅ Synthesized ${buf.length} bytes via Google Cloud Gemini-TTS ("gemini-3.1-flash-tts-preview", voice: ${geminiVoiceName})`);
      return true;
    }

    // Tier 1.5: If Cloud Gemini-TTS is rate-limited (429) or in cooloff, try AI Studio Gemini-TTS (34-key pool) first
    // to preserve unbroken Gemini voice persona (Aoede/Fenrir) across the video with zero wait time.
    try {
      const aiStudioOk = await synthesizeGeminiTTS(
        text,
        outPath,
        options?.tone || "neutral",
        geminiVoiceName,
        undefined
      );
      if (aiStudioOk) {
        return true;
      }
    } catch {
      // AI Studio didn't succeed, proceed to wait/refill check
    }

    // Tier 1.8: Invariant - Wait 45s cooloff window before shifting to Chirp
    // If Cloud Gemini-TTS is currently in cooloff, wait out the remaining time until the 45s window elapses!
    const remainingCooldownMs = gcpCloudGeminiCooloffUntil - Date.now();
    if (remainingCooldownMs > 0) {
      const waitSec = Math.ceil(remainingCooldownMs / 1000);
      console.log(`[GCP TTS] ⏱️ Cloud Gemini-TTS in rate-limit cooloff. Waiting ${waitSec}s for quota to refill before degrading to Chirp...`);
      await new Promise((resolve) => setTimeout(resolve, remainingCooldownMs + 1000));

      // Quota refill retry: try Cloud Gemini-TTS again now that the 45s cooloff has elapsed
      buf = await callGCPTTS(gcpGeminiPayload, customKey);
      if (buf) {
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, buf);
        console.log(`[GCP TTS] ✅ Synthesized ${buf.length} bytes via Google Cloud Gemini-TTS after cooloff refill! ("gemini-3.1-flash-tts-preview", voice: ${geminiVoiceName})`);
        return true;
      }

      // Also retry AI Studio Gemini-TTS pool once after wait
      try {
        const aiStudioRetryOk = await synthesizeGeminiTTS(
          text,
          outPath,
          options?.tone || "neutral",
          geminiVoiceName,
          undefined
        );
        if (aiStudioRetryOk) {
          return true;
        }
      } catch {}
    }

    // Tier 2: ONLY after 45s cooloff wait has elapsed and Cloud Gemini STILL did not refill, shift to Google Cloud Chirp 3 HD
    console.warn(`[GCP TTS] ⚠️ Cloud Gemini-TTS quota did not refill after cooloff wait. Shifting to Google Cloud Chirp 3 HD ("${voiceMeta.name}").`);
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
