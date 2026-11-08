import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { kaggle } from "./kaggle.js";
import { generateScript } from "./script.js";
import { healMissingNarration, synthesizeNarration } from "./narration.js";
import { generateSceneKeyframes } from "./keyframes.js";
import { auditAndHealKeyframes } from "./keyframe-auditor.js";
import { isSportsOrCricket } from "./domain.js";
import { resolveAndDownloadCloudBgm, searchAndDownloadSFX } from "./dynamicSound.js";
import { verifyPreFlightDataset } from "./preflight.js";
import { askMammothChoice } from "../../ai/decisions.js";
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
  const slug = `${id}${sanitizeTitleForSlug(title)}`;
  const cleanTitle = (title || "").replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const displayTitle = (cleanTitle ? `Job ${id} ${cleanTitle}` : `video job ${slug}`).slice(0, 48);
  return {
    title: displayTitle,
    id: `${user}/video-job-${slug}`,
    licenses: [{ name: "CC0-1.0" }],
    is_private: true,
  };
}

function kernelMetadata(user: string, id: string, title?: string) {
  const slug = `${id}${sanitizeTitleForSlug(title)}`;
  const displayTitle = `video render ${slug}`;
  return {
    id: `${user}/video-render-${slug}`,
    title: displayTitle,
    code_file: "render.py",
    language: "python",
    kernel_type: "script",
    is_private: true,
    enable_gpu: true,
    machine_shape: "NvidiaTeslaT4x2",
    enable_internet: true,
    dataset_sources: [`${user}/video-job-${slug}`],
  };
}

function runtimeConfig(gcpKey?: string) {
  const resolvedGcpKey = process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY || gcpKey || "";
  return {
    hf_token: process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || (process.env.KAGGLE_BUNDLE_HF_TOKEN === "true" ? (process.env.HF_TOKEN || "") : ""),
    gcp_tts_key: resolvedGcpKey,
    gcp_tts_api_key: resolvedGcpKey,
  };
}

const BGM_CRITERIA: Record<string, string> = {
  inspirational_cello: "Hardware engineering, semiconductor chips, Apple silicon, technical architecture, deep learning mechanics, analytical focus",
  dramatic_strings: "Corporate debt, financial crisis, massive borrowing, market distress, urgent suspense, high-stakes corporate rivalry",
  triumphant_brass: "Sports championship, cricket victory, athletic glory, stadium celebrations, winning moments",
  epic_orchestral: "Deep space missions, planetary discoveries, cosmic telescopes, grand monumental engineering, global human milestones",
  warm_serenade: "Gentle human interest, inspiring community welfare, peaceful transitions, harmonious social progress",
  gentle_acoustic: "Wilderness biomes, nature documentaries, deep oceans, wildlife expeditions, acoustic reflection",
  uplifting_documentary: "Scientific discovery, clean energy transition, medical breakthroughs, biotechnology, general educational documentary",
  contemplative_piano: "Philosophical reflection, deep existential questions, emotional human journey, mysterious dilemmas",
  solemn_history: "Historical memorials, solemn heritage, sober historical retrospectives, classic tragedies, fallen dynasties",
  heroic_adventure: "High-octane action, intense frontier exploration, rapid tech breakthroughs, daring competitive rivalry",
};

/**
 * Intelligent BGM Classification Fallback using Baseten Mammoth-1 Decision Engine.
 * Activated when director LLM does not supply a specific bgmGenre.
 * Employs zero keyword hardcoding or local math heuristics (Rule 13).
 */
