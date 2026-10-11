import { runComprehensiveSentinelScan, autoHealService } from "../tools/sentinel.js";
import { runAutoAlertResolver } from "../tools/code-scanner-resolver.js";
import {
  fetchOpenPRs,
  reviewAndResolvePR,
  runAutoPRResolver,
  getTargetReposList,
} from "../tools/pr-auto-resolver.js";
import { runMultiRepoAutonomousAuditor } from "../tools/autonomous-repo-auditor.js";
import { isAutonomyPaused, getAutonomyStatus } from "../tools/autonomy-state.js";
import * as dotenv from "dotenv";

dotenv.config();

async function runSentinelCron() {
  // Check Master Autonomy Killswitch
  const autonomy = await getAutonomyStatus();
  if (autonomy.paused) {
    console.log(`\n=======================================================`);
    console.log(`⏸️ [Sentinel Cron] Skipped: Autonomy and background operations are currently PAUSED by user.`);
    console.log(`Paused At: ${autonomy.pausedAt || "Unknown"} | Reason: ${autonomy.reason || "Killswitch activated"}`);
    console.log(`To resume, toggle the button in the Command Center or run: POST /api/autonomy/resume`);
    console.log(`=======================================================\n`);
    return;
  }

  // When FAIL_ON_DOWN is set (e.g. by the scheduled ops workflow), a run that
  // still has down services exits non-zero so the workflow can open an incident.
  const failOnDown = /^(1|true|yes)$/i.test(process.env.FAIL_ON_DOWN || "");

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

  // 3. Autonomous Code Scanning Alert Auto-Healing (Dual-Model Consensus)
  console.log("🔍 [Sentinel Cron] Checking and resolving open GitHub Code Scanning alerts across repos...");
  const targetRepos = getTargetReposList();
  for (const repo of targetRepos) {
    try {
      const alertResult = await runAutoAlertResolver(10, repo);
      if (alertResult.total > 0) {
        console.log(`[Sentinel Cron] ${repo} alerts handled: ${alertResult.resolved}/${alertResult.total}`);
      }
    } catch (err: any) {
      console.warn(`[Sentinel Cron] Alert resolver notice on ${repo}: ${err.message}`);
    }
  }

  // 4. Autonomous Open Pull Requests Review & Auto-Merge (Dual-Model Consensus & Dependabot)
  console.log("🤝 [Sentinel Cron] Reviewing and resolving open PRs across repos via Dual-Model Consensus...");
  try {
    const prResult = await runAutoPRResolver();
    console.log(`[Sentinel Cron] PRs resolved across repos: ${prResult.resolved}/${prResult.total}`);
  } catch (err: any) {
    console.error(`[Sentinel Cron] PR resolver notice: ${err.message}`);
  }

  // 5. Proactive Multi-Repo Security & Bug Auditor (Finds & Heals bugs without waiting for outside PRs)
  console.log("🕵️ [Sentinel Cron] Proactively auditing repositories for security flaws & logic bugs...");
  try {
    const auditReports = await runMultiRepoAutonomousAuditor();
    const skippedCount = auditReports.filter((r) => r.skipped).length;
    const remediatedCount = auditReports.reduce((acc, r) => acc + (r.flawsRemediated || 0), 0);
    console.log(`[Sentinel Cron] Proactive Auditor: ${auditReports.length} repo(s) processed (${skippedCount} skipped by smart quota guardrail, ${remediatedCount} flaw(s) remediated).`);
  } catch (err: any) {
    console.error(`[Sentinel Cron] Proactive auditor notice: ${err.message}`);
  }

  // 6. Optional fail-fast signal for scheduled runs.
  if (failOnDown) {
    const recheck = await runComprehensiveSentinelScan();
    if (recheck.downCount > 0) {
      const downers = recheck.services
        .filter((s) => s.status === "down")
        .map((s) => s.service)
        .join(", ");
      console.error(
        `❌ [Sentinel Cron] ${recheck.downCount} service(s) still DOWN after self-healing: ${downers}`
      );
      process.exit(1);
    }
  }

  console.log("✅ [Sentinel Cron] Scheduled run completed successfully.");
}

runSentinelCron().catch((e) => {
  console.error("Fatal error in Sentinel cron:", e);
  process.exit(1);
});
