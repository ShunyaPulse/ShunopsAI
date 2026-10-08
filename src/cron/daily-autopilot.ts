import * as path from "node:path";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import "dotenv/config";

import {
  fetchGoogleTrendsIndia,
  curateBestTrendTopic,
  type CuratedTopicResult,
} from "../tools/trends.js";
import {
  startVideoJob,
  manageKaggle,
  publishJobToYouTube,
} from "../tools/video.js";
import { sendVideoReadyEmail, sendIncidentAlert } from "../tools/notifier.js";

import { isAutonomyPaused, getAutonomyStatus } from "../tools/autonomy-state.js";

function sanitizeErrorMessage(input: unknown): string {
  const raw = String(input ?? "Unknown error");

  // Redact common secret-bearing fields and long token-like strings.
  return raw
    .replace(/(api[_-]?key|token|authorization|password|secret)\s*[:=]\s*["']?[^"',\s}]+["']?/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_\-]{24,}\b/g, "[REDACTED]");
}

interface AutopilotRunResult {
  ok: boolean;
  topic?: CuratedTopicResult;
  jobId?: string;
  kernelRef?: string;
  youtubeResult?: any;
  emailSent?: boolean;
  error?: string;
}

/**
 * Polls Kaggle kernel until completion or timeout (max 180 minutes / 3 hours).
 */
async function waitForKaggleKernel(
  kernelRef: string,
  maxWaitMs = 180 * 60 * 1000,
): Promise<boolean> {
  const startTime = Date.now();
  console.log("[Autopilot] Polling Kaggle kernel [REDACTED]...");

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusOutput = await manageKaggle("status", kernelRef);
      console.log(
        `[Autopilot] ${new Date().toLocaleTimeString()} - Status: [REDACTED]`,
      );

      if (statusOutput.includes("COMPLETE")) {
        console.log(`[Autopilot] ✅ Kaggle kernel finished successfully!`);
        return true;
      }
      if (statusOutput.includes("ERROR") || statusOutput.includes("FAILED")) {
        console.error(`[Autopilot] ❌ Kaggle kernel failed with status: [REDACTED]`);
        return false;
      }
    } catch (e: any) {
      console.warn(`[Autopilot] Status check warning: ${e.message}`);
    }

    // Wait 60 seconds between polling checks
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }

  console.error(
    `[Autopilot] ❌ Timed out waiting for Kaggle kernel after ${maxWaitMs / 60000} mins`,
  );
  return false;
}

/**
 * Executes a full autonomous end-to-end cycle:
 * Trend -> Curation -> Kaggle Render -> YouTube Upload (Private) -> Email Review Alert.
 */
