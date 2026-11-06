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

/**
 * Enterprise pipeline error sanitizer:
 * - Redacts raw API credentials, bearer tokens, and internal UUIDs
 * - Translates common cloud platform quotas into clear executive English
 * - Preserves the exact technical failure reason without blanking it out as [REDACTED]
 */
function sanitizePipelineError(err: unknown): string {
  if (!err) return "Unknown pipeline execution failure";
  const raw = (err instanceof Error) ? err.message : String(err);

  // Redact token and credential patterns
  let cleaned = raw
    .replace(/\b(AIzaSy[A-Za-z0-9_-]{33})\b/g, "[API_KEY]")
    .replace(/\b(gsk_[A-Za-z0-9]{48,})\b/g, "[API_KEY]")
    .replace(/\b(ghp_[A-Za-z0-9]{36})\b/g, "[API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [API_TOKEN]")
    .replace(/\([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)/gi, "");

  // Translate known cloud service quota & platform errors into clear human diagnostics
  if (cleaned.includes("10,000 neurons") || cleaned.includes("daily free allocation") || /code["']?\s*:\s*4006/i.test(cleaned)) {
    return "Cloudflare Workers AI daily free allocation reached (10,000 neurons exhausted across active pool).";
  }
  if (cleaned.toLowerCase().includes("quota") && (cleaned.includes("403") || cleaned.toLowerCase().includes("exceeded"))) {
    return "GPU cloud platform compute quota limit reached for the current billing cycle.";
  }
  if (cleaned.includes("429") || cleaned.toLowerCase().includes("resource exhausted")) {
    return "AI inference API rate limit (429 Too Many Requests). Pool cascade attempted.";
  }
  if (cleaned.toLowerCase().includes("pre-flight") || cleaned.toLowerCase().includes("preflight")) {
    return `Asset Pre-Flight Verification Gate Failed: ${cleaned.replace(/^Error:\s*/i, "").trim()}`;
  }

  // Strip duplicate error prefixes and raw JSON wrapping
  cleaned = cleaned.replace(/^Error:\s*Error:\s*/i, "Error: ");
  cleaned = cleaned.replace(/,?\s*["']?code["']?\s*:\s*\d+/gi, "");
  cleaned = cleaned.replace(/^[\[{\s"']+|[\]}\s"']+$/g, "").trim();

  return cleaned.slice(0, 500) || "Pipeline encountered an unhandled exception";
}

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

  let currentStage = "Pipeline Initialization";
  let finalTopic = topicArg;

  try {
    if (videoType === "chapter") {
      const chapterTopic = topicArg;

      currentStage = "Grounded Literature Research";
      console.log(`\n📚 Phase 1: Grounded Research on "${chapterTopic}"...`);
      const research = await researchChapter(chapterTopic);
      console.log(`✅ Research complete. Themes: ${research.themesAndIrony?.slice(0, 3).join(", ")}`);

      currentStage = "Cinematic Script Generation";
      console.log(`\n✍️ Phase 2: Generating Cinematic Multi-Scene Script with 3D Aesthetic...`);
      const script = await generateChapterScript(research);
      console.log(`✅ Script generated with ${script.scenes.length} scenes.`);

      currentStage = "Asset Pre-packaging & Cloud GPU Dispatch";
      console.log(`\n🚀 Phase 3: Synthesizing Audio (Gemini-TTS), Keyframes (Cloudflare FLUX), and Launching to Kaggle GPU...`);
      const jobId = await launchChapterJob(script);
      console.log(`\n🎉 [SUCCESS] Chapter Video Job Launched: ${jobId}`);
      console.log(`   Kaggle Kernel: shunyapulse/video-render-${jobId}`);
      console.log(`   Kaggle Dataset: shunyapulse/video-job-${jobId}`);
      console.log(`   The Cloud Video Sweeper will automatically publish to YouTube when rendering completes.`);
    } else {
      let trendReason: string | undefined;

      if (!finalTopic) {
        currentStage = "Google Trends Discovery & Leaderboard Curation";
        console.log(`\n🔍 Fetching Google Trends for India...`);
        const trends = await fetchGoogleTrendsIndia();
        const curated = await curateBestTrendTopic(trends);
        const resolvedTopic = (curated as any)?.documentary_topic || (curated as any)?.topic;
        const resolvedReason = (curated as any)?.trend_reason || (curated as any)?.reason;
        if (!curated || !resolvedTopic) {
          throw new Error("Failed to curate trending topic from Google Trends India (feed empty or unavailable).");
        }
        finalTopic = resolvedTopic;
        trendReason = resolvedReason;
        console.log(`✅ Curated Trending Topic: [REDACTED]`);
      }

      currentStage = "Autonomous Video Pipeline Generation & Cloud Dispatch";
      console.log(`\n🚀 Launching Autonomous Video Job...`);
      const launchOutput = await startVideoJob(finalTopic, minutes, language, trendReason);
      let parsedJob: any = {};
      try { parsedJob = JSON.parse(launchOutput); } catch {}
      console.log("\n🎉 [SUCCESS] General Video Job Dispatched: [REDACTED]");
      console.log(`   Kaggle Kernel: ${parsedJob.kernel || "Dispatched"}`);
      console.log(`   Title: "[REDACTED]"`);
      console.log(`   Scenes: ${parsedJob.scenes || "N/A"}`);
    }
  } catch (err: any) {
    const cleanError = sanitizePipelineError(err);
    console.error('❌ [Cloud Video Dispatch Error at Stage: "[REDACTED]"]:\n   [REDACTED]');

    const activeTopic = finalTopic || topicArg || "Autonomous Daily Trend";
    await sendIncidentAlert({
      title: `Cloud Video Pipeline Failure (${currentStage})`,
      service: "VideoPipeline",
      status: "DOWN",
      actionTaken: `Automated dispatch aborted at stage: ${currentStage}`,
      details: `Topic: "${activeTopic}"\nStage: ${currentStage}\nRoot Cause: ${cleanError}`,
    }).catch(() => {});

    process.exit(1);
  }
}

main();
