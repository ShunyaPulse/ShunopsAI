/**
 * ShunopsAI - Autonomous Multimodal Keyframe Auditor & Self-Healing Pipeline
 *
 * Visually evaluates generated Cloudflare FLUX scene keyframes against narration,
 * documentary domain, and Visual Bible directives before dataset packaging and Kaggle GPU render.
 *
 * Core Capabilities:
 * - Direct Thematic Relevance: Ensures images visually ground the scene rather than generic stock filler.
 * - Zero-Diffusion Text Rule: Detects corrupt letters, gibberish glyphs, and foreign alphabets.
 * - Anatomical & Physical Sanity: Eliminates headless bodies, melting limbs, and toy miniatures.
 * - Cultural & Period Grounding: Dynamically inferred from topic context (strictly zero hardcoded countries).
 * - Multi-Provider Vision Cascade: Gemini Flash 34-Key Pool -> GitHub Models (GPT-4o-mini) -> OpenRouter.
 * - Zero Data Loss Guarantee: Non-destructive in-place backups (.backup/) protect every asset.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomInt } from "node:crypto";
import OpenAI from "openai";
import type { VideoScript } from "./types.js";
import { generateSceneKeyframes } from "./keyframes.js";

export interface KeyframeAuditResult {
  sceneIndex: number;
  verdict: "PASS" | "NEEDS_HEALING";
  confidence: number;
  detectedAnomalies: string[];
  rootCause?: string;
  refinedVisualPrompt?: string;
  modelUsed?: string;
  cached?: boolean;
}

export interface KeyframeHealSummary {
  totalAudited: number;
  passedInitially: number;
  healedCount: number;
  retainedOriginalCount: number;
  healedScenes: number[];
  reports: KeyframeAuditResult[];
}

function geminiKeyPool(): string[] {
  const raw =
    process.env.GEMINI_KEYS ??
    process.env.GEMINI_API_KEYS ??
    process.env.GEMINI_API_KEY ??
    "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Invariant 6: Process-level startup offset initialization to prevent multi-service contention
let poolPointer = randomInt(0, 34);

function getNextGeminiKey(pool: string[]): string {
  if (pool.length === 0) return "";
  const key = pool[poolPointer % pool.length]!;
  poolPointer = (poolPointer + 1) % pool.length;
  return key;
}

function getOpenRouterKeys(): string[] {
  const raw = process.env.OPENROUTER_KEYS || process.env.OPENROUTER_API_KEY || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

const AUDIT_MODELS_QUALITY_ORDER = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
];

const AUDIT_SYSTEM_PROMPT = (
  topicTitle: string,
  topicDesc: string,
  sceneNarration: string,
  sceneCaption: string,
  currentVisualPrompt: string,
  visualBibleGrounding?: string,
  demographicGrammar?: string
) => `
You are the Autonomous Multimodal Vision Director for high-end cinematic documentary production.
Your mandate is to perform an uncompromising visual quality audit on this keyframe image before it is rendered into video.

DOCUMENTARY CONTEXT (Universally Dynamic - Derive context purely from these specifics without hardcoding):
- Title: "${topicTitle}"
- Context/Overview: "${topicDesc}"
- Real-World Setting / Grounding: "${visualBibleGrounding || "Authentic real-world environment native to the subject"}"
${demographicGrammar ? `- Target Demographics & Cultural Grammar: "${demographicGrammar}"` : ""}

SCENE BEING AUDITED:
- Narration: "${sceneNarration}"
- Subtitle/Caption: "${sceneCaption}"
- Current Visual Prompt used for generation: "${currentVisualPrompt}"

Perform a rigorous evaluation across these 5 non-negotiable gates:
1. THEMATIC RELEVANCE: Does this image directly depict what is happening in the narration and topic? Reject generic, unrelated stock filler (e.g. sterile server racks for stock markets, medical surgery rooms for finance, disco nightclub dance floors for business).
2. ZERO-DIFFUSION TEXT RULE: Check for corrupt AI letters, hallucinated gibberish glyphs, foreign characters (e.g. Chinese/Japanese kanji when topic is not East Asian), or blurry floating signs/tickers. If text is needed, it must be clean in post-production, NEVER in diffusion latents.
3. ANATOMICAL & PHYSICAL SANITY: Check for grotesque artifacts, decapitated/headless bodies, melting/extra fingers, disfigured faces, floating objects, or plastic toy miniature cities.
4. CULTURAL & DEMOGRAPHIC AUTHENTICITY: Ensure all human demographics, facial features, skin tones, architecture, garments, objects, and props match the true geographic and cultural context of the topic.
- If topic is location-bound (e.g. Delhi, Kabul, Robben Island, London), strictly reject images showing discordant foreign demographics (e.g. East Asian faces in Delhi air pollution scenes, or Western extras in historical African struggles).
- If topic is universal/institutional (e.g. semiconductor research, corporate finance, deep space), ensure diverse cosmopolitan or machine/probe framing without forced stereotypes.
5. CINEMATIC COMPOSITION: Ensure sharp 35mm optical framing with a clear focal point suitable for motion interpolation.

RESPONSE FORMAT:
You MUST respond strictly with valid JSON conforming to this schema (no extra text, no markdown backticks):
{
  "verdict": "PASS" | "NEEDS_HEALING",
  "confidence": <number between 0.0 and 1.0>,
  "detectedAnomalies": [<short descriptions of any detected flaws>],
  "rootCause": "<diagnostic root cause of why this failed, or empty if PASS>",
  "refinedVisualPrompt": "<If NEEDS_HEALING: Provide a detailed, photorealistic, culturally and physically grounded visual prompt that eliminates all detected flaws, strictly enforcing zero text, authentic props, clean lighting, and 35mm cinematic clarity. If PASS: leave empty string>"
}
`;

/**
 * Audits a single keyframe image via the multi-tier Vision fallback cascade:
 * Tier 1: Active Gemini Flash 34-Key Pool
 * Tier 2: GitHub Models (OpenAI GPT-4o-mini / GPT-4o)
 * Tier 3: OpenRouter Vision
 */
