import * as fs from "node:fs/promises";
import * as path from "node:path";
import { kaggle } from "../src/tools/video/kaggle.js";
import { generateSceneKeyframes } from "../src/tools/video/keyframes.js";
import type { VideoScript } from "../src/tools/video/types.js";

const JOBS_DIR = path.resolve(process.cwd(), "jobs");
const RENDER_SRC = path.resolve(process.cwd(), "video", "kernel", "render.py");
const DATASET_SETTLE_MS = 20000;

function kaggleUser(): string {
  return process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
}

function datasetMetadata(user: string, id: string) {
  return {
    title: `video job ${id}`,
    id: `${user}/video-job-${id}`,
    licenses: [{ name: "CC0-1.0" }],
    is_private: true,
  };
}

function kernelMetadata(user: string, id: string) {
  return {
    id: `${user}/video-render-${id}`,
    title: `video render ${id}`,
    code_file: "render.py",
    language: "python",
    kernel_type: "script",
    is_private: true,
    enable_gpu: true,
    enable_internet: true,
    dataset_sources: [`${user}/video-job-${id}`],
  };
}

function runtimeConfig() {
  return {
    hf_token: process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "",
    gcp_tts_key: process.env.GCP_TTS_API_KEY || "",
  };
}

async function writeJsonFile(filePath: string, value: unknown, mode?: number): Promise<void> {
  const payload = JSON.stringify(value, null, 2);
  if (mode !== undefined) {
    await fs.writeFile(filePath, payload, { mode });
    return;
  }
  await fs.writeFile(filePath, payload);
}

async function main() {
  const user = kaggleUser();
  console.log(`[FLUX Pak-Eng] Kaggle user: ${user}`);

  // 1. Load existing script and verify audio
  const sourceJobId = "mvop4bah";
  const sourceScriptPath = path.join(JOBS_DIR, sourceJobId, "dataset", "script.json");
  const sourceAudioDir = path.join(JOBS_DIR, sourceJobId, "dataset", "audio");

  console.log(`[FLUX Pak-Eng] Reading existing script from ${sourceScriptPath}...`);
  const rawScript = await fs.readFile(sourceScriptPath, "utf-8");
  const script = JSON.parse(rawScript) as VideoScript;

  console.log(`[FLUX Pak-Eng] Title: "${script.title}", Scenes: ${script.scenes.length}`);

  // Verify audio files exist
  const audioFiles = await fs.readdir(sourceAudioDir);
  console.log(`[FLUX Pak-Eng] Found ${audioFiles.length} existing synthesized audio tracks in ${sourceAudioDir}`);
  if (audioFiles.length < script.scenes.length) {
    throw new Error(`Expected at least ${script.scenes.length} audio tracks, but found ${audioFiles.length}`);
  }

  // 2. Prepare new fresh job directory
  const newJobId = Date.now().toString(36);
  const newJobDir = path.join(JOBS_DIR, newJobId);
  const newDsDir = path.join(newJobDir, "dataset");
  const newKDir = path.join(newJobDir, "kernel");
  const newAudioDir = path.join(newDsDir, "audio");
  const newImagesDir = path.join(newDsDir, "images");

  await fs.mkdir(newAudioDir, { recursive: true });
  await fs.mkdir(newImagesDir, { recursive: true });
  await fs.mkdir(newKDir, { recursive: true });

  // 3. Copy existing Gemini TTS audio files over
  console.log(`[FLUX Pak-Eng] Reusing pre-packaged Gemini TTS audio files into new job ${newJobId}...`);
  for (const file of audioFiles) {
    await fs.copyFile(path.join(sourceAudioDir, file), path.join(newAudioDir, file));
  }
  console.log(`[FLUX Pak-Eng] ✅ Successfully copied all ${audioFiles.length} audio tracks.`);

  // 4. Generate keyframes via Cloudflare FLUX.1-schnell using SaralGati account credentials
  const saralgatiAccountId = process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID;
  const saralgatiApiToken = process.env.SARALGATI_CLOUDFLARE_API_TOKEN;

  if (!saralgatiAccountId || !saralgatiApiToken) {
    throw new Error("Missing SARALGATI_CLOUDFLARE_ACCOUNT_ID or SARALGATI_CLOUDFLARE_API_TOKEN in environment.");
  }

  console.log(`[FLUX Pak-Eng] 🎨 Generating ${script.scenes.length} keyframes via Cloudflare FLUX.1-schnell (SaralGati account)...`);
  const keyframes = await generateSceneKeyframes(script, newImagesDir, {
    accountId: saralgatiAccountId,
    apiToken: saralgatiApiToken,
  });

  console.log(`[FLUX Pak-Eng] 🎉 Keyframe synthesis complete: ${keyframes.successCount}/${keyframes.totalScenes} generated via ${keyframes.modelUsed}`);

  if (keyframes.successCount === 0) {
    throw new Error("Failed to generate any keyframes with FLUX. Aborting.");
  }

  script.keyframes_summary = `${keyframes.successCount}/${keyframes.totalScenes} via ${keyframes.modelUsed}`;

  // 5. Write dataset files
  await writeJsonFile(path.join(newDsDir, "script.json"), script);
  await writeJsonFile(path.join(newDsDir, "dataset-metadata.json"), datasetMetadata(user, newJobId));
  await writeJsonFile(path.join(newDsDir, "config.json"), runtimeConfig(), 0o600);
  await fs.copyFile(RENDER_SRC, path.join(newKDir, "render.py"));
  await writeJsonFile(path.join(newKDir, "kernel-metadata.json"), kernelMetadata(user, newJobId));

  // 6. Push dataset to Kaggle
  console.log(`[FLUX Pak-Eng] 📦 Uploading dataset to Kaggle (${newJobId})...`);
  const dsRes = await kaggle(["datasets", "create", "-p", newDsDir, "--dir-mode", "zip"]);
  console.log(`[FLUX Pak-Eng] Dataset response:`, dsRes.slice(0, 200));

  console.log(`[FLUX Pak-Eng] ⏳ Settle pause (${DATASET_SETTLE_MS / 1000}s)...`);
  await new Promise((r) => setTimeout(r, DATASET_SETTLE_MS));

  // 7. Push kernel to Kaggle
  console.log(`[FLUX Pak-Eng] 🚀 Pushing rendering kernel to Kaggle (${newJobId})...`);
  const pushRes = await kaggle(["kernels", "push", "-p", newKDir]);
  console.log(`[FLUX Pak-Eng] Kernel push response:`, pushRes.slice(0, 300));

  const result = {
    jobId: newJobId,
    kernel: `${user}/video-render-${newJobId}`,
    title: script.title,
    scenes: script.scenes.length,
    fluxImagesGenerated: `${keyframes.successCount}/${keyframes.totalScenes}`,
    kernelUrl: `https://www.kaggle.com/code/${user}/video-render-${newJobId}`,
  };

  console.log("\n==========================================");
  console.log("🔥 JOB SUCCESSFULLY LAUNCHED WITH FLUX! 🔥");
  console.log(JSON.stringify(result, null, 2));
  console.log("==========================================\n");
}

main().catch((err) => {
  console.error("[FLUX Pak-Eng] Error:", err);
  process.exit(1);
});

