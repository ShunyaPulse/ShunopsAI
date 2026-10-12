// ==========================================
// Shared autonomous-auditor domain types
// ==========================================

export interface CodeFlawCandidate {
  filePath: string;
  lineNo: number;
  snippet: string;
  category: "security" | "reliability" | "code_smell";
  ruleId: string;
  description: string;
}

export interface AuditResult {
  repo: string;
  scannedFiles: number;
  flawsDetected: number;
  flawsRemediated: number;
  prCreated?: string;
  prMerged?: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface RepoAuditState {
  lastAuditedCommitSha: string;
  lastSelfGeneratedCommitSha?: string | undefined;
  consecutiveRunsOnSameCommit: number;
  lastAuditedAt: string;
  lastStatus: "clean" | "remediated" | "skipped";
}
