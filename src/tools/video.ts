import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const execFileAsync = promisify(execFile);

const JOBS_DIR = path.resolve(process.cwd(), "jobs");
const RENDER_SRC = path.resolve(process.cwd(), "video", "kernel", "render.py");

function kaggleEnv(): NodeJS.ProcessEnv {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
  return {
    ...process.env,
    KAGGLE_USERNAME: user,
    KAGGLE_KEY: key,
    KAGGLE_API_TOKEN: key,
    PATH: `${process.env.PATH}:${path.join(os.homedir(), ".local", "bin")}`,
  };
}

async function kaggle(args: string[], timeout = 120000): Promise<string> {
  const env = kaggleEnv();
  try {
    const { stdout, stderr } = await execFileAsync("kaggle", args, {
      env,
      timeout,
      maxBuffer: 1024 * 1024 * 5,
    });
    return (stdout + (stderr ? `\n${stderr}` : "")).trim();
  } catch (e: any) {
    if (e.code === "ENOENT") {
      try {
        const { stdout, stderr } = await execFileAsync("python", ["-m", "kaggle", ...args], {
          env,
          timeout,
          maxBuffer: 1024 * 1024 * 5,
        });
        return (stdout + (stderr ? `\n${stderr}` : "")).trim();
      } catch (pyErr: any) {
        return `Kaggle CLI Error: ${pyErr.message}\n${pyErr.stderr || ""}`.trim();
      }
    }
    return `Kaggle CLI Error: ${e.message}\n${e.stderr || ""}`.trim();
  }
}

export interface VideoScript {
  title: string;
  description: string;
  tags: string[];
  voice: string;
  language?: string;
  chapters: { title: string; start_scene: number }[];
  scenes: { narration: string; caption?: string; visual_prompt: string }[];
}

/**
 * Parse the comma-separated GEMINI_API_KEY pool and return an array of trimmed keys.
 */
