/**
 * Cloud platform tools barrel.
 *
 * Implementation lives in `./cloud/`:
 * - `neon`           — Neon / Supabase Postgres queries
 * - `redis`          — allowlisted Redis commands (direct or Upstash REST)
 * - `github`         — REST-first GitHub operations with a gh CLI fallback
 * - `gcloud`         — gcloud and wrangler CLI wrappers
 * - `net`            — shared private-host/SSRF policy
 * - `inspectWebsite` — SSRF-safe page inspection and text extraction
 * - `computeEngine`  — GCE SSH diagnostics with a local fallback
 * - `webSearch`      — Tavily, Brave and the keyless multi-source engine
 * - `gcp`            — Cloud Run / BigQuery / Cloud Logging inspector
 */
export { executeNeonSql } from "./cloud/neon.js";
export { executeRedisCommand } from "./cloud/redis.js";
export { manageGitHub, type GitHubAction } from "./cloud/github.js";
export { manageCloudRun, manageCloudflare } from "./cloud/gcloud.js";
export { isPrivateHost } from "./cloud/net.js";
export { inspectWebsite } from "./cloud/inspectWebsite.js";
export { manageComputeEngine } from "./cloud/computeEngine.js";
export { executeWebSearch, type WebSearchOptions } from "./cloud/webSearch.js";
export { inspectGcpCloud, type GcpAction } from "./cloud/gcp.js";
