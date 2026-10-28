import * as fs from "node:fs/promises";
import * as path from "node:path";
import { kaggle } from "./kaggle.js";
import { generateScript } from "./script.js";
import { healMissingNarration, synthesizeNarration } from "./narration.js";
import { generateSceneKeyframes } from "./keyframes.js";
import { isSportsOrCricket } from "./domain.js";
import { resolveAndDownloadCloudBgm, searchAndDownloadSFX } from "./dynamicSound.js";
import { verifyPreFlightDataset } from "./preflight.js";
import type { KaggleAction, VideoScript } from "./types.js";

const JOBS_DIR = path.resolve(process.cwd(), "jobs");
const RENDER_SRC = path.resolve(process.cwd(), "video", "kernel", "render.py");
const DATASET_SETTLE_MS = 20000;
const OUTPUT_TIMEOUT_MS = 600000;
const LOG_TAIL_CHARS = 1500;

function kaggleUser(): string {
  return process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
}

async function writeJsonFile(filePath: string, value: unknown, mode?: number): Promise<void> {
  const payload = JSON.stringify(value, null, 2);
  if (mode !== undefined) {
    await fs.writeFile(filePath, payload, { mode });
    return;
  }
  await fs.writeFile(filePath, payload);
}

function sanitizeTitleForSlug(title?: string): string {
  if (!title) return "";
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/, "");
  return cleaned ? `-${cleaned}` : "";
}

/**
 * Smart Kaggle Dataset Readiness Poller (replaces blind 20s sleep).
 * Polls `kaggle datasets status <ref>` every 2 seconds until "ready",
 * cutting job dispatch wait by ~12-16 seconds.
 */