function geminiKeyPool(): string[] {
  const raw = process.env.GEMINI_API_KEY ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Quality-ranked order of Gemini models.
 * For each model, 5-6 keys from the pool are attempted.
 * If all 5-6 keys encounter errors (rate limit, quota, overloaded),
 * quality is degraded to the next model in this order.
 */
export const GEMINI_MODELS_QUALITY_ORDER = [
  "gemini-3.8-flash",        // Latest stable, Best Quality (5 RPM / 20 RPD free)
  "gemini-3.7-flash",        // High capability fallback   (5 RPM / 20 RPD free)
  "gemini-3.6-flash",        // Solid stable fallback      (5 RPM / 20 RPD free)
  "gemini-3.5-flash",        // Widely available           (10 RPM / 20 RPD free)
  "gemini-3-flash-preview",  // AI Studio Flash Preview    (5 RPM / 20 RPD free)
  "gemini-3.5-flash-lite",   // High-throughput Lite       (30 RPM / 1500 RPD free)
  "gemini-3.1-flash-lite",   // Last-resort Ultra-Lite     (30 RPM / 1500 RPD free)
];

const KEYS_PER_MODEL_ATTEMPT = 6;

/**
 * Select a slice of `count` keys starting at a random offset to distribute load evenly.
 */
function pickKeySubset(pool: string[], count: number): string[] {
  if (pool.length <= count) return [...pool];
  const start = Math.floor(Math.random() * pool.length);
  const subset: string[] = [];
  for (let i = 0; i < count; i++) {
    const k = pool[(start + i) % pool.length];
    if (k) subset.push(k);
  }
  return subset;
}

/**
 * Call Gemini generateContent with 5-6 key retries per model,
 * degrading to the next model in GEMINI_MODELS_QUALITY_ORDER only if all keys fail.
 */
export async function geminiGenerate(prompt: string, preferredModel?: string): Promise<{ text: string; modelUsed: string }> {
  const pool = geminiKeyPool();
  if (!pool.length) throw new Error("GEMINI_API_KEY pool is empty");

  // Determine model hierarchy: preferred model first if specified, followed by the rest
  const modelsToTry = preferredModel
    ? [preferredModel, ...GEMINI_MODELS_QUALITY_ORDER.filter((m) => m !== preferredModel)]
    : GEMINI_MODELS_QUALITY_ORDER;

  let globalLastErr = "";

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    const candidateKeys = pickKeySubset(pool, Math.min(KEYS_PER_MODEL_ATTEMPT, pool.length));
    console.log(`[Video] Trying model [${mIdx + 1}/${modelsToTry.length}]: "${model}" with ${candidateKeys.length} keys...`);

    for (let kIdx = 0; kIdx < candidateKeys.length; kIdx++) {
      const key = candidateKeys[kIdx];
      if (!key) continue;
      const keySuffix = key.slice(-6);

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.8,
                maxOutputTokens: 32768,
              },
            }),
            signal: AbortSignal.timeout(180000),
          }
        );

        if (res.ok) {
          const data: any = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
          if (text) {
            console.log(`[Video] Success with model: "${model}" on key ...${keySuffix}`);
            return { text, modelUsed: model ?? "unknown" };
          }
        }

        const body = await res.text();
        const errMsg = `Status ${res.status}: ${body.slice(0, 180)}`;
        globalLastErr = `Model ${model} (key ...${keySuffix}) -> ${errMsg}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] failed for ${model}: ${errMsg}`);

        // If model is 404 (does not exist / deprecated), do not waste other keys on this model
        if (res.status === 404) {
          console.warn(`[Video] Model "${model}" returned 404. Skipping remaining keys for this model.`);
          break;
        }

        // Small pause between key retries
        await new Promise((r) => setTimeout(r, 400));
      } catch (err: any) {
        globalLastErr = `Model ${model} (key ...${keySuffix}) error: ${err.message}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] network error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    if (mIdx < modelsToTry.length - 1) {
      console.warn(`[Video] ⚠️ Model "${model}" failed across keys. Degrading quality to next model: "${modelsToTry[mIdx + 1]}"...`);
    }
  }

  // Cross-provider backup: if all Gemini models failed, fallback to Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    console.warn(`[Video] ⚠️ Attempting cross-provider fallback to Groq (openai/gpt-oss-120b, qwen/qwen3.8-27b)...`);
    const groqModels = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
    for (const gModel of groqModels) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: gModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const data: any = await res.json();
          const text = data?.choices?.[0]?.message?.content ?? "";
          if (text) {
            console.log(`[Video] Success with Groq fallback model: "${gModel}"`);
            return { text, modelUsed: `groq:${gModel}` };
          }
        }
      } catch (err: any) {
        console.warn(`[Video] Groq fallback ${gModel} failed: ${err.message}`);
      }
    }
  }

  throw new Error(`All models in GEMINI_MODELS_QUALITY_ORDER and Groq fallback failed. Last error: ${globalLastErr}`);
}

/**
 * Stage 1-2: Brainstorm-to-script using the Gemini key pool and quality degradation.
 */
export async function generateScript(topic: string, minutes = 5, language = "English"): Promise<VideoScript> {
  const preferredModel = process.env.GEMINI_MODEL;
  const targetWords = Math.round(minutes * 150);
  const sceneCount = Math.round(targetWords / 16);
  const voice = /hindi/i.test(language) ? "hi-IN-MadhurNeural" : "en-US-AndrewNeural";

  const prompt = `You are an elite documentary filmmaker and YouTube director (Vox, National Geographic, BBC Earth style).
Write a gripping, 100% factual, highly engaging video script with hard synchronization between spoken narration and cinematic footage.

Topic: ${topic}
Language: ${language}
Target Length: about ${targetWords} spoken words (${minutes} minutes) divided into about ${sceneCount} tightly-paced scenes (12-20 words each).

CRITICAL DIRECTIVES:
1. SCRIPT & SCRIPT-LANGUAGE RULES (MANDATORY - OPTION A HYBRID FORMULA):
   - TITLE (THE HYBRID FORMULA): Must be strictly in English (Roman) alphabet. Format: "[English Topic Keyword] : [Hinglish Curiosity Question/Hook]".
     Example: "Aadhaar Super-Engine : 140 Crore Logo Ka Data Kaise Safe Rehta Hai?"
     Example: "James Webb Telescope : Space Mein Scientists Ko Kya Ajeeb Mila?"
     Example: "Semiconductor Fab : India Mein Microchips Banana Itna Mushkil Kyu Hai?"
     NEVER use Devanagari script. Maximum 70 characters.
   - DESCRIPTION (PURE ENGLISH): Must be written in 100% PURE ENGLISH (English language & Roman letters). Include detailed SEO overview, key technical keywords, and timestamps/chapters. No Devanagari script.
   - CHAPTER TITLES & TAGS: Must be strictly in English (Roman) alphabet.
   - NARRATION (Spoken Audio): Natural, engaging Hindi dialogue spoken by voice hi-IN-MadhurNeural.
   - CAPTIONS (On-Screen Subtitles): Must be in 100% PURE ENGLISH (both English letters AND English language words). For every single scene, provide the exact English translation in "caption" to be displayed on-screen.
2. Visual Prompt Engineering for True Continuous Video:
   - For EVERY scene, write a "visual_prompt" that describes a real, continuous cinematic video shot — NOT a static photo or generic concept.
   - Specify:
     a) Camera movement & lens: e.g. "Slow cinematic dolly-in shot on ARRI Alexa Mini LF, 35mm anamorphic lens, shallow depth of field, 24fps" or "Steadicam low-angle tracking shot", "Macro telephoto rack-focus".
     b) Physical dynamic action matching the narration: e.g. if the narration discusses a cyber heist, show "A dimly lit cybersecurity operations center with glowing curved telemetry monitors, analysts in focus typing rapidly, camera slowly pushing through server racks".
     c) Modern Digital Lighting & Clarity: "Crisp natural 4K digital cinematography, modern high-end documentary lighting, vivid realistic colors, sharp clean focus, absolutely NO vintage/retro/sepia/8mm/grainy aesthetics."
     d) Realism enforcement: Clean, authentic physical textures (modern architectural glass, polished materials, real skin, crisp telemetry). Avoid retro filters, heavy grain, sepia tones, plastic CGI, or still-photo aesthetics.
