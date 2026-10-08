import "dotenv/config";
import { startVideoJob } from "../tools/video.js";

async function run() {
  const topic = process.argv[2] || "Lost in Deep Amazon Jungle : 7 Days Solo Survival Mystery";
  const minutes = parseInt(process.argv[3] || "3", 10);
  const language = process.argv[4] || "Hindi";
  const trendReason = process.argv[5] || "Deep Jungle Survival Suspense Story: Unexplained Whispers, Dense Mist, Night Predator Encounter, and Psychological Isolation";

  console.log(`[Launch] Starting video job for topic: "${topic}" (${minutes} mins, ${language})...`);
  const res = await startVideoJob(topic, minutes, language, trendReason);
  console.log("[Launch] Video job completed successfully.");
}

run().catch((err) => {
  console.error("[Launch] Failed to start video job:", err);
  process.exit(1);
});
