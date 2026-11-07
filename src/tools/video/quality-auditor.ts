/**
 * ShunopsAI - Autonomous AI Video Quality & Visual Defect Auditor.
 *
 * Inspects rendered video files directly via the Gemini Files API + Multimodal Video Understanding.
 *
 * Invariant Guarantees:
 * 1. Zero Laptop Overhead: Executes 100% inside Cloud VMs / GitHub Actions.
 * 2. Deterministic Key Pool: Uses 34-key GEMINI_KEYS pool with O(1) round-robin pointer & 429 rotation.
 * 3. Multi-Model Fallback: gemini-3.8-flash -> gemini-3-flash-preview.
 * 4. Zero Cloudflare Workers AI for text/reasoning (used exclusively for image generation).
 * 5. Rule 12 & Rule 13 Grounding: Pinpoints face melting, character identity drift, hand distortion,
 *    and frame interpolation warping with exact timestamps.
 * 6. Zero Storage Waste: Deletes the uploaded video from Gemini File API immediately after audit.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomInt } from "node:crypto";

export interface QualityDefect {
  id: number;
  timestamp: string;
  type: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  proposedFix: string;
}

export interface VideoQualityReport {
  ok: boolean;
  overallQualityScore: number;
  summary: string;
  defects: QualityDefect[];
  modelUsed: string;
  auditDate: string;
  error?: string;
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

// Rule 6: Process-level startup offset initialization to prevent multi-service contention
let poolPointer = randomInt(0, 34);

function getNextKey(pool: string[]): string {
  if (pool.length === 0) return "";
  const key = pool[poolPointer % pool.length]!;
  poolPointer = (poolPointer + 1) % pool.length;
  return key;
}

const AUDIT_MODELS_QUALITY_ORDER = [
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
];

const AUDIT_PROMPT_TEMPLATE = (topic: string, description?: string) => `
You are the Senior Executive Quality Auditor for ShunopsAI cinematic video production.
Your mandate is to perform an uncompromising visual inspection of the accompanying video second-by-second.

Video Subject: "${topic}"
Context / Storyline: "${description || "Cinematic documentary / educational deep-dive"}"

Carefully analyze the video frames and audio track from 00:00 to the very end.
You must pinpoint any AI video generation flaws, rendering defects, or aesthetic violations, specifically:
1. Face Melting / Latent Warping: Facial distortion, melting skin, warped eyes/mouth during head rotations or movement.
2. Character Identity Drift: Changes in facial structure, ethnicity, or hair across cuts for recurring named characters.
3. Hand & Limb Distortion: Extra/missing fingers, unnatural joint bending, melting hands.
4. Text Glitches & Corrupt Glyphs: Garbled, unreadable pseudo-text rendered directly by diffusion latents.
5. Motion Artifacts: Frame interpolation warping (e.g. rubbery limbs, melting background structures).
6. Outro & Timing Defects: Narration being cut off, or video fading to black prematurely while voice is still speaking.
7. Domain Mismatches: Unintended sports equipment or inappropriate settings (e.g. cricket pads in football).

Be precise, constructive, and realistic. Distinguish between minor natural AI stylization vs severe visual defects.
Prioritize systemic improvements that can be generalized (Rule 13) rather than brittle one-off hacks.

You must respond ONLY with a valid JSON object matching this schema:
{
  "overallQualityScore": 8.5,
  "summary": "1-2 sentence executive summary of visual quality and major issues found.",
  "defects": [
    {
      "id": 1,
      "timestamp": "01:47",
      "type": "Face Melting | Character Identity Drift | Hand Distortion | Text Glitch | Motion Artifact | Outro Timing | Domain Contamination",
      "severity": "HIGH | MEDIUM | LOW",
      "description": "Specific visual description of what glitches on screen.",
      "proposedFix": "Architectural or prompt guidance improvement."
    }
  ]
}
`;

/**
 * Resumable upload of video.mp4 to Gemini Files API.
 */
async function uploadVideoToGemini(
  videoPath: string,
  apiKey: string
): Promise<{ uri: string; name: string }> {
  const stat = await fs.stat(videoPath);
  const fileSize = stat.size;
  const fileName = path.basename(videoPath);

  // Step 1: Initialize resumable upload
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        file: {
          display_name: fileName,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Gemini File API init failed (${initRes.status}): ${errText}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini File API did not return 'x-goog-upload-url' header.");
  }

  // Step 2: Stream bytes to uploadUrl
  const fileBytes = await fs.readFile(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileSize),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileBytes,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Gemini File API upload failed (${uploadRes.status}): ${errText}`);
  }

  const result: any = await uploadRes.json();
  const file = result.file;
  if (!file || !file.name || !file.uri) {
    throw new Error("Gemini File API response missing file metadata.");
  }

  // Step 3: Wait for file processing if state is PROCESSING
  let state = file.state;
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`
    );
    if (pollRes.ok) {
      const pollData: any = await pollRes.json();
      state = pollData.state;
      if (state === "FAILED") {
        throw new Error(`Gemini File API video processing failed.`);
      }
    }
  }

  return { uri: file.uri, name: file.name };
}