3. Return ONLY valid JSON in this exact structure:
{
  "title": "<Hybrid Title: [English Topic] : [Hinglish Curiosity Hook], Roman alphabet only, <=70 chars, NO Devanagari>",
  "description": "<Comprehensive Pure English SEO description, 150-250 words with timestamps & keywords, NO Devanagari>",
  "tags": ["<8-15 high volume relevant tags in English alphabet>"],
  "chapters": [{"title": "<Chapter Title in English>", "start_scene": 0}],
  "scenes": [
    {
      "narration": "<Exact words spoken in Hindi by voice hi-IN-MadhurNeural>",
      "caption": "<Exact English translation in pure English language and Roman alphabet for on-screen subtitles>",
      "visual_prompt": "<Ultra-detailed cinematic video prompt in English: camera move, lens, subject action matching narration, lighting, natural atmosphere>"
    }
  ]
}`;

  const pool = geminiKeyPool();
  const { text, modelUsed } = await geminiGenerate(prompt, preferredModel);

  if (!text) throw new Error("Gemini returned empty content");
  let script: VideoScript;
  try {
    script = JSON.parse(text) as VideoScript;
  } catch {
    // Sometimes the model wraps JSON in a code fence — strip it
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      script = JSON.parse(match[1]) as VideoScript;
    } else {
      throw new Error(`Gemini response is not valid JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!script.scenes?.length) throw new Error("Gemini returned a script with no scenes");
  script.voice = voice;
  script.language = language;
  console.log(`[Video] Script generated with model "${modelUsed}" via Gemini key pool (${pool.length} keys). Title: ${script.title}`);
  return script;
}

/**
 * Stage 3: package script + renderer and launch it on a Kaggle GPU kernel.
 */
