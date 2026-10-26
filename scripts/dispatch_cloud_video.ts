import "dotenv/config";
import { execFileSync } from "node:child_process";

/**
 * Lightweight Cloud Dispatcher (Zero-Laptop Storage)
 * Triggers video generation directly on GitHub Actions Cloud VM.
 * Laptop downloads 0 bytes. Kaggle GPU renders, and Cloud Sweeper publishes to YouTube.
 */
function main() {
  const args = process.argv.slice(2);
  let topic = "";
  let videoType = "chapter";
  let language = "Hindi";
  let minutes = "5";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--topic" && args[i + 1]) {
      topic = args[++i];
    } else if (args[i] === "--type" && args[i + 1]) {
      videoType = args[++i];
    } else if (args[i] === "--lang" && args[i + 1]) {
      language = args[++i];
    } else if (args[i] === "--minutes" && args[i + 1]) {
      minutes = args[++i];
    } else if (!topic) {
      topic = args[i];
    }
  }

  console.log("==================================================================");
  console.log("☁️ Dispatching Cloud Video Generation to GitHub Actions...");
  console.log(`   Topic: "${topic || "(Autonomous Daily Trend)"}"`);
  console.log(`   Type: ${videoType} | Lang: ${language} | Duration: ${minutes}m`);
  console.log("==================================================================");

  try {
    const ghArgs = [
      "workflow",
      "run",
      "generate-video.yml",
      "-f",
      `topic=${topic}`,
      "-f",
      `video_type=${videoType}`,
      "-f",
      `language=${language}`,
      "-f",
      `minutes=${minutes}`,
    ];

    execFileSync("gh", ghArgs, { stdio: "inherit" });
    console.log("\n✅ [Dispatched Successfully]");
    console.log("   The job is running on GitHub Actions Cloud VM.");
    console.log("   Zero files will be created or downloaded on your laptop!");
    console.log("   View live progress at: https://github.com/ShunyaPulse/ShunopsAI/actions");
  } catch (err: any) {
    console.error("❌ Failed to dispatch workflow via gh CLI:", err?.message || err);
    process.exit(1);
  }
}

main();

