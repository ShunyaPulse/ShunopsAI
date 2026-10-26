/**
 * ShunopsAI - Dynamic On-Demand Acoustic SFX Search Engine
 *
 * Solves the "millions of cases" problem:
 * Instead of relying on a tiny static list of sound effects, this engine
 * dynamically queries Wikimedia Commons' open audio repository (over 500,000+
 * public domain and CC0 recordings) to fetch the exact sound effect on demand
 * (e.g. "falcon heavy rocket launch", "steam train whistle", "cricket bat strike",
 * "crowd cheering", "jet flyby roar", "thunderclap").
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

/**
 * Searches and downloads an authentic public domain SFX for any real-world query.
 * Scales dynamically to millions of arbitrary topics.
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

  // Check local static SFX asset library first if available
  const localAsset = path.resolve(process.cwd(), "src", "assets", "audio", "sfx", `${query.toLowerCase().replace(/[^a-z0-9]/g, "_")}.ogg`);
  if (fsSync.existsSync(localAsset)) {
    await fs.copyFile(localAsset, outPath);
    return outPath;
  }

  // Dynamic Open-Source Cloud Search
  try {
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=${encodeURIComponent(query + " filetype:audio")}&srlimit=4`;
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
      if (buf.length < 5000) continue;

      await fs.writeFile(outPath, buf);
      console.log(`🔊 [Dynamic SFX Fetched] "${query}" -> ${item.title} (${(buf.length / 1024).toFixed(1)} KB)`);
      return outPath;
    }
  } catch (err: any) {
    console.warn(`[Dynamic SFX] Fetch failed for "${query}":`, err?.message || err);
  }

  return null;
}
