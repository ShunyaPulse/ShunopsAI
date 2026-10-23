/**
 * ShunopsAI infrastructure sentinel: health probes, fleet scan, markdown
 * reporting and self-healing remediation.
 *
 * The implementation lives in `./sentinel/*`, one module per concern. This
 * barrel is the stable public entry point used by the agent tools, cron and API
 * routes.
 */

export type { HealReport, SentinelStatusSummary, ServiceHealthReport } from "./sentinel/types.js";

export {
  checkAppHealth,
  checkCloudflareAiHealth,
  checkKaggleHealth,
  checkNeonHealth,
  checkRedisHealth,
  checkSystemHealth,
  checkYouTubeHealth,
} from "./sentinel/checks.js";

export { runComprehensiveSentinelScan } from "./sentinel/scan.js";

export { formatSentinelReportMarkdown } from "./sentinel/report.js";

export { autoHealService } from "./sentinel/heal.js";
