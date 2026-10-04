import { runComprehensiveSentinelScan, autoHealService } from "../tools/sentinel.js";
import { runAutoAlertResolver } from "../tools/code-scanner-resolver.js";
import * as dotenv from "dotenv";

dotenv.config();

async function runSentinelCron() {
  console.log("🛡️ [Sentinel Cron] Starting scheduled autonomous health check & self-healing...");

  // 1. Health check across cloud services
  const report = await runComprehensiveSentinelScan();
  console.log(`Scan summary: ${report.healthyCount}/${report.totalServices} services operational (${report.overallStatus}).`);

  // 2. Auto-heal any degraded or down services
  for (const svc of report.services) {
    if (svc.status === "degraded" || svc.status === "down") {
      console.log(`⚠️ Auto-healing failing service: ${svc.service}...`);
      await autoHealService(svc.service, svc.error || "Degraded state detected during sentinel cron");
    }
  }

  // 3. Autonomous Code Scanning Alert Auto-Healing
  console.log("🔍 [Sentinel Cron] Checking and resolving open GitHub Code Scanning alerts...");
  try {
    const alertResult = await runAutoAlertResolver(10);
    console.log(`[Sentinel Cron] Code scanning alerts handled: ${alertResult.resolved}/${alertResult.total}`);
  } catch (err: any) {
    console.error(`[Sentinel Cron] Alert resolver notice: ${err.message}`);
  }

  console.log("✅ [Sentinel Cron] Scheduled run completed successfully.");
}

runSentinelCron().catch((e) => {
  console.error("Fatal error in Sentinel cron:", e);
  process.exit(1);
});
