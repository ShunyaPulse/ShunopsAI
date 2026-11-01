/**
 * ShunopsAI - Pre-Flight Verification Gate
 * Enforces strict pre-upload validation of all audio, keyframes, and metadata before
 * dispatching datasets to Kaggle GPU. Guarantees 0 empty/broken dataset runs.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

export interface PreFlightCheckOptions {
  requireAudio?: boolean;
  requireKeyframes?: boolean;
  requireBgm?: boolean;
  minAudioBytes?: number;
  minImageBytes?: number;
  allowSdxlFallback?: boolean;
}

export interface PreFlightResult {
  ok: boolean;
  audioCount: number;
  keyframeCount: number;
  hasBgm: boolean;
  totalScenes: number;
  errors: string[];
  sdxlFallbackActive?: boolean;
}

export async function verifyPreFlightDataset(
  dsDir: string,
  totalScenes: number,
  options: PreFlightCheckOptions = {}
): Promise<PreFlightResult> {
  const requireAudio = options.requireAudio ?? true;
  const requireKeyframes = options.requireKeyframes ?? true;
  const requireBgm = options.requireBgm ?? true;
  const minAudioBytes = options.minAudioBytes ?? 500;
  const minImageBytes = options.minImageBytes ?? 5000;

  const audioDir = path.join(dsDir, "audio");
  const imagesDir = path.join(dsDir, "images");
  const errors: string[] = [];

  let audioCount = 0;
  let keyframeCount = 0;

  // 1. Scene Asset Checks
  for (let i = 0; i < totalScenes; i++) {
    // Audio check
    const expectedAudio = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);
    try {
      const aStat = await fs.stat(expectedAudio);
      if (aStat.size >= minAudioBytes) {
        audioCount++;
      } else {
        errors.push(`Scene ${i + 1} audio too small (${aStat.size} bytes < ${minAudioBytes})`);
      }
    } catch {
      errors.push(`Scene ${i + 1} audio file missing: a${String(i).padStart(3, "0")}.mp3`);
    }

    // Keyframe Image check
    const expectedPng = path.join(imagesDir, `scene_${String(i).padStart(3, "0")}.png`);
    try {
      const iStat = await fs.stat(expectedPng);
      if (iStat.size >= minImageBytes) {
        keyframeCount++;
      } else {
        errors.push(`Scene ${i + 1} keyframe image too small (${iStat.size} bytes < ${minImageBytes})`);
      }
    } catch {
      errors.push(`Scene ${i + 1} keyframe image missing: scene_${String(i).padStart(3, "0")}.png`);
    }
  }

  // 2. BGM Check
  const bgmOgg = path.join(audioDir, "bgm.ogg");
  const hasBgm = fsSync.existsSync(bgmOgg) && fsSync.statSync(bgmOgg).size > 5000;
  if (requireBgm && !hasBgm) {
    errors.push("Background music missing or empty: dataset/audio/bgm.ogg");
  }

  // 3. Metadata Files
  const scriptJson = path.join(dsDir, "script.json");
  if (!fsSync.existsSync(scriptJson)) {
    errors.push("Missing script.json in dataset root");
  }

  // Dual-Mode Governance Policy:
  // In user-interactive mode (default): 100% FLUX keyframes required (requireKeyframes=true, zero quality compromise).
  // In autonomous/unattended cron mode: if FLUX experienced cloud outages, allow fallback to Kaggle GPU SDXL-Lightning
  const isImageOnlyError = errors.every(err => err.includes("keyframe image"));
  const allowSdxl = options.allowSdxlFallback ?? false;
  const sdxlFallbackActive = allowSdxl && isImageOnlyError && keyframeCount < totalScenes;

  const effectiveErrors = sdxlFallbackActive ? [] : errors;

  const ok = (!requireAudio || audioCount === totalScenes) &&
             (sdxlFallbackActive || !requireKeyframes || keyframeCount === totalScenes) &&
             (!requireBgm || hasBgm) &&
             effectiveErrors.length === 0;

  return {
    ok,
    audioCount,
    keyframeCount,
    hasBgm,
    totalScenes,
    errors: effectiveErrors,
    sdxlFallbackActive,
  };
}

