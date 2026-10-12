import type { AuditResult } from "./types.js";

/** The result shape used whenever an audit run is skipped without scanning. */
export function skippedAuditResult(repo: string, reason: string): AuditResult {
  return {
    repo,
    scannedFiles: 0,
    flawsDetected: 0,
    flawsRemediated: 0,
    skipped: true,
    reason,
  };
}
