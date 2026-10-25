import "dotenv/config";
import { startVideoJob } from "./src/tools/video/job.js";

async function main() {
  console.log("=== TRIGGERING ARSENAL VS EVERTON (UPGRADED SETUP: UK ENGLISH & ACCENT) ===");
  const topic = "Arsenal vs Everton : How Arteta Matched Manchester City in Title Race";
  const trendReason = "Arsenal defeat Everton 2-0 with goals from Gabriel Magalhaes and Ezri Konsa to move level on points with leaders Manchester City at the Premier League summit";
  const durationMinutes = 3;
  const language = "UK English";

  console.log(`Topic: ${topic}`);
  console.log(`Trend Reason: ${trendReason}`);
  console.log(`Duration: ${durationMinutes} minutes | Language: ${language}`);

  try {
    const launchOutput = await startVideoJob(topic, durationMinutes, language, trendReason);
    console.log("\n=== LAUNCH RESULT ===");
    console.log(launchOutput);
  } catch (err: any) {
    console.error("\n[Error triggering video job]:", err.message || err);
  }
}

main();
