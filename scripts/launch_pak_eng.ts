import { startVideoJob } from "../src/tools/video/job.js";

async function main() {
  console.log("[Launcher] Starting Pakistan vs England video job...");
  const topic = "Pakistan vs England 4th ODI 2026: Pakistan 1-wicket miracle win from 154/9, Shadab Khan thrilling finish";
  const trendReason = "Pakistan pulled off an impossible 1-wicket heist chasing 240 against England, recovering from 154/9 to win on the last ball.";
  const result = await startVideoJob(topic, 3, "Hindi", trendReason);
  console.log("[Launcher] Job Result:\n", result);
}

main().catch((err) => {
  console.error("[Launcher] Failed:", err);
  process.exit(1);
});
