/**
 * ShunopsAI - Dynamic On-Demand Acoustic SFX Search Engine with 4-Tier Fallback Cascade
 *
 * Solves the "millions of cases" problem with bulletproof resilience:
 *   Tier 1: High-precision Semantic Cloud Search (Wikimedia Commons 500k+ CC0 audio archive)
 *   Tier 2: Broad Keyword Semantic Retry (Simplified core noun search if full prompt returns 0)
 *   Tier 3: Local Curated Core Sound Bank (Matches offline static assets in src/assets/audio/sfx/)
 *   Tier 4: Graceful Non-Blocking Pass-Through (Never fails/crashes video rendering on missing sound)
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const USER_AGENT = "ShunopsAI/1.0 (https://github.com/ShunyaPulse/ShunopsAI; shunyapulse42@gmail.com)";

export interface SFXMatch {
  query: string;
  title: string;
  filePath: string;
  durationHint?: number;
}

async function getAudioDirectUrl(fileTitle: string): Promise<{ url: string; size: number } | null> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|mime&titles=${encodeURIComponent(fileTitle)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const pages = data.query?.pages || {};
    for (const pid of Object.keys(pages)) {
      const info = pages[pid]?.imageinfo?.[0];
      if (info?.url) {
        return { url: info.url, size: Number(info.size) || 0 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function queryWikimediaAudio(searchQuery: string): Promise<Buffer | null> {
  try {
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=${encodeURIComponent(searchQuery + " filetype:audio")}&srlimit=4`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const results = data.query?.search || [];

    for (const item of results) {
      const audioInfo = await getAudioDirectUrl(item.title);
      if (!audioInfo || !audioInfo.url) continue;

      // Filter: SFX should be concise (less than 5MB to prevent long musical movements)
      if (audioInfo.size > 5 * 1024 * 1024 || audioInfo.size < 5000) continue;

      const audioRes = await fetch(audioInfo.url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (!audioRes.ok) continue;

      const buf = Buffer.from(await audioRes.arrayBuffer());
      if (buf.length >= 5000) {
        return buf;
      }
    }
  } catch {}
  return null;
}

const CORE_SFX_CLOUD_URLS: Record<string, string> = {
  applause: "https://upload.wikimedia.org/wikipedia/commons/6/6d/277021_sandermotions_applause-2.wav",
  thunder: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Thunder_01.ogg",
  wind_whoosh: "https://upload.wikimedia.org/wikipedia/commons/3/30/Wind_sound_effect.ogg",
  chime: "https://upload.wikimedia.org/wikipedia/commons/a/ae/Church_bell_sound.ogg",
};

/**
 * Cloud-Streamed Core SFX Fallback (Tier 3) - Zero Laptop Storage
 */
async function streamCloudFallbackSFX(query: string): Promise<Buffer | null> {
  const q = query.toLowerCase();
  let url: string | null = null;
  if (q.includes("applause") || q.includes("cheer") || q.includes("clap") || q.includes("crowd")) {
    url = CORE_SFX_CLOUD_URLS.applause ?? null;
  } else if (q.includes("thunder") || q.includes("storm") || q.includes("lightning") || q.includes("rain")) {
    url = CORE_SFX_CLOUD_URLS.thunder ?? null;
  } else if (q.includes("wind") || q.includes("whoosh") || q.includes("flyby") || q.includes("jet") || q.includes("plane") || q.includes("roar")) {
    url = CORE_SFX_CLOUD_URLS.wind_whoosh ?? null;
  } else if (q.includes("bell") || q.includes("chime") || q.includes("ring") || q.includes("gavel") || q.includes("exam")) {
    url = CORE_SFX_CLOUD_URLS.chime ?? null;
  }

  if (url) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 2000) return buf;
      }
    } catch {}
  }
  return null;
}

/**
 * Searches and downloads an authentic public domain SFX with 4-Tier Fallback Cascade.
 * Scales dynamically to millions of arbitrary topics with zero risk of crashing rendering.
 */
export async function searchAndDownloadSFX(
  query: string,
  targetDir: string
): Promise<string | null> {
  if (!query || query.trim().length === 0) return null;

  const sfxDir = path.join(targetDir, "sfx");
  await fs.mkdir(sfxDir, { recursive: true });

  const hash = crypto.createHash("md5").update(query.toLowerCase().trim()).digest("hex").slice(0, 8);
  const outPath = path.join(sfxDir, `sfx_${hash}.ogg`);

  // Cache hit: return already fetched sound
  if (fsSync.existsSync(outPath) && fsSync.statSync(outPath).size > 1000) {
    return outPath;
  }

  // Tier 1: High-Precision Semantic Cloud Search
  console.log(`🔊 [SFX Tier 1] Searching cloud audio archive for: "${query}"...`);
  let audioBuffer = await queryWikimediaAudio(query);

  // Tier 2: Broad Keyword Semantic Retry (if full sentence/scene query was too specific)
  if (!audioBuffer) {
    const keywords = ["jet", "airplane", "applause", "cheering", "thunder", "wind", "bell", "chime", "rain", "clock", "train", "roar"];
    const foundKw = keywords.find(kw => query.toLowerCase().includes(kw));
    if (foundKw && foundKw !== query.toLowerCase().trim()) {
      console.log(`🔊 [SFX Tier 2] Retrying cloud search with core sound keyword: "${foundKw}"...`);
      audioBuffer = await queryWikimediaAudio(foundKw);
    }
  }

  // Tier 3: Cloud-Streamed Core Sound Bank Fallback
  if (!audioBuffer) {
    console.log(`🛡️ [SFX Tier 3 Fallback] Streaming core cloud sound fallback for "${query}"...`);
    audioBuffer = await streamCloudFallbackSFX(query);
  }

  // If cloud search succeeded in Tier 1, 2, or 3, save and return
  if (audioBuffer && audioBuffer.length >= 2000) {
    await fs.writeFile(outPath, audioBuffer);
    console.log(`✅ [SFX Resolved] "${query}" -> saved ${(audioBuffer.length / 1024).toFixed(1)} KB into dataset`);
    return outPath;
  }

  // Tier 4: Graceful Non-Blocking Pass-Through
  console.warn(`⚠️ [SFX Tier 4 Fallback] No cloud SFX match for "${query}". Proceeding with pure acoustic BGM + voiceover.`);
  return null;
}

