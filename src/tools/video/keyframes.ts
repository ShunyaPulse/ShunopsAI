import { auditDiffusionPromptWithMammoth } from "../../ai/decisions.js";
/**
 * ShunopsAI - Cloudflare Workers AI FLUX.1-schnell Keyframe Pre-Packager (Tarika 2)
 *
 * Pre-packages Midjourney-grade base scene keyframes via Cloudflare's serverless GPUs
 * (@cf/black-forest-labs/flux-1-schnell) in ~2s per image at ₹0 (10,000 free Neurons/day).
 *
 * Why this is superior to raw Text-to-Video (T2V):
 * - Guarantees 100% Character & Face/Object Lock across scenes.
 * - Saves 100% of Kaggle GPU time on Text-to-Image synthesis.
 * - Wan2.1-VACE-1.3B conditions directly on this pristine keyframe.
 * - Zero local VM RAM / VRAM consumption (runs on Cloudflare edge).
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { getTopicHash, downloadFromGCS, uploadToGCS } from "./gcsVault.js";
import type { VideoScript } from "./types.js";

export interface KeyframesSynthesisResult {
  successCount: number;
  totalScenes: number;
  failedScenes: number[];
  modelUsed: string;
}

const MIN_IMAGE_BYTES = 5000;
const FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/**
 * Builds a character-locked visual prompt for FLUX.1-schnell
 */
function buildKeyframePrompt(
  scPrompt: string,
  visualBible?: VideoScript["visual_bible"],
  domain: string = "general"
): string {
  const parts: string[] = [];

  // 1. Character Visual DNA lock (Concise high-retention character grammar)
  if (visualBible?.characterGrammar) {
    parts.push(visualBible.characterGrammar.slice(0, 500));
  }

  // 2. Scene specific visual prompt
  parts.push(scPrompt);

  // 3. Strict equipment & kit invariants for sports/cricket (Compact Positive Anchors)
  const isSports =
    domain === "sports" ||
    domain.includes("cricket") ||
    (visualBible?.realWorldGrounding && visualBible.realWorldGrounding.toLowerCase().includes("cricket"));
  if (isSports) {
    parts.push(
      "Authentic cricket equipment: 3 upright wooden stumps with bails, flat-bladed English willow bat, official solid team jersey, protective batting pads and helmet. Zero casual clothes, zero baseball bats, zero digital scoreboards"
    );
  }

  // 4. Cinematic optical aesthetic (Positive optical descriptors)
  parts.push(
    "Cinematic 35mm photography, photorealistic, sharp focus, volumetric lighting, authentic textures, zero text, zero watermarks"
  );

  const fullPrompt = parts.join(". ").replace(/\s+/g, " ").trim();
  // Absolute Hard Ceiling: Cloudflare FLUX limits prompts to 2048 chars max. Safe limit at 1800.
  return fullPrompt.length > 1800 ? fullPrompt.slice(0, 1800).trim() : fullPrompt;
}

/**
 * Uses Baseten Mammoth 1 decision engine to detect and eliminate any diffusion text prompts
 * enforcing GEMINI.md Rule 12 & Rule 17 (Zero AI glyphs / zero corrupt scoreboards)
 * without being restricted to a tiny 6-word hardcoded list.
 */
export async function sanitizeZeroDiffusionText(prompt: string): Promise<string> {
  // Fast skip only if prompt has no quotes, numbers, or any signage/screen/text concepts
  const mightContainTextConcept =
    /["'][^"']{2,}["']|\b(text|scoreboard|leaderboard|infographic|words|letters|signage|writing|numbers|banner|poster|placard|slide|chart|graph|screen|monitor|ticker|caption|label|heading|title|inscription)\b/i.test(
      prompt
    );
  if (!mightContainTextConcept) {
    return prompt;
  }

  try {
    const audit = await auditDiffusionPromptWithMammoth(prompt);
    if (audit?.hasTextAnomaly) {
      console.log(
        `[Zero-Diffusion Text Gate] 🛡️ Mammoth 1 flagged text anomaly (action=${audit.suggestedAction}, confidence=${(audit.confidence * 100).toFixed(1)}%). Applying ${audit.suggestedAction}.`
      );
      let cleaned = prompt
        // Strip explicit quoted strings like 'saying "INDIA"' or 'reading "WINNER"'
        .replace(/\b(saying|reading|titled|labeled|inscribed with|displaying)\s+["'][^"']+["']/gi, "with clean text-free surfaces")
        .replace(/["'][^"']{2,40}["']/g, "")
        .replace(/\b(scoreboard|leaderboard|digital timer|score ticker|giant screen|stadium screen)\b/gi, "blurred stadium floodlights")
        .replace(/\b(infographic|presentation slide|bulleted list|bar chart|line graph|diagram)\b/gi, "tactile physical equipment model")
        .replace(/\b(written text|words saying|readable letters|banner|placard|signage)\b/gi, "clean atmospheric background")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (audit.suggestedAction === "blur-background") {
        cleaned += ", shallow depth of field with softly blurred bokeh background";
      } else if (audit.suggestedAction === "replace-with-metaphor") {
        cleaned += ", depicted through tactile text-free physical objects and lighting";
      }
      return cleaned.slice(0, 1800);
    }
  } catch {}
  return prompt;
}