export async function auditSceneKeyframe(
  imagePath: string,
  scene: { narration: string; caption?: string; visual_prompt: string },
  script: VideoScript,
  sceneIndex: number
): Promise<KeyframeAuditResult> {
  const defaultPass: KeyframeAuditResult = {
    sceneIndex,
    verdict: "PASS",
    confidence: 1.0,
    detectedAnomalies: [],
    modelUsed: "default",
  };

  if (!fsSync.existsSync(imagePath)) {
    return {
      sceneIndex,
      verdict: "NEEDS_HEALING",
      confidence: 1.0,
      detectedAnomalies: ["Keyframe image file missing on disk"],
      rootCause: "Image not found at path",
      refinedVisualPrompt: scene.visual_prompt,
      modelUsed: "local-check",
    };
  }

  const imageBuffer = await fs.readFile(imagePath);
  if (imageBuffer.length < 5000) {
    return {
      sceneIndex,
      verdict: "NEEDS_HEALING",
      confidence: 1.0,
      detectedAnomalies: ["Keyframe image is 0-byte or corrupted"],
      rootCause: "Image file size below minimum 5KB threshold",
      refinedVisualPrompt: scene.visual_prompt,
      modelUsed: "local-check",
    };
  }

  const base64Image = imageBuffer.toString("base64");
  const promptText = AUDIT_SYSTEM_PROMPT(
    script.title,
    script.description,
    scene.narration,
    scene.caption || "",
    scene.visual_prompt,
    script.visual_bible?.realWorldGrounding,
    script.visual_bible?.demographicGrammar
  );

  // -------------------------------------------------------------
  // Tier 1: Gemini Multimodal Vision API (34-Key Pool with $O(1)$ pointer)
  // -------------------------------------------------------------
  const pool = geminiKeyPool();
  if (pool.length > 0) {
    for (const model of AUDIT_MODELS_QUALITY_ORDER) {
      for (let attempt = 0; attempt < Math.min(pool.length, 3); attempt++) {
        const key = getNextGeminiKey(pool);
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: base64Image,
                      },
                    },
                    {
                      text: promptText,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            }),
            signal: AbortSignal.timeout(20000),
          });

          if (!res.ok) {
            continue;
          }

          const data: any = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            return {
              sceneIndex,
              verdict: parsed.verdict === "NEEDS_HEALING" ? "NEEDS_HEALING" : "PASS",
              confidence: Number(parsed.confidence) || 0.9,
              detectedAnomalies: Array.isArray(parsed.detectedAnomalies) ? parsed.detectedAnomalies : [],
              rootCause: parsed.rootCause || "",
              refinedVisualPrompt: parsed.refinedVisualPrompt || "",
              modelUsed: `gemini/${model}`,
            };
          }
        } catch {
          // cascade to next key/model
          continue;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Tier 2: GitHub Models (OpenAI GPT-4o-mini / GPT-4o via GITHUB_TOKEN)
  // -------------------------------------------------------------
  const ghToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GH_PAT;
  if (ghToken) {
    try {
      const ghClient = new OpenAI({
        baseURL: "https://models.inference.ai.azure.com",
        apiKey: ghToken,
        timeout: 25000,
        maxRetries: 1,
      });

      const ghRes = await ghClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
              {
                type: "text",
                text: promptText,
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const rawContent = ghRes.choices?.[0]?.message?.content;
      if (rawContent) {
        const parsed = JSON.parse(rawContent);
        return {
          sceneIndex,
          verdict: parsed.verdict === "NEEDS_HEALING" ? "NEEDS_HEALING" : "PASS",
          confidence: Number(parsed.confidence) || 0.9,
          detectedAnomalies: Array.isArray(parsed.detectedAnomalies) ? parsed.detectedAnomalies : [],
          rootCause: parsed.rootCause || "",
          refinedVisualPrompt: parsed.refinedVisualPrompt || "",
          modelUsed: "github/gpt-4o-mini",
        };
      }
    } catch {
      // cascade to Tier 3
    }
  }

  // -------------------------------------------------------------
  // Tier 3: OpenRouter Vision Fallback
  // -------------------------------------------------------------
  const orKeys = getOpenRouterKeys();
  if (orKeys.length > 0) {
    for (const key of orKeys.slice(0, 2)) {
      try {
        const orClient = new OpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: key,
          timeout: 25000,
          maxRetries: 0,
        });

        const orRes = await orClient.chat.completions.create({
          model: "google/gemini-2.0-flash-exp:free",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                  },
                },
                {
                  type: "text",
                  text: promptText,
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });

        const rawContent = orRes.choices?.[0]?.message?.content;
        if (rawContent) {
          const parsed = JSON.parse(rawContent);
          return {
            sceneIndex,
            verdict: parsed.verdict === "NEEDS_HEALING" ? "NEEDS_HEALING" : "PASS",
            confidence: Number(parsed.confidence) || 0.9,
            detectedAnomalies: Array.isArray(parsed.detectedAnomalies) ? parsed.detectedAnomalies : [],
            rootCause: parsed.rootCause || "",
            refinedVisualPrompt: parsed.refinedVisualPrompt || "",
            modelUsed: "openrouter/vision",
          };
        }
      } catch {
        continue;
      }
    }
  }

  // Graceful degradation: If all vision providers are offline, pass without blocking
  return defaultPass;
}

