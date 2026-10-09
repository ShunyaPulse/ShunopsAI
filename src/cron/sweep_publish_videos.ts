/**
 * ShunopsAI - Cloud Video Publish Sweeper (Decoupled Cloud Architecture).
 *
 * Kaggle GPU renders take hours on free cloud GPUs. Instead of forcing a user's
 * local laptop to run background processes or having GitHub Actions waste 40+ minutes
 * waiting in a single workflow, this sweeper runs periodically in CI / Cloud:
 *
 *   1. Reads kernel statuses for all recent video-render kernels (fast, ~2s per kernel).
 *   2. If a kernel is still RUNNING or QUEUED, immediately skips it.
 *   3. If COMPLETE, checks distributed state (Redis / .auditor-state.json) to ensure
 *      this specific job was not already published (runs exactly once).
 *   4. Downloads artifacts in CI, publishes to YouTube (Private), and sends review alerts.
 *   5. Zero laptop dependency; runs completely in cloud infrastructure.
 */

import "dotenv/config";
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import { Redis } from "ioredis";
import { manageKaggle, publishJobToYouTube, kaggle } from "../tools/video.js";
import { sendVideoReadyEmail, sendIncidentAlert } from "../tools/notifier.js";

const STATE_FILE = path.resolve(process.cwd(), ".auditor-state.json");
const USER = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
const JOBS_DIR = path.resolve(process.cwd(), "jobs");