export async function startVideoJob(topic: string, minutes = 5, language = "English"): Promise<string> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const script = await generateScript(topic, minutes, language);
  const id = Date.now().toString(36);
  const jobDir = path.join(JOBS_DIR, id);
  const dsDir = path.join(jobDir, "dataset");
  const kDir = path.join(jobDir, "kernel");
  await fs.mkdir(dsDir, { recursive: true });
  await fs.mkdir(kDir, { recursive: true });

  await fs.writeFile(path.join(dsDir, "script.json"), JSON.stringify(script, null, 2));
  await fs.writeFile(
    path.join(dsDir, "dataset-metadata.json"),
    JSON.stringify({
      title: `video job ${id}`,
      id: `${user}/video-job-${id}`,
      licenses: [{ name: "CC0-1.0" }],
      is_private: true,
    })
  );
  await fs.writeFile(
    path.join(dsDir, "config.json"),
    JSON.stringify({
      groq_api_key: process.env.GROQ_API_KEY || "",
      hf_token: process.env.HF_TOKEN || "",
    }, null, 2)
  );
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));
  await fs.writeFile(
    path.join(kDir, "kernel-metadata.json"),
    JSON.stringify({
      id: `${user}/video-render-${id}`,
      title: `video render ${id}`,
      code_file: "render.py",
      language: "python",
      kernel_type: "script",
      is_private: true,
      enable_gpu: true,
      enable_internet: true,
      dataset_sources: [`${user}/video-job-${id}`],
    })
  );

  const ds = await kaggle(["datasets", "create", "-p", dsDir]);
  // dataset processing takes a few seconds before a kernel can mount it
  await new Promise((r) => setTimeout(r, 20000));
  const push = await kaggle(["kernels", "push", "-p", kDir]);

  return JSON.stringify(
    {
      jobId: id,
      kernel: `${user}/video-render-${id}`,
      title: script.title,
      scenes: script.scenes.length,
      dataset: ds.slice(0, 200),
      push: push.slice(0, 300),
      next: "Use manage_kaggle action=status ref=<kernel> to observe; action=output to download video.mp4",
    },
    null,
    2
  );
}

/**
 * Observe Kaggle training / rendering kernels.
 */
export async function manageKaggle(action: "list" | "status" | "output", ref?: string): Promise<string> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (action === "list") return await kaggle(["kernels", "list", "--mine", "--page-size", "15"]);
  if (!ref) return "Error: 'ref' (owner/kernel-slug) is required for status/output.";
  const full = ref.includes("/") ? ref : `${user}/${ref}`;
  if (action === "status") return await kaggle(["kernels", "status", full]);

  // output: download files + execution log
  const slug = full.split("/")[1] ?? full;
  const dest = path.join(JOBS_DIR, slug.replace(/^video-render-/, ""), "output");
  await fs.mkdir(dest, { recursive: true });
  const out = await kaggle(["kernels", "output", full, "-p", dest], 600000);
  const files = await fs.readdir(dest).catch(() => [] as string[]);
  let logTail = "";
  const logFile = files.find((f) => f.endsWith(".log"));
  if (logFile) {
    const raw = await fs.readFile(path.join(dest, logFile), "utf-8");
    logTail = raw.slice(-1500);
  }
  return `${out}\nFiles in ${dest}: ${files.join(", ") || "(none yet)"}\n--- log tail ---\n${logTail}`;
}

import { uploadToYouTube } from "./youtube.js";
import * as fsSync from "node:fs";

/**
 * Automatically publishes a rendered video job to YouTube with private visibility.
 */
export async function publishJobToYouTube(jobDirOrId: string, privacy: "private" | "unlisted" | "public" = "private"): Promise<string> {
  const directPath = path.resolve(process.cwd(), jobDirOrId);
  const targetDir = fsSync.existsSync(directPath)
    ? directPath
    : path.join(JOBS_DIR, jobDirOrId, "output");

  const videoPath = path.join(targetDir, "video.mp4");
  const metaPath = path.join(targetDir, "meta.json");
  const thumbnailPath = ["frame_30s.jpg", "frame_15s.jpg", "frame_03s.jpg", "frame_45s.jpg"]
    .map((f) => path.join(targetDir, f))
    .find((f) => fsSync.existsSync(f));

  if (!fsSync.existsSync(videoPath)) {
    return `Error: video.mp4 not found in ${targetDir}`;
  }

  const result = await uploadToYouTube({
    videoPath,
    metaPath,
    thumbnailPath,
    privacyStatus: privacy,
  });

  return JSON.stringify(result, null, 2);
}
