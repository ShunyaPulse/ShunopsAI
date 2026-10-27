import "dotenv/config";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import {
  researchChapter,
  generateChapterScript,
  launchChapterJob,
} from "../src/experiments/ncert/chapter-pipeline.js";
import { startVideoJob } from "../src/tools/video.js";
import {
  fetchGoogleTrendsIndia,
  curateBestTrendTopic,
} from "../src/tools/trends.js";
import { sendIncidentAlert } from "../src/tools/notifier.js";

async function main() {
  console.log("==================================================================");
  console.log("🚀 ShunopsAI - Cloud Video Generation & Dispatch (Zero-Laptop Storage)");
  console.log("   Runs 100% on Cloud VMs | Zero Local Disk Overhead | Direct to Kaggle");
  console.log("==================================================================");

  const topicArg = process.env.TOPIC || process.argv.slice(2).join(" ").trim();
  const videoType = (process.env.VIDEO_TYPE || (topicArg ? "chapter" : "trend")).toLowerCase();
  const language = process.env.LANGUAGE || "Hindi";
  const minutes = Number(process.env.MINUTES) || 5;

  if (!topicArg && videoType !== "trend") {
    console.error("❌ [Error] No topic provided for chapter video. Aborting video generation to prevent unconfirmed runs.");
    process.exit(0);
  }

  console.log(`📋 Parameters: Type='${videoType}', Language='${language}', Duration=${minutes}m`);
  console.log(`🎯 Target Topic: "${topicArg || '[Auto-Fetch Google Trends India]'}"`);

  try {
    if (videoType === "chapter") {
      const chapterTopic = topicArg;

      console.log(`\n📚 Phase 1: Grounded Research on "${chapterTopic}"...`);
      const research = await researchChapter(chapterTopic);
      console.log(`✅ Research complete. Themes: ${research.themesAndIrony?.slice(0, 3).join(", ")}`);

      console.log(`\n✍️ Phase 2: Generating Cinematic Multi-Scene Script with 3D Aesthetic...`);
      const script = await generateChapterScript(research);
      console.log(`✅ Script generated with ${script.scenes.length} scenes.`);

      console.log(`\n🚀 Phase 3: Synthesizing Audio (Gemini-TTS), Keyframes (Cloudflare FLUX), and Launching to Kaggle GPU...`);
      const jobId = await launchChapterJob(script);
      console.log(`\n🎉 [SUCCESS] Chapter Video Job Launched: ${jobId}`);
      console.log(`   Kaggle Kernel: shunyapulse/video-render-${jobId}`);
      console.log(`   Kaggle Dataset: shunyapulse/video-job-${jobId}`);
      console.log(`   The Cloud Video Sweeper will automatically publish to YouTube when rendering completes.`);
    } else {
      let finalTopic = topicArg;
      let trendReason: string | undefined;

      if (!finalTopic) {
        console.log(`\n🔍 Fetching Google Trends for India...`);
        const trends = await fetchGoogleTrendsIndia();
        const curated = await curateBestTrendTopic(trends);
        if (!curated || !curated.topic) {
          throw new Error("Failed to curate trending topic from Google Trends India.");
        }
        finalTopic = curated.topic;
        trendReason = curated.reason;
        console.log(`✅ Curated Trending Topic: "${finalTopic}" (${trendReason})`);
      }

      console.log(`\n🚀 Launching Autonomous Video Job for: "${finalTopic}"...`);
      const launchOutput = await startVideoJob(finalTopic, minutes, language, trendReason);
      let parsedJob: any = {};
      try { parsedJob = JSON.parse(launchOutput); } catch {}
      console.log(`\n🎉 [SUCCESS] General Video Job Output: ${parsedJob.jobId || "Job started"}`);
    }
  } catch (err: any) {
    console.error("❌ [Cloud Video Dispatch Error]: Dispatch execution failed.");
    await sendIncidentAlert(
      "Cloud Video Pipeline Failure",
      `Failed to dispatch cloud video for topic: "${topicArg || "autonomous"}"\n\nError: ${err?.message ? String(err.message).slice(0, 100) : "Internal error"}`
    ).catch(() => {});
    process.exit(1);
  }
}

main();