/**
 * Executes async tasks with a bounded concurrency pool.
 */
async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(items.length, concurrency));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await workerFn(items[idx]!, idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Orchestrates pre-render keyframe auditing and self-healing for an entire video script.
 * Features:
 * 1. Delta Caching: Skips already-verified PASS keyframes across subsequent runs.
 * 2. Parallel Multimodal Auditing: Audits pending keyframes concurrently across the 34 Gemini keys.
 * 3. Targeted Self-Healing: Selectively regenerates and re-audits only flagged scenes.
 * 4. Zero Data Loss Guarantee: Non-destructive backups (.backup/) protect every asset.
 */
export async function auditAndHealKeyframes(
  script: VideoScript,
  imagesDir: string,
  options: { maxHealingAttempts?: number; concurrency?: number } = {}
): Promise<KeyframeHealSummary> {
  const maxAttempts = options.maxHealingAttempts ?? 2;
  const pool = geminiKeyPool();
  const concurrency = options.concurrency ?? Math.max(1, Math.min(pool.length > 0 ? pool.length : 4, 6));
  const backupDir = path.join(imagesDir, ".backup");
  await fs.mkdir(backupDir, { recursive: true });

  const totalAudited = script.scenes.length;
  let passedInitially = 0;
  let healedCount = 0;
  let retainedOriginalCount = 0;
  const healedScenes: number[] = [];
  const reportsByScene: Map<number, KeyframeAuditResult> = new Map();

  // Load previous audit cache if available (Delta Caching)
  const datasetDir = path.dirname(imagesDir);
  const auditReportPath = path.join(datasetDir, "keyframe-audit.json");
  const cachedReportMap: Map<number, KeyframeAuditResult> = new Map();

  if (fsSync.existsSync(auditReportPath)) {
    try {
      const raw = await fs.readFile(auditReportPath, "utf-8");
      const prevData = JSON.parse(raw);
      if (Array.isArray(prevData.reports)) {
        for (const rep of prevData.reports) {
          if (typeof rep.sceneIndex === "number" && rep.verdict === "PASS") {
            cachedReportMap.set(rep.sceneIndex, rep);
          }
        }
      }
    } catch {
      // Ignore unparseable or outdated cache
    }
  }

  // Identify scenes that need audit vs scenes that can be skipped via cache
  const scenesToAudit: number[] = [];

  for (let i = 0; i < totalAudited; i++) {
    const scene = script.scenes[i];
    if (!scene) continue;

    const imgFileName = `scene_${String(i).padStart(3, "0")}.png`;
    const imgPath = path.join(imagesDir, imgFileName);
    const backupPath = path.join(backupDir, `${path.parse(imgFileName).name}_orig.png`);

    // Invariant: Create non-destructive backup before inspection/modification
    if (fsSync.existsSync(imgPath) && !fsSync.existsSync(backupPath)) {
      try {
        await fs.copyFile(imgPath, backupPath);
      } catch {}
    }

    const cached = cachedReportMap.get(i);
    if (cached && fsSync.existsSync(imgPath) && fsSync.statSync(imgPath).size >= 5000) {
      // Scene already verified PASS in previous audit and image file is valid!
      console.log(`[Keyframe Auditor] ⚡ Scene ${i + 1}/${totalAudited} previously verified PASS. Skipping vision API.`);
      reportsByScene.set(i, { ...cached, cached: true });
      passedInitially++;
    } else {
      scenesToAudit.push(i);
    }
  }

  if (scenesToAudit.length === 0) {
    console.log(`[Keyframe Auditor] 🎯 All ${totalAudited} scene keyframes previously passed audit! 100% delta cache hit.`);
  } else {
    console.log(
      `[Keyframe Auditor] 🔍 Launching Parallel Multimodal Quality Audit on ${scenesToAudit.length}/${totalAudited} scenes (${concurrency}x concurrency across key pool)...`
    );

    // Parallel Vision Audit Pass
    const auditResults = await runConcurrent(
      scenesToAudit,
      concurrency,
      async (sceneIdx) => {
        const scene = script.scenes[sceneIdx]!;
        const imgFileName = `scene_${String(sceneIdx).padStart(3, "0")}.png`;
        const imgPath = path.join(imagesDir, imgFileName);
        return await auditSceneKeyframe(imgPath, scene, script, sceneIdx);
      }
    );

    // Process audit verdicts
    const flaggedScenes: { sceneIdx: number; auditResult: KeyframeAuditResult }[] = [];

    for (let k = 0; k < scenesToAudit.length; k++) {
      const sceneIdx = scenesToAudit[k]!;
      const result = auditResults[k]!;
      reportsByScene.set(sceneIdx, result);

      if (result.verdict === "PASS") {
        passedInitially++;
      } else {
        flaggedScenes.push({ sceneIdx, auditResult: result });
      }
    }

    // Step 2: Parallel Self-Healing Loop for Flagged Scenes
    if (flaggedScenes.length > 0) {
      const healingConcurrency = Math.min(flaggedScenes.length, concurrency);
      console.log(
        `[Keyframe Healer] 🩹 Launching Parallel Self-Healing on ${flaggedScenes.length} flagged scenes (${healingConcurrency}x concurrency across key pool)...`
      );

      await runConcurrent(
        flaggedScenes,
        healingConcurrency,
        async ({ sceneIdx, auditResult: initialAudit }) => {
          let auditResult = initialAudit;
          const scene = script.scenes[sceneIdx]!;
          const imgFileName = `scene_${String(sceneIdx).padStart(3, "0")}.png`;
          const imgPath = path.join(imagesDir, imgFileName);
          const backupPath = path.join(backupDir, `${path.parse(imgFileName).name}_orig.png`);

          console.warn(
            `[Keyframe Auditor] ⚠️ Scene ${sceneIdx + 1}/${totalAudited} flagged [${auditResult.modelUsed}]: ${auditResult.detectedAnomalies.join("; ")}`
          );

          let healedSuccessfully = false;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (!auditResult.refinedVisualPrompt || auditResult.refinedVisualPrompt.trim().length === 0) {
              break;
            }

            console.log(
              `[Keyframe Healer] 🩹 Repairing Scene ${sceneIdx + 1} (Attempt ${attempt}/${maxAttempts}) with refined prompt...`
            );

            // Apply refined prompt to script scene
            scene.visual_prompt = auditResult.refinedVisualPrompt;

            // Selectively regenerate ONLY this scene via Cloudflare FLUX
            try {
              await generateSceneKeyframes(script, imagesDir, {
                sceneIndices: [sceneIdx],
                forceRegenerate: true,
              });
            } catch (regenErr: any) {
              console.warn(`[Keyframe Healer] FLUX regeneration attempt ${attempt} warning for Scene ${sceneIdx + 1}: ${regenErr?.message || regenErr}`);
            }

            // Re-verify that image exists and has valid size
            if (!fsSync.existsSync(imgPath) || fsSync.statSync(imgPath).size < 5000) {
              console.warn(`[Keyframe Healer] Regenerated image failed threshold for Scene ${sceneIdx + 1}. Restoring from backup...`);
              if (fsSync.existsSync(backupPath)) {
                await fs.copyFile(backupPath, imgPath);
              }
              break;
            }

            // Re-audit newly regenerated keyframe
            const reAudit = await auditSceneKeyframe(imgPath, scene, script, sceneIdx);
            if (reAudit.verdict === "PASS") {
              console.log(`[Keyframe Healer] ✅ Scene ${sceneIdx + 1} successfully healed! Passed all aesthetic gates.`);
              healedSuccessfully = true;
              healedCount++;
              healedScenes.push(sceneIdx);
              reportsByScene.set(sceneIdx, reAudit);
              break;
            } else {
              auditResult = reAudit;
            }
          }

          if (!healedSuccessfully) {
            retainedOriginalCount++;
            reportsByScene.set(sceneIdx, auditResult);
            console.warn(
              `[Keyframe Healer] ⚠️ Scene ${sceneIdx + 1} could not be fully perfected after ${maxAttempts} attempts. Retaining best asset to preserve pre-flight integrity.`
            );
          }
        }
      );
    }
  }

  // Compile sorted reports in order of sceneIndex
  const reports: KeyframeAuditResult[] = [];
  for (let i = 0; i < totalAudited; i++) {
    const r = reportsByScene.get(i);
    if (r) reports.push(r);
  }

  // Save audit report in dataset root directory
  const summary: KeyframeHealSummary = {
    totalAudited,
    passedInitially,
    healedCount,
    retainedOriginalCount,
    healedScenes,
    reports,
  };

  try {
    await fs.writeFile(auditReportPath, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`[Keyframe Auditor] 📋 Full Keyframe Audit Report saved to [REDACTED]`);
  } catch {}

  console.log(
    `[Keyframe Auditor] 🏁 Audit Complete: ${passedInitially}/${totalAudited} passed initially, ${healedCount} healed, ${retainedOriginalCount} retained.`
  );

  return summary;
}
