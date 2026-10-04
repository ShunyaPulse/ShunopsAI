import "dotenv/config";
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import { publishJobToYouTube } from "../tools/video.js";
import { sendVideoReadyEmail } from "../tools/notifier.js";

async function main() {
  const jobId = process.argv[2] || "mutpcenl";
  const destDir = path.resolve(process.cwd(), "jobs", jobId, "output");

  console.log(`[Upload] Publishing job "${jobId}" from ${destDir} to YouTube...`);
  const ytResultRaw = await publishJobToYouTube(destDir, "private");
  console.log("[Upload] YouTube response:", ytResultRaw);
  const ytResult = JSON.parse(ytResultRaw);

  if (!ytResult.ok || !ytResult.videoUrl) {
    throw new Error(`Upload failed: ${ytResultRaw}`);
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
    topic: meta.title || "Aadhaar Biometric Super-Engine Architecture",
    category: "Technology & Cybersecurity",
    valueHook:
      "Complete engineering breakdown of 1:N deduplication, ABIS biometric vectorization, and cryptographic HSM security powering India's UIDAI architecture.",
    thumbnailPath: ["frame_30s.jpg", "frame_15s.jpg", "frame_03s.jpg", "frame_45s.jpg"]
      .map((f) => path.join(destDir, f))
      .find((f) => fsSync.existsSync(f)),
    chapters: meta.chapters,
    durationSec: meta.duration_sec,
    engine: meta.engine,
  });

  console.log(`[Upload] ✅ Done! Video URL: ${ytResult.videoUrl} | Email Sent: ${emailSent}`);
}

main().catch(console.error);
