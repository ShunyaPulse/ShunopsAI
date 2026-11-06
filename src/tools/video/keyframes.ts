import { auditDiffusionPromptWithMammoth } from "../../ai/decisions.js";
import { isCricketTopic } from "./cricketTemplate.js";
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
export function buildKeyframePrompt(
  scPrompt: string,
  visualBible?: VideoScript["visual_bible"],
  domain: string = "general",
  videoTitle: string = ""
): string {
  const parts: string[] = [];
  const fullContext = `${videoTitle} ${visualBible?.realWorldGrounding || ""} ${scPrompt}`.toLowerCase();

  // 1. Graphic / Outro / Abstract Card Detection (GEMINI.md Rule 12 & 13)
  const isGraphicOrOutro = /\b(outro|clean,?\s*dark screen|dark screen|black screen|fade to black|geometric (?:micro-)?pattern|title card|end screen|credits|blank background|minimalist background)\b/i.test(scPrompt);

  // 2. Crowd-only Scene Detection (avoids injecting player character DNA into stadium crowds, while preserving empty stadiums)
  const isCrowdOnly =
    /\b(crowd|audience|spectator|spectators|fans in the stands|packed stands)\b/i.test(scPrompt) &&
    !/\b(empty|seats are|silence)\b/i.test(scPrompt) &&
    !/\b(player|athlete|figure|silhouette|ronaldo|striker|man|person|captain|him)\b/i.test(scPrompt);

  // 3. Human Presence Detection — ONLY inject character DNA or sports uniforms when humans/athletes are present
  const humanPresenceKeywords = /\b(people|person|personnel|engineer|scientist|analyst|executive|researcher|worker|man|woman|athlete|player|team|humans|characters|character|figure|figures|silhouette|hands|face|group|suit|attire|uniform|bunny suit|cleanroom suit|delegate|official|director|ceo|chairman|employee|staff|journalist|reporter|professor|student|astronaut|cosmonaut|pilot|soldier|officer|diplomat|batsman|bowler|fielder|wicketkeeper|batter|cricketer)\b/i;
  const hasHuman = humanPresenceKeywords.test(scPrompt);

  // Character Visual DNA lock — ONLY inject when scene actually depicts individual humans/athletes and is NOT an outro card or crowd-only shot
  if (visualBible?.characterGrammar && hasHuman && !isGraphicOrOutro && !isCrowdOnly) {
    let sanitizedGrammar = visualBible.characterGrammar.slice(0, 500);
    sanitizedGrammar = sanitizedGrammar.replace(/\b(Hero Batter|Hero Cricketer|Hero Bowler|Hero Player|Hero Athlete)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*:/g, "$1:");
    parts.push(sanitizedGrammar);
  }

  // 4. Scene specific visual prompt normalization
  let sanitizedScPrompt = scPrompt
    .replace(/\braising (?:his )?bat with both hands\b/gi, "raising a single bat aloft in celebration")
    .replace(/\bholding (?:his )?bat in both hands\b/gi, "holding a single bat with both hands on the handle")
    // Replace extreme motion-blur phrasing that creates broken blurry keyframes
    .replace(/\b(?:abstract shot of\s+)?blurred\s+[^.]*?\s*moving rapidly\b/gi, "atmospheric celebratory stadium illumination with dynamic lighting, confetti, and stadium floodlights in sharp focus")
    .replace(/\brapid motion blur\b/gi, "high shutter speed cinematic clarity")
    .replace(/\babstract motion blur\b/gi, "crisp cinematic optical depth");

  // Association Football (Soccer) vs American Football Disambiguation:
  // FLUX / Diffusion models default bare "football" or "leather football" to American football with laces.
  const isFootball = /\b(football|soccer|fifa|uefa|ronaldo|cristiano|messi|neymar|mbappe|haaland|striker|goalkeeper|premier league|la liga|serie a|champions league)\b/i.test(fullContext);
  if (isFootball) {
    sanitizedScPrompt = sanitizedScPrompt.replace(
      /\b(?:weathered\s+|professional\s+|leather\s+)?football(s)?\b/gi,
      (_match, plural) =>
        plural
          ? "spherical association soccer match balls with classic black-and-white pentagonal leather panels (strictly zero rugby balls, strictly zero American footballs)"
          : "spherical association soccer match ball with classic black-and-white pentagonal leather panels (strictly zero rugby balls, strictly zero American football)"
    );
  }

  parts.push(sanitizedScPrompt);

  // 5. Domain & Geometry Guards (GEMINI.md Rule 12 & 13)
  if (isGraphicOrOutro) {
    // Pure minimalist aesthetic for outro cards — strictly ZERO sports gear, players, or basketball courts
    parts.push(
      "Minimalist text-free dark cinematic gradient, subtle dark vignette, clean textured backdrop, strictly zero humans, zero players, zero jerseys, zero sports equipment, zero text, zero logos, zero watermarks"
    );
  } else {
    // Determine specific sport from OVERALL VIDEO TOPIC (never from isolated scene words)
    const isCricket =
      (domain === "cricket" || domain.includes("cricket")) ||
      (domain === "sports" && isCricketTopic(videoTitle || "", visualBible?.realWorldGrounding));

    if (isCricket) {
      parts.push(
        "Strict singular cricket geometry: solitary single set of three upright wooden stumps on the pitch (strictly zero duplicate wickets, zero extra stumps), single solitary English willow bat (never two bats, never a bat in each hand, zero floating bats)"
      );
      if (hasHuman && !isCrowdOnly) {
        parts.push(
          "Exactly one active primary player in the foreground matching the action. Solid plain jersey with zero text, zero printed player names, zero numbers on fabric"
        );
      }
    } else if (isFootball) {
      if (hasHuman && !isCrowdOnly) {
        parts.push(
          "Authentic European football (soccer) athletic apparel, solid plain competition jersey, soccer shorts and football socks, molded grass soccer studs (strictly zero cricket gear, zero cricket pads, zero bats, zero American football gear, zero rugby balls, zero printed letters, zero numbers on shirts)"
        );
      } else if (isCrowdOnly) {
        parts.push(
          "Vast passionate football stadium crowd celebrating in the stands, dynamic stadium floodlights, softly blurred depth of field, zero legible banners, zero text"
        );
      } else {
        parts.push(
          "Authentic European association football (soccer) stadium atmosphere and venue (strictly zero cricket stumps, zero cricket bats, zero American footballs, zero basketball gear, zero text)"
        );
      }
    } else if (domain === "sports" && hasHuman && !isCrowdOnly) {
      parts.push(
        "Authentic professional athletic equipment, solid plain competition team kit, zero printed letters, zero numbers on shirts, zero digital scoreboards, zero text"
      );
    }
  }

  // 6. Indoor / Architecture anti-signage guardrail (Eliminates hallucinated text like "SCURIET")
  const isIndoorArchitecture = /\b(trophy room|trophy gallery|gallery|vitrine|museum|hallway|tunnel|locker room|press conference|conference room|podium|stadium interior)\b/i.test(scPrompt);
  if (isIndoorArchitecture) {
    parts.push(
      "Clean unprinted minimalist architectural surfaces, plain walls, zero wall signage, zero neon letters, zero plaques, zero typography"
    );
  }

  // 7. Trophy & Metallic Objects anti-engraving guardrail (Eliminates fake inscribed glyphs)
  const isTrophy = /\b(trophy|silver cup|golden cup|award|medal)\b/i.test(scPrompt);
  if (isTrophy) {
    parts.push(
      "Completely blank unengraved polished metallic surface, pristine smooth metal reflection, zero engraved text, zero stamped letters, zero inscriptions, zero numerals"
    );
  }

  // 8. Cinematic optical aesthetic (Positive optical descriptors)
  parts.push(
    "Cinematic 35mm photography, photorealistic, sharp focus, volumetric lighting, authentic tactile textures, completely unbranded clean surfaces, zero text, zero watermarks"
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
        .replace(/\b(scoreboard|leaderboard|digital timer|score ticker|giant screen|stadium screen)\b/gi, "blurred atmospheric background lighting")
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
  // 1st Fallback: ShunyaPulse Account (absorbs load first)
  const cfFallback1Id = process.env.SHUNYAPULSE_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID_3;
  const cfFallback1Token = process.env.SHUNYAPULSE_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN_3;
  if (cfFallback1Id && cfFallback1Token) {
    if (!accountsToTry.some((a) => a.id === cfFallback1Id)) {
      accountsToTry.push({
        id: cfFallback1Id,
        token: cfFallback1Token,
      });
    }
  }

  // 2nd Fallback: SaralGati Production Account (last resort reserve)
  if (process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID && process.env.SARALGATI_CLOUDFLARE_API_TOKEN) {
    if (!accountsToTry.some((a) => a.id === process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID)) {
      accountsToTry.push({
        id: process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID,
        token: process.env.SARALGATI_CLOUDFLARE_API_TOKEN,
      });
    }
  }
  const cf3Id = process.env.SHUNYAPULSE_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID_3;
  const cf3Token = process.env.SHUNYAPULSE_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN_3;
  if (cf3Id && cf3Token) {
    if (!accountsToTry.some((a) => a.id === cf3Id)) {
      accountsToTry.push({
        id: cf3Id,
        token: cf3Token,
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
  options?: { accountId?: string; apiToken?: string; forceRegenerate?: boolean; sceneIndices?: number[] }
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

    // If specific scene indices requested, skip others
    if (options?.sceneIndices && !options.sceneIndices.includes(i)) {
      successCount++;
      continue;
    }

    const outPng = path.join(imagesDir, `scene_${String(i).padStart(3, "0")}.png`);
    const remoteGcsPath = `video-vault/${topicHash}/images/scene_${String(i).padStart(3, "0")}.png`;

    if (!options?.forceRegenerate) {
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
    }

    const prompt = await sanitizeZeroDiffusionText(
      buildKeyframePrompt(sc.visual_prompt, script.visual_bible, script.domain, script.title)
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