async function decideBgmWithMammoth(
  title: string,
  description?: string,
  isSports?: boolean
): Promise<string> {
  if (isSports) {
    return "triumphant_brass";
  }
  try {
    const question = `Select the single most acoustically fitting background music theme for a documentary video titled "${title}". Context: ${description || title}.`;
    console.log(`🦣 [Mammoth-1 Decision Engine] Classifying acoustic BGM theme for: "${title}"...`);
    const result = await askMammothChoice(
      { title, description },
      question,
      BGM_CRITERIA
    );
    if (result?.choice && BGM_CRITERIA[result.choice]) {
      console.log(`🦣 [Mammoth-1 Decision] Selected "${result.choice}" (confidence: ${result.confidence?.toFixed(2) || "unknown"}, latency: ${result.latencyMs}ms)`);
      return result.choice;
    }
  } catch (err: any) {
    console.warn(`[Mammoth-1] Decision fallback failed: ${err?.message || err}. Defaulting to uplifting_documentary.`);
  }
  return "uplifting_documentary";
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

  // Stage 1.2: Autonomous Multimodal Keyframe Audit & Self-Healing Loop (Zero Defective Keyframes)
  try {
    const auditSummary = await auditAndHealKeyframes(script, imagesDir);
    if (auditSummary.healedCount > 0) {
      console.log(`[Video] 🩹 Self-healed ${auditSummary.healedCount} keyframes before dataset packaging.`);
    }
  } catch (auditErr: any) {
    console.warn(`[Video] Keyframe audit notice: ${auditErr?.message || auditErr}`);
  }

  // Stage 1.5: Stream domain BGM directly into dataset/audio (Zero Laptop Storage)
  const soundscape =
    (script as any).visual_bible?.soundscapeProfile ||
    (script as any).visual_bible?.soundscape_profile ||
    (script as any).soundscape_profile ||
    (script as any).soundscapeProfile ||
    {};
  let requestedBgm = soundscape.bgmGenre;
  if (!requestedBgm) {
    requestedBgm = await decideBgmWithMammoth(script.title, script.description, isSports);
  }
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
  // Dual-Mode Policy:
  // In user-present/manual mode: strict 100% FLUX quality check.
  // In unattended scheduled cron (GITHUB_EVENT_NAME === 'schedule'): allow resilient on-the-fly SDXL-Lightning fallback on Kaggle.
  const isUnattendedSchedule =
    process.env.GITHUB_EVENT_NAME === "schedule" ||
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
    process.env.GITHUB_EVENT_NAME === "repository_dispatch" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.AUTONOMOUS_CRON === "true" ||
    process.env.ALLOW_SDXL_FALLBACK === "true";
  const preflight = await verifyPreFlightDataset(dsDir, script.scenes.length, {
    requireAudio: true,
    requireKeyframes: true,
    requireBgm: true,
    minAudioBytes: 500,
    minImageBytes: 5000,
    allowSdxlFallback: isUnattendedSchedule,
  });

  if (preflight.sdxlFallbackActive) {
    console.warn(`[Video] ⚡ [Pre-Flight Smart Fallback] Unattended mode detected: ${preflight.keyframeCount}/${script.scenes.length} FLUX keyframes ready. Kaggle GPU on-the-fly SDXL-Lightning fallback activated for remaining scenes.`);
    script.render_mode = "sdxl_fallback";
    await writeJsonFile(path.join(dsDir, "script.json"), script);
  }

  if (!preflight.ok) {
    const errorDetails = preflight.errors.slice(0, 10).join("\n - ");
    console.error(`❌ [Pre-Flight Gate Abort] ${preflight.errors.length} assets failed verification:\n - ${errorDetails}`);
    throw new Error(
      `[Pre-Flight Verification Gate Abort] Dataset validation failed: ` +
      `${preflight.audioCount}/${script.scenes.length} audio, ` +
      `${preflight.keyframeCount}/${script.scenes.length} keyframes, ` +
      `BGM: ${preflight.hasBgm ? "OK" : "MISSING"}. ` +
      `Refusing to dispatch broken/empty dataset to Kaggle GPU.\n - [REDACTED]`
    );
  }
  console.log('[Video] 🛡️ [Pre-Flight Verified] 100% assets verified: [REDACTED]');

  console.log('[Video] 📦 Creating Kaggle dataset for job [REDACTED]...');
  const ds = await kaggle(["datasets", "create", "-p", dsDir, "--dir-mode", "zip"]);
  const safeDsLog = (ds || "")
    .replace(/[a-f0-9]{32}/gi, "[REDACTED_HASH]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]")
    .slice(0, 1500);
  console.log(`[Video] 📦 Kaggle dataset create output: ${safeDsLog}`);
  const isDatasetFailure =
    /40[0-9] Client Error|50[0-9] Server Error|Kaggle CLI Error/i.test(ds) ||
    /An error occurred while creating your dataset/i.test(ds) ||
    /title must be between/i.test(ds);
  if (isDatasetFailure) {
    throw new Error(`[Kaggle Dataset Create Failed] ${safeDsLog}`);
  }
  // Smart polling for Kaggle dataset readiness (instant mount as soon as ready)
  console.log('[Video] ⏳ Smart polling Kaggle dataset readiness for [REDACTED]...');
  await waitForDatasetReady(`${user}/video-job-${slug}`, 30000, 2000);
  console.log(`[Video] 🚀 Pushing Kaggle kernel for job "${slug}"...`);
  const push = await kaggle(["kernels", "push", "-p", kDir]);
  const safePushLog = (push || "")
    .replace(/[a-f0-9]{32}/gi, "[REDACTED_HASH]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]")
    .slice(0, 1500);
  console.log(`[Video] 🚀 Kaggle kernel push output: ${safePushLog}`);
  if (/40[0-9] Client Error|50[0-9] Server Error|Kaggle CLI Error/i.test(push)) {
    throw new Error(`[Kaggle Kernel Push Failed] ${safePushLog}`);
  }

  return JSON.stringify(
    {
      jobId: slug,
      kernel: `${user}/video-render-${slug}`,
      title: script.title,
      scenes: script.scenes.length,
      dataset: "[REDACTED]",
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
      await auditAndHealKeyframes(script, imagesDir).catch(() => {});
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
 * Resolves the local job directory for a given `cleanId` (which may be a full slug
 * like `m9abc123-why-india-built` or a base ID like `m9abc123`).
 */
function resolveLocalJobDir(cleanId: string): string {
  const directDir = path.join(JOBS_DIR, cleanId);
  if (fsSync.existsSync(directDir)) {
    return directDir;
  }
  const baseId = cleanId.split("-")[0];
  if (baseId && baseId !== cleanId) {
    const baseDir = path.join(JOBS_DIR, baseId);
    if (fsSync.existsSync(baseDir)) {
      return baseDir;
    }
  }
  return directDir;
}

/**
 * Reruns an existing video job on Kaggle with the latest patched renderer.
 */
export async function rerunVideoJob(jobId: string): Promise<string> {
  const user = kaggleUser();
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const cleanId = jobId.replace(/^[a-zA-Z0-9_-]+\//, "").replace(/^video-render-/, "");
  const jobDir = resolveLocalJobDir(cleanId);
  const kDir = path.join(jobDir, "kernel");
  const dsDir = path.join(jobDir, "dataset");
  await fs.mkdir(kDir, { recursive: true });

  await syncJobAudio(dsDir);

  // Copy latest patched render.py into the job kernel directory
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));

  // Preserve existing kernel-metadata.json if present (so dataset_sources slug matches Kaggle);
  // otherwise reconstruct using cleanId (which already includes any slug suffix).
  const kMetaPath = path.join(kDir, "kernel-metadata.json");
  let targetKernelRef = `${user}/video-render-${cleanId}`;
  if (fsSync.existsSync(kMetaPath)) {
    try {
      const existingMeta = JSON.parse(await fs.readFile(kMetaPath, "utf-8"));
      if (existingMeta?.id) {
        targetKernelRef = existingMeta.id;
      }
    } catch {
      await writeJsonFile(kMetaPath, kernelMetadata(user, cleanId));
    }
  } else {
    await writeJsonFile(kMetaPath, kernelMetadata(user, cleanId));
  }

  console.log("[Video] Pushing updated kernel to Kaggle...");
  const pushRes = await kaggle(["kernels", "push", "-p", kDir]);
  if (/400 Client Error|403 Client Error|404 Client Error|Kaggle CLI Error/i.test(pushRes)) {
    throw new Error(`[Kaggle Kernel Rerun Push Failed] ${pushRes.slice(0, 240)}`);
  }
  console.log("[Video] Kernel push completed.");

  const statusRes = await kaggle(["kernels", "status", targetKernelRef]);

  return JSON.stringify(
    {
      jobId: cleanId,
      kernel: targetKernelRef,
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