function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  if (!redisUrl && !redisHost) return null;
  try {
    return redisUrl
      ? new Redis(redisUrl, { connectTimeout: 3000, lazyConnect: true, maxRetriesPerRequest: 1 })
      : new Redis({
          host: redisHost || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 3000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
  } catch {
    return null;
  }
}

async function isJobAlreadyPublished(jobId: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.connect();
      const val = await redis.get(`shunops:video:published:${jobId}`);
      await redis.quit();
      if (val) return true;
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  // Local fallback state check
  try {
    if (fsSync.existsSync(STATE_FILE)) {
      const data = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
      if (data?.publishedVideos?.[jobId]) return true;
    }
  } catch {}

  return false;
}

async function markJobAsPublished(jobId: string, videoId: string, videoUrl: string): Promise<void> {
  const record = {
    jobId,
    videoId,
    videoUrl,
    publishedAt: new Date().toISOString(),
  };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.connect();
      await redis.set(`shunops:video:published:${jobId}`, JSON.stringify(record));
      await redis.quit();
    } catch {
      try {
        redis.disconnect();
      } catch {}
    }
  }

  try {
    let data: any = {};
    if (fsSync.existsSync(STATE_FILE)) {
      data = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
    }
    data.publishedVideos = data.publishedVideos || {};
    data.publishedVideos[jobId] = record;
    await fs.writeFile(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

export async function sweepAndPublishVideos(): Promise<{ checked: number; published: number }> {
  console.log(`\n=======================================================`);
  console.log(`🛰️ [Cloud Sweeper] Scanning Kaggle Video Kernels...`);
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  console.log(`=======================================================\n`);

  let listingOutput = "";
  try {
    listingOutput = await kaggle(["kernels", "list", "--mine", "--page-size", "25"]);
  } catch (err: any) {
    console.error("[Cloud Sweeper] Failed to list Kaggle kernels:", err ? "[REDACTED]" : "none");
    return { checked: 0, published: 0 };
  }

  // Parse kernel references that match video-render-*
  const lines = listingOutput.split("\n");
  const videoKernels: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(new RegExp(`${USER}/video-render-[a-z0-9]+`, "i"));
    if (match) {
      videoKernels.push(match[0]);
    }
  }

  console.log(`[Cloud Sweeper] Found ${videoKernels.length} video-render kernel(s) in account "[REDACTED]".`);

  let publishedCount = 0;

  for (const kernelRef of videoKernels) {
    const jobId = kernelRef.replace(new RegExp(`^${USER}/video-render-`), "");
    console.log(`\n[Cloud Sweeper] Inspecting job: ${jobId}...`);

    // 1. Check deduplication state
    const alreadyPublished = await isJobAlreadyPublished(jobId);
    if (alreadyPublished) {
      console.log(`[Cloud Sweeper] ⏩ Job "${jobId}" is already published to YouTube. Skipping.`);
      continue;
    }

    // 2. Query status (cheap, 2 seconds)
    let status = "";
    try {
      status = await manageKaggle("status", kernelRef);
    } catch {
      console.warn(`[Cloud Sweeper] Transient error reading status for ${kernelRef}. Skipping.`);
      continue;
    }

    const upperStatus = status.toUpperCase();
    const displayStatus = upperStatus.includes("RUNNING")
      ? "RUNNING"
      : upperStatus.includes("QUEUED")
      ? "QUEUED"
      : upperStatus.includes("COMPLETE")
      ? "COMPLETE"
      : upperStatus.includes("ERROR") || upperStatus.includes("FAILED")
      ? "ERROR"
      : "UNKNOWN";
    console.log(`[Cloud Sweeper] Status: ${displayStatus}`);

    if (upperStatus.includes("RUNNING") || upperStatus.includes("QUEUED")) {
      console.log(`[Cloud Sweeper] ⏳ Kernel is actively rendering on Kaggle GPU. Skipping.`);
      continue;
    }

    if (upperStatus.includes("ERROR") || upperStatus.includes("FAILED") || /has status ["']?error["']?/i.test(status)) {
      console.error(`[Cloud Sweeper] ❌ Kernel finished with error: [REDACTED]`);
      await sendIncidentAlert({
        title: "Kaggle Video Kernel Failed",
        service: "Kaggle GPU Pipeline",
        status: "DOWN",
        details: `Kaggle video render failed for job ${jobId}. Status: ${displayStatus}`,
      }).catch(() => null);
      continue;
    }

    if (!upperStatus.includes("COMPLETE")) {
      console.log(`[Cloud Sweeper] Unrecognized status for job ${jobId}. Skipping.`);
      continue;
    }

    // 3. Kernel is COMPLETE and NOT published! Process download and publish.
    console.log(`[Cloud Sweeper] 🎯 Job ${jobId} is COMPLETE and pending publication!`);
    const destDir = path.join(JOBS_DIR, jobId, "output");
    await fs.mkdir(destDir, { recursive: true });

    console.log(`[Cloud Sweeper] Downloading output artifacts to ${destDir}...`);
    try {
      await manageKaggle("output", kernelRef);
    } catch (e: any) {
      console.error("[Cloud Sweeper] Failed to download output for job " + jobId + ": " + (e?.message ? "[REDACTED]" : "none"));
      continue;
    }

    const videoFile = path.join(destDir, "video.mp4");
    if (!fsSync.existsSync(videoFile) || fsSync.statSync(videoFile).size === 0) {
      console.error(`[Cloud Sweeper] video.mp4 is missing or empty at ${videoFile}. Skipping.`);
      continue;
    }

    console.log(`[Cloud Sweeper] Verified video.mp4 (${(fsSync.statSync(videoFile).size / 1024 / 1024).toFixed(1)} MB). Uploading to YouTube (Private)...`);
    try {
      const ytRaw = await publishJobToYouTube(destDir, "private");
      const yt = JSON.parse(ytRaw);
      if (!yt.ok || !yt.videoUrl) {
        throw new Error(yt.error || ytRaw);
      }

      console.log(`[Cloud Sweeper] ✅ Published to YouTube: ${yt.videoUrl}`);
      await markJobAsPublished(jobId, yt.videoId || "unknown", yt.videoUrl);

      // Read metadata for notification email
      let meta: any = {};
      const metaPath = path.join(destDir, "meta.json");
      if (fsSync.existsSync(metaPath)) {
        try {
          meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
        } catch {}
      }

      await sendVideoReadyEmail({
        title: yt.title,
        videoUrl: yt.videoUrl,
        studioUrl: yt.studioUrl,
        topic: meta.title || "Autonomous Cloud Video",
        category: meta.category || "Education & Technology",
        valueHook: meta.description || meta.value_hook || "Autonomous video render complete.",
        thumbnailPath: ["thumbnail.jpg", "thumbnail.png", "frame_30s.jpg"]
          .map((f) => path.join(destDir, f))
          .find((f) => fsSync.existsSync(f)),
        chapters: meta.chapters,
        durationSec: meta.duration_sec,
        engine: meta.engine,
      });

      publishedCount++;
    } catch (publishErr: any) {
      console.error(`[Cloud Sweeper] YouTube publishing failed:`, publishErr?.message ? "[REDACTED]" : "none");
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 [Cloud Sweeper] Sweep completed. Processed ${videoKernels.length} kernels, published ${publishedCount} new video(s).`);
  console.log(`=======================================================\n`);

  return { checked: videoKernels.length, published: publishedCount };
}

const isCLI = process.argv[1]?.endsWith("sweep_publish_videos.ts") || process.argv[1]?.endsWith("sweep_publish_videos.js");
if (isCLI) {
  sweepAndPublishVideos().then(() => process.exit(0)).catch((err) => {
    console.error("[Cloud Sweeper Error]:", err ? "[REDACTED]" : "none");
    process.exit(1);
  });
}