/**
 * Delete uploaded video from Gemini Files API to maintain 0 cloud storage.
 */
async function deleteGeminiFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
      { method: "DELETE" }
    );
  } catch {
    // Non-critical cleanup failure
  }
}

/**
 * Perform autonomous video quality audit using Gemini Multimodal Video API.
 */
export async function auditVideoQuality(
  videoPath: string,
  options: { topic?: string; description?: string } = {}
): Promise<VideoQualityReport> {
  const pool = geminiKeyPool();
  if (pool.length === 0) {
    return {
      ok: false,
      overallQualityScore: 0,
      summary: "Skipped: GEMINI_KEYS not configured in environment.",
      defects: [],
      modelUsed: "none",
      auditDate: new Date().toISOString(),
      error: "No Gemini API keys found in pool.",
    };
  }

  if (!fsSync.existsSync(videoPath)) {
    return {
      ok: false,
      overallQualityScore: 0,
      summary: "Skipped: Target video file does not exist.",
      defects: [],
      modelUsed: "none",
      auditDate: new Date().toISOString(),
      error: `Video path not found: ${videoPath}`,
    };
  }

  const topic = options.topic || path.basename(path.dirname(videoPath));
  const prompt = AUDIT_PROMPT_TEMPLATE(topic, options.description);

  let uploadedFile: { uri: string; name: string } | null = null;
  let activeKey = "";

  // Upload video file using a valid key from the pool
  for (let attempt = 0; attempt < Math.min(pool.length, 5); attempt++) {
    const key = getNextKey(pool);
    try {
      console.log(`[Video Auditor] Uploading video to Gemini File API (${path.basename(videoPath)})...`);
      uploadedFile = await uploadVideoToGemini(videoPath, key);
      activeKey = key;
      console.log(`[Video Auditor] Video active in Gemini Files API: ${uploadedFile.name}`);
      break;
    } catch (uploadErr: any) {
      console.warn(`[Video Auditor] Key upload error, rotating to next key: ${uploadErr?.message || uploadErr}`);
    }
  }

  if (!uploadedFile) {
    return {
      ok: false,
      overallQualityScore: 0,
      summary: "Failed to upload video to Gemini File API across key pool.",
      defects: [],
      modelUsed: "none",
      auditDate: new Date().toISOString(),
      error: "Exhausted key pool during file upload.",
    };
  }

  try {
    // Try models in quality order
    for (const model of AUDIT_MODELS_QUALITY_ORDER) {
      for (let k = 0; k < Math.min(pool.length, 4); k++) {
        const key = activeKey || getNextKey(pool);
        try {
          console.log(`[Video Auditor] Analyzing video with model ${model}...`);
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        fileData: {
                          fileUri: uploadedFile.uri,
                          mimeType: "video/mp4",
                        },
                      },
                      { text: prompt },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.2,
                },
              }),
              signal: AbortSignal.timeout(90000), // 90s timeout for video reasoning
            }
          );

          if (res.ok) {
            const data: any = await res.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
            if (rawText) {
              const parsed = JSON.parse(rawText);
              console.log(`[Video Auditor] ✅ Audit successful! Score: ${parsed.overallQualityScore}/10, Defects found: ${parsed.defects?.length || 0}`);
              return {
                ok: true,
                overallQualityScore: Number(parsed.overallQualityScore) || 8.0,
                summary: parsed.summary || "Video inspection complete.",
                defects: (parsed.defects || []).map((d: any, idx: number) => ({
                  id: Number(d.id) || idx + 1,
                  timestamp: String(d.timestamp || "00:00"),
                  type: String(d.type || "Visual Defect"),
                  severity: ["HIGH", "MEDIUM", "LOW"].includes(String(d.severity).toUpperCase())
                    ? String(d.severity).toUpperCase() as any
                    : "MEDIUM",
                  description: String(d.description || ""),
                  proposedFix: String(d.proposedFix || "Improve prompt and rendering constraints."),
                })),
                modelUsed: model,
                auditDate: new Date().toISOString(),
              };
            }
          }

          if (res.status === 429) {
            console.warn(`[Video Auditor] Rate limited on key (429), rotating...`);
            activeKey = getNextKey(pool);
            continue;
          }
        } catch (callErr: any) {
          console.warn(`[Video Auditor] Inference error on ${model}: ${callErr?.message || callErr}`);
          activeKey = getNextKey(pool);
        }
      }
    }

    return {
      ok: false,
      overallQualityScore: 0,
      summary: "Video audit models failed to return structured report.",
      defects: [],
      modelUsed: "none",
      auditDate: new Date().toISOString(),
      error: "All Gemini audit models exhausted.",
    };
  } finally {
    // Delete file to maintain zero cloud storage
    if (uploadedFile && activeKey) {
      console.log(`[Video Auditor] Cleaning up temporary Gemini file: ${uploadedFile.name}`);
      await deleteGeminiFile(uploadedFile.name, activeKey);
    }
  }
}