export async function runAutonomousCycle(): Promise<AutopilotRunResult> {
  const autonomy = await getAutonomyStatus();
  if (autonomy.paused) {
    console.log("\n=======================================================");
    console.log("⏸️ [Autopilot] Daily video cycle skipped: Autonomy & AI generation is currently PAUSED by user killswitch.");
    console.log(`Paused At: ${autonomy.pausedAt || "Unknown"} | Reason: ${autonomy.reason || "Killswitch activated"}`);
    console.log("=======================================================\n");
    return { ok: false, error: "Autonomy is paused by user killswitch." };
  }

  console.log("\n=======================================================");
  console.log(`🚀 [Autopilot] Starting Autonomous Daily Video Cycle`);
  console.log(
    `⏰ Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
  );
  console.log("=======================================================\n");

  try {
    // 1. Fetch Google Trends India Active
    console.log(
      "[Autopilot] Step 1: Fetching Google Trends India active searches...",
    );
    const trends = await fetchGoogleTrendsIndia();
    console.log(
      `[Autopilot] Discovered ${trends.length} active Indian trends.`,
    );

    // 2. Curate high-value-addition topic
    console.log(
      "[Autopilot] Step 2: Curating highest value-addition topic with Gemini...",
    );
    const curated = await curateBestTrendTopic(trends);
    console.log(`[Autopilot] 🎯 Curated Topic: "${curated.documentary_topic}"`);
    console.log(`[Autopilot] 🏷️ Category: ${curated.category}`);
    console.log(`[Autopilot] ⚡ Trend Catalyst Event: "${curated.trend_reason}"`);
    console.log(`[Autopilot] 💡 Value Hook: ${curated.value_hook}`);

    // 3. Launch Video Job on Kaggle GPU
    console.log(
      `[Autopilot] Step 3: Launching Wan2.1 + RIFE render on Kaggle T4 (${curated.target_duration_minutes} mins, Hindi)...`,
    );
    const jobLaunchOutput = await startVideoJob(
      curated.documentary_topic,
      curated.target_duration_minutes || 3,
      "Hindi",
      curated.trend_reason,
    );

    let parsedLaunch: any;
    try {
      parsedLaunch = JSON.parse(jobLaunchOutput);
    } catch {
      throw new Error(
        `Failed to parse startVideoJob result: ${jobLaunchOutput}`,
      );
    }

    const { jobId, kernel: kernelRef } = parsedLaunch;
    if (!kernelRef) {
      throw new Error(
        `No kernelRef returned by startVideoJob: ${jobLaunchOutput}`,
      );
    }
    console.log(
      `[Autopilot] Dispatched kernel: [REDACTED] (Job ID: [REDACTED])`,
    );

    // 4. Wait for Kaggle GPU execution to complete
    console.log(
      "[Autopilot] Step 4: Waiting for GPU diffusion & ffmpeg mastering to complete...",
    );
    const success = await waitForKaggleKernel(kernelRef);
    if (!success) {
      return {
        ok: false,
        topic: curated,
        jobId,
        kernelRef,
        error: "Kaggle rendering failed or timed out.",
      };
    }

    // 5. Download output files from Kaggle
    console.log("[Autopilot] Step 5: Downloading final video and metadata...");
    const outputLog = await manageKaggle("output", kernelRef);
    console.log("[Autopilot] Kaggle output status:", "[REDACTED]");

    // 6. Upload to YouTube as Private
    console.log(
      "[Autopilot] Step 6: Publishing to YouTube as Private with custom thumbnail & SEO...",
    );
    const destDir = path.resolve(process.cwd(), "jobs", jobId, "output");
    const ytResultRaw = await publishJobToYouTube(destDir, "private");
    const ytResult = JSON.parse(ytResultRaw);

    if (!ytResult.ok || !ytResult.videoUrl) {
      throw new Error(
        `YouTube upload failed: ${ytResult.error || ytResultRaw}`,
      );
    }
    console.log(
      "[Autopilot] ✅ Video uploaded to YouTube successfully.",
    );

    // 7. Send Email Review Alert
    console.log(
      "[Autopilot] Step 7: Sending review alert to [REDACTED]...",
    );
    let meta: any = {};
    const metaPath = path.join(destDir, "meta.json");
    if (fsSync.existsSync(metaPath)) {
      meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    }

    const emailSent = await sendVideoReadyEmail({
      title: ytResult.title,
      videoUrl: ytResult.videoUrl,
      studioUrl: ytResult.studioUrl,
      topic: curated.documentary_topic,
      category: curated.category,
      valueHook: curated.value_hook,
      thumbnailPath: [
        "frame_30s.jpg",
        "frame_15s.jpg",
        "frame_03s.jpg",
        "frame_45s.jpg",
      ]
        .map((f) => path.join(destDir, f))
        .find((f) => fsSync.existsSync(f)),
      chapters: meta.chapters,
      durationSec: meta.duration_sec,
      engine: meta.engine,
    });

    console.log("\n=======================================================");
    console.log(`🎉 [Autopilot] Autonomous Cycle Complete!`);
    console.log(`📺 Watch: [REDACTED]`);
    console.log(`⚙️ Studio: [REDACTED]`);
    console.log("=======================================================\n");

    return {
      ok: true,
      topic: curated,
      jobId,
      kernelRef,
      youtubeResult: ytResult,
      emailSent,
    };
  } catch (err: any) {
    const rawErrMsg = String(err?.message || err);
    const safeErrMsg = sanitizeErrorMessage(rawErrMsg);
    console.error(`[Autopilot] ❌ Autonomous cycle encountered an error: ${safeErrMsg}`);
    // If error is fixable (e.g. YouTube OAuth expired, Kaggle credentials/quota, or SMTP), send alert email
    const errMsg = rawErrMsg.toLowerCase();
    const isFixable =
      errMsg.includes("token") ||
      errMsg.includes("auth") ||
      errMsg.includes("quota") ||
      errMsg.includes("credential") ||
      errMsg.includes("unauthorized") ||
      errMsg.includes("401");

    if (isFixable) {
      try {
        await sendIncidentAlert({
          title: "Video Autopilot Action Required (Credentials / Quota)",
          service: "Daily Video Autopilot",
          status: "DEGRADED",
          actionTaken: "Cycle skipped for today. Please update credentials when convenient.",
          details: `Error encountered during daily run: ${safeErrMsg}`,
        });
      } catch {}
    }
    return { ok: false, error: safeErrMsg };
  } finally {
    // Retain only the most recent 2 video jobs to preserve VM disk space
    await cleanupOldVideoJobs(2);
  }
}

/**
 * Prunes historical job output directories to keep VM disk usage strictly bounded.
 */
async function cleanupOldVideoJobs(maxKeep = 2): Promise<void> {
  const jobsDir = path.resolve(process.cwd(), "jobs");
  try {
    if (!fsSync.existsSync(jobsDir)) return;
    const entries = await fs.readdir(jobsDir, { withFileTypes: true });
    const jobDirs = entries.filter((e) => e.isDirectory());
    if (jobDirs.length <= maxKeep) return;

    const dirsWithTime = await Promise.all(
      jobDirs.map(async (d) => {
        const full = path.join(jobsDir, d.name);
        const stat = await fs.stat(full);
        return { name: d.name, full, mtimeMs: stat.mtimeMs };
      })
    );

    dirsWithTime.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toRemove = dirsWithTime.slice(maxKeep);

    for (const dir of toRemove) {
      try {
        await fs.rm(dir.full, { recursive: true, force: true });
        console.log(`[Autopilot] Cleaned up historical video job directory: ${dir.name}`);
      } catch (e: any) {
        console.warn(`[Autopilot] Could not remove old job ${dir.name}: ${e.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Autopilot] Job cleanup notice: ${err.message}`);
  }
}

/**
 * Calculates ms until the next 03:30 PM IST (15:30 IST / 10:00 UTC).
 */
function msUntilNextRun(targetHourIST = 15, targetMinuteIST = 30): number {
  const IST_OFFSET_MS = 330 * 60 * 1000; // UTC + 5h30m
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Work purely in UTC arithmetic so the result is independent of the host
  // timezone: shift "now" into IST wall-clock epoch milliseconds first.
  const nowIstMs = Date.now() + IST_OFFSET_MS;
  const startOfIstDay = Math.floor(nowIstMs / DAY_MS) * DAY_MS;

  let targetIstMs = startOfIstDay + (targetHourIST * 60 + targetMinuteIST) * 60 * 1000;
  if (targetIstMs <= nowIstMs) {
    // Already passed today in IST, schedule for tomorrow
    targetIstMs += DAY_MS;
  }

  return targetIstMs - nowIstMs;
}

/**
 * Starts recurring daily schedule at 03:30 PM IST.
 */
export function startDailyScheduler() {
  const scheduleNext = () => {
    const delay = msUntilNextRun(15, 30);
    const hours = (delay / 3600000).toFixed(2);
    console.log(
      `[Scheduler] Next autonomous run scheduled in ${hours} hours (at 03:30 PM IST).`,
    );

    setTimeout(async () => {
      try {
        await runAutonomousCycle();
      } catch (e: any) {
        console.error("[Scheduler] Run error:", e.message);
      }
      scheduleNext(); // Schedule the next day's run
    }, delay);
  };

  scheduleNext();
}

// CLI direct execution
if (process.argv.includes("--now")) {
  runAutonomousCycle().catch(console.error);
} else if (process.argv.includes("--schedule")) {
  console.log("[Scheduler] Starting daily 03:30 PM IST scheduler daemon...");
  startDailyScheduler();
}
