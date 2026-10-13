import type { PlatformCredentialBundle } from "../server/db/platformCredentials.js";
import type { ToolName } from "./tools.js";

/**
 * Multi-tenant execution scope for one agent run.
 *
 * Every agent run carries a scope. A `user` scope may only ever act on the
 * credentials that user connected themselves — it can never fall back to the
 * server operator's credentials, and it never gets host-level tools.
 * An `admin` scope keeps the operator's existing behaviour (server env creds).
 */
export interface ToolScope {
  kind: "admin" | "user";
  userId?: number;
  username?: string;
  /** Decrypted, per-user credentials. Always empty for an admin scope. */
  credentials: PlatformCredentialBundle;
}

/** Operator scope: server credentials, host tools allowed. */
export const ADMIN_SCOPE: ToolScope = { kind: "admin", credentials: {} };

/** Fresh operator scope (a factory, so a scope object is never shared/mutated). */
export function adminScope(): ToolScope {
  return { kind: "admin", credentials: {} };
}

export function userScope(
  userId: number,
  username: string,
  credentials: PlatformCredentialBundle = {}
): ToolScope {
  return { kind: "user", userId, username, credentials };
}

export function isAdminScope(scope?: ToolScope): boolean {
  // A missing scope only happens for internal callers (CLI/cron/admin routes),
  // which have always run with server credentials, so default to admin.
  return !scope || scope.kind === "admin";
}

// ==========================================
// TOOL TIERS
// ==========================================
//
// host     — trusts the server host: shell, filesystem, gcloud/SSH, wrangler,
//            the shared GPU/video pipeline, and the operator's infra. Admin only.
// platform — talks to a third-party account; safe for users once they connect
//            that platform themselves.
// safe     — no account mutation (public HTTP inspection, model debate, reads).

export type ToolTier = "host" | "platform" | "safe";

const HOST_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "run_shell_command",
  "read_file",
  "write_file",
  "list_directory",
  "manage_cloud_run",
  "manage_compute_engine",
  "manage_cloudflare",
  "sentinel_health_check",
  "auto_heal_service",
  "resolve_code_scanning_alerts",
  "produce_video",
  "manage_kaggle",
  "publish_to_youtube",
  "index_knowledge_document",
]);

const PLATFORM_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "execute_neon_sql",
  "execute_redis_command",
  "manage_github",
  "run_cloudflare_ai",
]);

export function toolTier(name: ToolName): ToolTier {
  if (HOST_TOOLS.has(name)) return "host";
  if (PLATFORM_TOOLS.has(name)) return "platform";
  return "safe";
}

export function isToolAllowedForScope(name: ToolName, scope?: ToolScope): boolean {
  return toolTier(name) !== "host" || isAdminScope(scope);
}

/** Tool names a run may expose to the model at all (least-privilege). */
export function allowedToolsForScope(scope?: ToolScope): Set<ToolName> {
  return new Set(
    (Object.keys(TOOL_TIER_REFERENCE) as ToolName[]).filter((name) =>
      isToolAllowedForScope(name, scope)
    )
  );
}

/**
 * Compile-time completeness guard: adding a tool without classifying it here is
 * a type error, so a new tool cannot silently land in the user-facing tier.
 */
const TOOL_TIER_REFERENCE: Record<ToolName, ToolTier> = {
  run_shell_command: "host",
  read_file: "host",
  write_file: "host",
  list_directory: "host",
  execute_neon_sql: "platform",
  execute_redis_command: "platform",
  manage_github: "platform",
  manage_cloud_run: "host",
  manage_cloudflare: "host",
  inspect_website: "safe",
  manage_compute_engine: "host",
  produce_video: "host",
  manage_kaggle: "host",
  publish_to_youtube: "host",
  ask_user_confirmation: "safe",
  sentinel_health_check: "host",
  auto_heal_service: "host",
  run_cloudflare_ai: "platform",
  dual_model_consensus: "safe",
  resolve_code_scanning_alerts: "host",
  search_knowledge_base: "safe",
  index_knowledge_document: "host",
  execute_sandboxed_code: "safe",
};

// ==========================================
// FAIL-CLOSED CREDENTIAL RESOLUTION
// ==========================================

export type CredentialResolution<T> =
  /** Use the caller's own credential. */
  | { ok: true; source: "user"; value: T }
  /** Admin scope: the tool keeps using its existing server-side configuration. */
  | { ok: true; source: "server" }
  /** User scope without a connected account: refuse, never escalate. */
  | { ok: false; message: string };

export function hostToolRefusal(toolName: ToolName): string {
  return `Refused: "${toolName}" operates on the server host and is not available to user accounts. Connect the platform you need under Account Settings → Platform Connections, or ask the workspace owner to run this.`;
}

function notConnected(platform: string, instruction: string): { ok: false; message: string } {
  return {
    ok: false,
    message: `Refused: your account has no ${platform} credential connected. ${instruction} Server-operator credentials are never used for user tasks.`,
  };
}

export function resolveNeon(scope?: ToolScope): CredentialResolution<string> {
  const connectionString = scope?.credentials?.neon?.connectionString;
  if (connectionString) {
    return { ok: true, source: "user", value: connectionString };
  }
  if (isAdminScope(scope)) return { ok: true, source: "server" };
  return notConnected(
    "Neon Postgres",
    "Add it under Account Settings → Platform Connections → Neon Postgres."
  );
}

export function resolveRedis(scope?: ToolScope): CredentialResolution<string> {
  const url = scope?.credentials?.redis?.url;
  if (url) return { ok: true, source: "user", value: url };
  if (isAdminScope(scope)) return { ok: true, source: "server" };
  return notConnected("Redis", "Add it under Account Settings → Platform Connections → Redis.");
}

export function resolveGitHub(scope?: ToolScope): CredentialResolution<string> {
  const token = scope?.credentials?.github?.token;
  if (token) return { ok: true, source: "user", value: token };
  if (isAdminScope(scope)) return { ok: true, source: "server" };
  return notConnected(
    "GitHub",
    "Add a personal access token under Account Settings → Platform Connections → GitHub."
  );
}

export function resolveCloudflare(
  scope?: ToolScope
): CredentialResolution<{ accountId: string; apiToken: string }> {
  const cloudflare = scope?.credentials?.cloudflare;
  if (cloudflare?.accountId && cloudflare?.apiToken) {
    return { ok: true, source: "user", value: cloudflare };
  }
  if (isAdminScope(scope)) return { ok: true, source: "server" };
  return notConnected(
    "Cloudflare",
    "Add your account ID and API token under Account Settings → Platform Connections → Cloudflare."
  );
}