export async function waitForDatasetReady(
  datasetRef: string,
  maxWaitMs = 30000,
  pollIntervalMs = 2000
): Promise<boolean> {
  const start = Date.now();
  console.log(`[Video] ⏳ Smart polling Kaggle dataset readiness for "[REDACTED]"...`);
  while (Date.now() - start < maxWaitMs) {
    try {
      const statusRes = await kaggle(["datasets", "status", datasetRef]);
      if (statusRes.toLowerCase().includes("ready")) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[Video] ⚡ Dataset "[REDACTED]" ready in ${elapsed}s (saved ~${Math.max(0, 20 - Number(elapsed))}s)!`);
        return true;
      }
    } catch {
      // transient poll error, keep waiting
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  console.warn(`[Video] Dataset poll reached timeout (${maxWaitMs / 1000}s); proceeding with kernel push.`);
  return false;
}

function datasetMetadata(user: string, id: string, title?: string) {
  const displayTitle = title ? `Video Job: ${title.slice(0, 45)}` : `video job ${id}`;
  const slug = `${id}${sanitizeTitleForSlug(title)}`;
  return {
    title: displayTitle,
    id: `${user}/video-job-${slug}`,
    licenses: [{ name: "CC0-1.0" }],
    is_private: true,
  };
}

function kernelMetadata(user: string, id: string, title?: string) {
  const displayTitle = title ? `Video Render: ${title.slice(0, 45)}` : `video render ${id}`;
  const slug = `${id}${sanitizeTitleForSlug(title)}`;
  return {
    id: `${user}/video-render-${slug}`,
    title: displayTitle,
    code_file: "render.py",
    language: "python",
    kernel_type: "script",
    is_private: true,
    enable_gpu: true,
    enable_internet: true,
    dataset_sources: [`${user}/video-job-${slug}`],
  };
}

function runtimeConfig(gcpKey?: string) {
  return {
    hf_token: process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || (process.env.KAGGLE_BUNDLE_HF_TOKEN === "true" ? (process.env.HF_TOKEN || "") : ""),
    gcp_tts_key: process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY || gcpKey || "",
  };
}

/**
 * Stage 3: package script + renderer and launch it on a Kaggle GPU kernel.
 */
export async function startVideoJob(
  topic: string,
  minutes = 5,
  language = "English",
  trendReason?: string,
  options?: { gcpKey?: string }
): Promise<string> {
  const user = kaggleUser();
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const script = await generateScript(topic, minutes, language, trendReason);
  const id = Date.now().toString(36);
  const jobDir = path.join(JOBS_DIR, id);
  const dsDir = path.join(jobDir, "dataset");
  const kDir = path.join(jobDir, "kernel");
  const audioDir = path.join(dsDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(kDir, { recursive: true });

  const narration = await synthesizeNarration(script, language, audioDir, options?.gcpKey, trendReason);

  const parts: string[] = [];
  const isSports = script.domain === "sports" || isSportsOrCricket(script.title);
  const geminiPersona = isSports ? "Fenrir" : "Aoede";
  if (narration.geminiSuccessCount > 0) parts.push(`${narration.geminiSuccessCount} via Gemini-TTS (${geminiPersona})`);
  if (narration.gcpSuccessCount > 0 && narration.gcpVoiceName) {

    parts.push(`${narration.gcpSuccessCount} via Chirp 3 HD (${narration.gcpVoiceName})`);
  }
  if (narration.kokoroSuccessCount > 0) parts.push(`${narration.kokoroSuccessCount} via Kokoro-82M`);
  if (narration.edgeSuccessCount > 0) {
    if (!narration.gcpSuccessCount && !narration.geminiSuccessCount) script.voice = narration.edgeVoiceName;
    parts.push(`${narration.edgeSuccessCount} via Edge-TTS`);
  }
  const summaryStr = parts.join(", ");
  script.audio_summary = summaryStr;

  if (narration.geminiSuccessCount > 0 && narration.gcpSuccessCount === 0) {
    script.voice = `Gemini-TTS (${geminiPersona})`;
  } else if (narration.geminiSuccessCount > 0 && narration.gcpSuccessCount > 0) {
    script.voice = `Gemini-TTS (${narration.geminiSuccessCount}) + Chirp 3 HD (${narration.gcpSuccessCount})`;
  } else if (narration.gcpSuccessCount > 0 && narration.gcpVoiceName) {
    script.voice = narration.gcpVoiceName;
  } else if (narration.edgeSuccessCount > 0) {
    script.voice = narration.edgeVoiceName;
  }

  console.log(`[Video] ✅ Audio synthesis complete (${script.scenes.length} scenes): ${summaryStr}`);

  // Stage 1 (Tarika 2): Pre-package keyframes via Cloudflare Workers AI FLUX.1-schnell
  const imagesDir = path.join(dsDir, "images");
  await fs.mkdir(imagesDir, { recursive: true });
  const keyframes = await generateSceneKeyframes(script, imagesDir);
  script.keyframes_summary = `${keyframes.successCount}/${keyframes.totalScenes} via ${keyframes.modelUsed}`;
  console.log(`[Video] 🎨 Keyframe packaging complete: ${script.keyframes_summary}`);

  // Stage 1.5: Stream domain BGM directly into dataset/audio (Zero Laptop Storage)
  const soundscape =
    (script as any).visual_bible?.soundscapeProfile ||
    (script as any).visual_bible?.soundscape_profile ||
    (script as any).soundscape_profile ||
    (script as any).soundscapeProfile ||
    {};
  const requestedBgm =
    soundscape.bgmGenre ||
    (isSports ? "epic_orchestral" : "uplifting_documentary");
  await resolveAndDownloadCloudBgm(requestedBgm, audioDir);

  // Stage 1.6: Stream dynamic SFX moments directly into dataset/audio
  const sfxMoments: Array<{ sceneHint?: string; sfx?: string; sfxQuery?: string }> =
    soundscape.keySFXMoments ||
    (script as any).keySFXMoments ||
    [];
  if (Array.isArray(sfxMoments) && sfxMoments.length > 0) {
    for (const moment of sfxMoments) {
      const q = moment.sfx || moment.sfxQuery;
      if (q) {
        await searchAndDownloadSFX(q, audioDir);
      }
    }
  }

  // Stage 1.7: Write dataset and kernel metadata before pre-flight gate
  const slug = `${id}${sanitizeTitleForSlug(script.title)}`;
  await writeJsonFile(path.join(dsDir, "script.json"), script);
  await writeJsonFile(path.join(dsDir, "dataset-metadata.json"), datasetMetadata(user, id, script.title));
  await writeJsonFile(path.join(dsDir, "config.json"), runtimeConfig(options?.gcpKey), 0o600);
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));
  await writeJsonFile(path.join(kDir, "kernel-metadata.json"), kernelMetadata(user, id, script.title));

  // Stage 2: Enforce Non-Bypassable Pre-Flight Verification Gate
  console.log(`[Video] 🛡️ [Pre-Flight Gate] Validating all dataset assets before Kaggle dispatch...`);
  const preflight = await verifyPreFlightDataset(dsDir, script.scenes.length, {
    requireAudio: true,
    requireKeyframes: true,
    requireBgm: true,
    minAudioBytes: 500,
    minImageBytes: 5000,
  });

  if (!preflight.ok) {
    const errorDetails = preflight.errors.slice(0, 10).join("\n - ");
    console.error(`❌ [Pre-Flight Gate Abort] ${preflight.errors.length} assets failed verification:\n - ${errorDetails}`);
    throw new Error(
      `[Pre-Flight Verification Gate Abort] Dataset validation failed: ` +
      `${preflight.audioCount}/${script.scenes.length} audio, ` +
      `${preflight.keyframeCount}/${script.scenes.length} keyframes, ` +
      `BGM: ${preflight.hasBgm ? "OK" : "MISSING"}. ` +
      `Refusing to dispatch broken/empty dataset to Kaggle GPU.\n - ${errorDetails}`
    );
  }
  console.log(`[Video] 🛡️ [Pre-Flight Verified] 100% assets verified: ${preflight.audioCount} audio, ${preflight.keyframeCount} keyframes, BGM: OK.`);

  const ds = await kaggle(["datasets", "create", "-p", dsDir, "--dir-mode", "zip"]);
  // Smart polling for Kaggle dataset readiness (instant mount as soon as ready)
  await waitForDatasetReady(`${user}/video-job-${slug}`, 30000, 2000);
  const push = await kaggle(["kernels", "push", "-p", kDir]);

  return JSON.stringify(
    {
      jobId: slug,
      kernel: `${user}/video-render-${slug}`,
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

/** Re-synthesize missing audio, then push the latest renderer to an existing job. */
async function syncJobAudio(dsDir: string): Promise<void> {
  try {
    const scriptFile = path.join(dsDir, "script.json");
    const scriptExists = await fs.stat(scriptFile).then(() => true).catch(() => false);
    if (!scriptExists) return;

    const script = JSON.parse(await fs.readFile(scriptFile, "utf-8")) as VideoScript;
    const audioDir = path.join(dsDir, "audio");
    await fs.mkdir(audioDir, { recursive: true });

    let dsUpdated = false;
    if (await healMissingNarration(script, audioDir)) {
      dsUpdated = true;
    }
    const imagesDir = path.join(dsDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });
    const keyframes = await generateSceneKeyframes(script, imagesDir);
    if (keyframes.successCount > 0) {
      script.keyframes_summary = `${keyframes.successCount}/${keyframes.totalScenes} via ${keyframes.modelUsed}`;
      await writeJsonFile(scriptFile, script);
      dsUpdated = true;
    }
    if (dsUpdated) {
      await kaggle(["datasets", "version", "-p", dsDir, "-m", "Auto-heal audio sync", "--dir-mode", "zip"]);
    }
  } catch (syncErr: any) {
    console.warn(`[Video] Audio sync warning in rerunVideoJob: ${syncErr.message}`);
  }
}

/**
 * Reruns an existing video job on Kaggle with the latest patched renderer.
 */
export async function rerunVideoJob(jobId: string): Promise<string> {
  const user = kaggleUser();
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const cleanId = jobId.replace(/^video-render-/, "").replace(/^shunyapulse\//, "");
  const jobDir = path.join(JOBS_DIR, cleanId);
  const kDir = path.join(jobDir, "kernel");
  const dsDir = path.join(jobDir, "dataset");
  await fs.mkdir(kDir, { recursive: true });

  await syncJobAudio(dsDir);

  // Copy latest patched render.py into the job kernel directory
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));
  await writeJsonFile(path.join(kDir, "kernel-metadata.json"), kernelMetadata(user, cleanId));

  console.log("[Video] Pushing updated kernel to Kaggle...");
  const pushRes = await kaggle(["kernels", "push", "-p", kDir]);
  console.log("[Video] Kernel push completed.");

  const statusRes = await kaggle(["kernels", "status", `${user}/video-render-${cleanId}`]);

  return JSON.stringify(
    {
      jobId: cleanId,
      kernel: `${user}/video-render-${cleanId}`,
      push: pushRes,
      status: statusRes,
    },
    null,
    2
  );
}

/** Download a kernel's output directory and return its log tail. */
async function downloadKernelOutput(full: string, slug: string): Promise<string> {
  const dest = path.join(JOBS_DIR, slug.replace(/^video-render-/, ""), "output");
  await fs.mkdir(dest, { recursive: true });
  const out = await kaggle(["kernels", "output", full, "-p", dest], OUTPUT_TIMEOUT_MS);
  const files = await fs.readdir(dest).catch(() => [] as string[]);

  let logTail = "";
  const logFile = files.find((f) => f.endsWith(".log"));
  if (logFile) {
    const raw = await fs.readFile(path.join(dest, logFile), "utf-8");
    logTail = raw.slice(-LOG_TAIL_CHARS);
  }
  return `${out}\nFiles in ${dest}: ${files.join(", ") || "(none yet)"}\n--- log tail ---\n${logTail}`;
}

/**
 * Observe Kaggle training / rendering kernels.
 */
export async function manageKaggle(action: KaggleAction, ref?: string): Promise<string> {
  const user = kaggleUser();
  if (action === "list") return await kaggle(["kernels", "list", "--mine", "--page-size", "15"]);
  if (!ref) return "Error: 'ref' (owner/kernel-slug) is required for status/output/rerun.";

  const full = ref.includes("/") ? ref : `${user}/${ref}`;
  if (action === "status") return await kaggle(["kernels", "status", full]);
  if (action === "rerun") return await rerunVideoJob(ref);

  const slug = full.split("/")[1] ?? full;
  return downloadKernelOutput(full, slug);
}

export { JOBS_DIR };
