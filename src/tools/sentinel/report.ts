import type { SentinelStatusSummary } from "./types.js";

const OVERALL_ICONS: Record<SentinelStatusSummary["overallStatus"], string> = {
  all_systems_operational: "🟢",
  degraded: "🟡",
  critical: "🔴",
};

const SERVICE_STATUS_LABELS = {
  healthy: "✅ OK",
  degraded: "⚠️ Degraded",
  down: "❌ DOWN",
  unconfigured: "⚪ Unconfigured",
} as const;

/** Render a scan summary as the markdown table used by CLI output and alerts. */
export function formatSentinelReportMarkdown(summary: SentinelStatusSummary): string {
  const lines = [
    `### ${OVERALL_ICONS[summary.overallStatus]} ShunopsAI Infrastructure Sentinel Report`,
    `**Status:** \`${summary.overallStatus.toUpperCase()}\` | **Checked:** ${new Date(summary.timestamp).toLocaleString()}`,
    `**Stats:** ${summary.healthyCount} Healthy / ${summary.degradedCount} Degraded / ${summary.downCount} Down (Total: ${summary.totalServices})`,
    "",
    "| Service | Category | Status | Latency | Details / Error |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const s of summary.services) {
    const latency = s.latencyMs !== undefined ? `${s.latencyMs}ms` : "-";
    const detail = s.error
      ? `\`${s.error.slice(0, 60)}\``
      : s.details
        ? `\`${JSON.stringify(s.details).slice(0, 60)}\``
        : "-";

    lines.push(
      `| **${s.service}** | ${s.category} | ${SERVICE_STATUS_LABELS[s.status]} | ${latency} | ${detail} |`
    );
  }

  return lines.join("\n");
}
