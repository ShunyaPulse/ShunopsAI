// ==========================================
// Shared pull-request domain types
// ==========================================

export interface PullRequestItem {
  number: number;
  title: string;
  author: {
    login: string;
  };
  headRefName: string;
  url: string;
}

export interface PRReviewComment {
  id: number;
  user: {
    login: string;
  };
  path: string;
  original_line?: number;
  line?: number;
  diff_hunk?: string;
  body: string;
}

export interface FailedWorkflowRunItem {
  databaseId: number;
  workflowName: string;
  workflowDatabaseId?: number;
  headBranch: string;
  headSha: string;
  event: string;
  displayTitle: string;
  url: string;
  conclusion: string;
  createdAt: string;
}

/** Outcome of the dual-model consensus review for a single PR. */
export interface PRReviewResult {
  approved: boolean;
  merged: boolean;
  message: string;
}
