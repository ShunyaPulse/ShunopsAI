import "dotenv/config";
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import { publishJobToYouTube, manageKaggle } from "../tools/video.js";
import { sendVideoReadyEmail } from "../tools/notifier.js";

async function main() {
  const rawArg = process.argv[2] || "mutpcenl";
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "romomaxer";
  const jobId = rawArg.replace(/^[^/]+\//, "").replace(/^video-render-/, "");
  const destDir = path.resolve(process.cwd(), "jobs", jobId, "output");
  const videoFile = path.join(destDir, "video.mp4");

  if (!fsSync.existsSync(videoFile)) {
    console.log(`[Upload] Artifacts not found locally. Checking Kaggle kernel...`);
    const kernelRef = `${user}/video-render-${jobId}`;
    const status = await manageKaggle("status", kernelRef);
    console.log("[Upload] Kaggle Kernel Status: [REDACTED]");

    console.log(`[Upload] Downloading artifacts from Kaggle kernel...`);
    const downloadLog = await manageKaggle("output", kernelRef);
    console.log(`[Upload] Kaggle download completed.`);
  }

  if (!fsSync.existsSync(videoFile)) {
    throw new Error('Video file not found.');
  }

  console.log(`[Upload] Publishing job "${jobId}" from ${destDir} to YouTube...`);
  const ytResultRaw = await publishJobToYouTube(destDir, "private");
  console.log("[Upload] YouTube response: [REDACTED]");
  const ytResult = JSON.parse(ytResultRaw);

  if (!ytResult.ok || !ytResult.videoUrl) {
    throw new Error(`Upload failed: [REDACTED]`);
  }

  let meta: any = {};
  const metaPath = path.join(destDir, "meta.json");
  if (fsSync.existsSync(metaPath)) {
    meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
  }

  console.log("[Upload] Sending review alert email to reviewer...");
  const emailSent = await sendVideoReadyEmail({
    title: ytResult.title,
    videoUrl: ytResult.videoUrl,
    studioUrl: ytResult.studioUrl,
    topic: meta.title || "Autonomous Video Project",
    category: meta.category || "Science & Technology",
    language: meta.language,
    voice: meta.voice,
    valueHook: meta.description || meta.value_hook || "Autonomous AI video production render.",
    thumbnailPath: ["thumbnail.jpg", "thumbnail.png", "frame_30s.jpg", "frame_15s.jpg", "frame_03s.jpg", "frame_45s.jpg"]
      .map((f) => path.join(destDir, f))
      .find((f) => fsSync.existsSync(f)),
    chapters: meta.chapters,
    durationSec: meta.duration_sec,
    engine: meta.engine,
  });

  console.log(`[Upload] ✅ Done! Video URL: ${ytResult.videoUrl} | Email Sent: ${emailSent}`);
}

main().catch(console.error);