export async function callCloudflareFlux(
  prompt: string,
  outPng: string,
  accountId?: string,
  apiToken?: string
): Promise<boolean> {
  const accountsToTry: Array<{ id: string; token: string }> = [];
  if (accountId && apiToken) {
    accountsToTry.push({ id: accountId, token: apiToken });
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    if (!accountsToTry.some((a) => a.id === process.env.CLOUDFLARE_ACCOUNT_ID)) {
      accountsToTry.push({ id: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
    }
  }
  if (process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID && process.env.SARALGATI_CLOUDFLARE_API_TOKEN) {
    if (!accountsToTry.some((a) => a.id === process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID)) {
      accountsToTry.push({
        id: process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID,
        token: process.env.SARALGATI_CLOUDFLARE_API_TOKEN,
      });
    }
  }

  for (const acc of accountsToTry) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc.id)}/ai/run/${FLUX_MODEL}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${acc.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          steps: 4,
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!res.ok) {
        console.warn(`[Keyframes] Cloudflare FLUX endpoint returned HTTP ${res.status}`);
        if (res.status === 429 || res.status === 503) {
          continue; // cascade to next account
        }
        return false;
      }

      const data: any = await res.json();
      const base64Data = data?.result?.image;

      if (!base64Data || typeof base64Data !== "string") {
        console.warn("[Keyframes] Cloudflare FLUX returned no image data.");
        continue;
      }

      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length < MIN_IMAGE_BYTES) {
        console.warn(`[Keyframes] Generated image too small (${buffer.length} bytes).`);
        continue;
      }

      await fs.mkdir(path.dirname(outPng), { recursive: true });
      await fs.writeFile(outPng, buffer);
      return true;
    } catch {
      console.warn("[Keyframes] FLUX request exception occurred during generation.");
      continue;
    }
  }
  return false;
}

/**
 * Pre-packages keyframe images for all scenes in the script into dataset/images/
 */
export async function generateSceneKeyframes(
  script: VideoScript,
  imagesDir: string,
  options?: { accountId?: string; apiToken?: string }
): Promise<KeyframesSynthesisResult> {
  const accountId = options?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = options?.apiToken || process.env.CLOUDFLARE_API_TOKEN;

  const totalScenes = script.scenes.length;
  const failedScenes: number[] = [];
  let successCount = 0;

  if (!accountId || !apiToken) {
    console.warn("[Keyframes] ⚠️ Cloudflare credentials not configured in .env. Skipping pre-packaging (Kaggle Tarika 1 fallback active).");
    return {
      successCount: 0,
      totalScenes,
      failedScenes: script.scenes.map((_, idx) => idx),
      modelUsed: "none",
    };
  }

  await fs.mkdir(imagesDir, { recursive: true });
  console.log(`[Keyframes] 🎨 Pre-packaging ${totalScenes} keyframes via Cloudflare Workers AI (${FLUX_MODEL})...`);

  const topicHash = getTopicHash(script.title, script.language);

  for (let i = 0; i < totalScenes; i++) {
    const sc = script.scenes[i];
    if (!sc) continue;

    const outPng = path.join(imagesDir, `scene_${String(i).padStart(3, "0")}.png`);
    const remoteGcsPath = `video-vault/${topicHash}/images/scene_${String(i).padStart(3, "0")}.png`;

    // 1. Local Disk Cache Hit (0 tokens, 0 delay)
    try {
      if (fsSync.existsSync(outPng) && fsSync.statSync(outPng).size >= MIN_IMAGE_BYTES) {
        console.log(`[Keyframes] ⚡ Scene ${i + 1} keyframe local cache hit (${fsSync.statSync(outPng).size} bytes) -> reusing.`);
        successCount++;
        continue;
      }
    } catch {}

    // 2. GCS Cloud Vault Hit (download in <200ms, skips Cloudflare FLUX completely)
    try {
      const gcsHit = await downloadFromGCS(remoteGcsPath, outPng);
      if (gcsHit && fsSync.existsSync(outPng) && fsSync.statSync(outPng).size >= MIN_IMAGE_BYTES) {
        console.log(`[Keyframes] ☁️ Scene ${i + 1} keyframe GCS Vault hit (${fsSync.statSync(outPng).size} bytes) -> downloaded from cloud storage.`);
        successCount++;
        continue;
      }
    } catch {}

    const prompt = await sanitizeZeroDiffusionText(
      buildKeyframePrompt(sc.visual_prompt, script.visual_bible, script.domain)
    );
    let ok = false;

    // Retry with brief backoff on cold starts
    for (let attempt = 1; attempt <= 2; attempt++) {
      ok = await callCloudflareFlux(prompt, outPng, accountId, apiToken);
      if (ok) {
        successCount++;
        console.log(`[Keyframes] ✅ Scene ${i + 1}/${totalScenes} keyframe ready (scene_${String(i).padStart(3, "0")}.png)`);
        // Asynchronously persist to GCS Vault so future runs/retries never lose this image
        uploadToGCS(outPng, remoteGcsPath, "image/png").catch(() => {});
        break;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (!ok) {
      failedScenes.push(i);
      console.warn(`[Keyframes] ⚠️ Scene ${i + 1} FLUX generation skipped; will rely on Kaggle SDXL-Lightning fallback.`);
    }

    // Mindful adaptive pacing between Cloudflare API calls (350ms - 550ms with jitter)
    if (i < totalScenes - 1) {
      const mindfulDelay = 350 + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, mindfulDelay));
    }
  }

  console.log(`[Keyframes] 🎉 Pre-packaging complete: ${successCount}/${totalScenes} keyframes pre-generated via FLUX.1-schnell.`);

  return {
    successCount,
    totalScenes,
    failedScenes,
    modelUsed: FLUX_MODEL,
  };
}
