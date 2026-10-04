import * as dotenv from "dotenv";
dotenv.config();

import { startVideoJob } from "./src/tools/video.js";

async function main() {
  const topic = "How Deep Sea Creatures Glow in Total Darkness";
  const minutes = 1;
  const language = "English";

  console.log("[Wan2.1 FP16] Launching test job...");
  const result = await startVideoJob(topic, minutes, language);
  console.log("[Wan2.1 FP16] Launch result: [REDACTED]");
}

main().catch((err) => {
  console.error("[Wan2.1 FP16] Launch error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

