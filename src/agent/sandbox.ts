import * as fs from "node:fs/promises";
import * as path from "node:path";

// ==========================================
// Workspace Sandboxing & Secret Protection
// ==========================================

export const PROJECT_ROOT = process.cwd();

export const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "dist",
  "build",
  ".next",
  "coverage",
]);

/** Secret files the agent must never read, write, or list. */
export function isSecretPath(filepath: string): boolean {
  const base = path.basename(filepath).toLowerCase();
  if (base === ".env.example") return false;
  if (/^\.env(\.|$)/.test(base)) return true;
  if (/\.(pem|key|p12|pfx)$/.test(base)) return true;
  if (/(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/.test(filepath.toLowerCase())) return true;
  return false;
}

/** Resolve a path and refuse anything outside the project root. */
export function resolveInsideProject(p: string): string {
  const resolved = path.resolve(PROJECT_ROOT, p);
  const rel = path.relative(PROJECT_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path "${p}" escapes the project root and is blocked.`);
  }
  return resolved;
}

/** Resolve a path that is safe to access (not a secret, inside the project). */
export function assertAccessible(filepath: string): string {
  if (isSecretPath(filepath)) {
    throw new Error(`Access to secret file "${path.basename(filepath)}" is blocked.`);
  }
  return resolveInsideProject(filepath);
}

/**
 * Recursively list files and directories with exclusion rules.
 */
export async function listDirectoryTree(
  dirPath: string,
  maxDepth = 3,
  currentDepth = 0,
  ignoreList = DEFAULT_IGNORED_DIRS
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];

  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreList.has(entry.name)) continue;
      if (isSecretPath(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath) || entry.name;

      if (entry.isDirectory()) {
        results.push(`📁 ${relativePath}/`);
        const subEntries = await listDirectoryTree(
          fullPath,
          maxDepth,
          currentDepth + 1,
          ignoreList
        );
        results.push(...subEntries);
      } else {
        results.push(`📄 ${relativePath}`);
      }
    }
  } catch (err: any) {
    results.push(`[Error reading ${dirPath}: ${err.message}]`);
  }
  return results;
}

/** Reconstruct the effective command string a tool will run, for the safety gate. */
export function sensitivityPayload(toolName: string, args: Record<string, any>): string {
  const arr = Array.isArray(args.args) ? args.args.join(" ") : "";
  switch (toolName) {
    case "run_shell_command":
      return String(args.command ?? "");
    case "execute_neon_sql":
      return String(args.query ?? "");
    case "execute_redis_command":
      return `${args.command ?? ""} ${arr}`.trim();
    case "manage_cloud_run":
      return `gcloud run ${args.subcommand ?? ""} ${arr}`.trim();
    case "manage_cloudflare":
      return `wrangler ${args.command ?? ""}`.trim();
    default:
      return JSON.stringify(args);
  }
}
