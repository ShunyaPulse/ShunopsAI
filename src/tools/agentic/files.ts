import { errorMessage } from "../../core/errors.js";
import { hydrateTenantAgenticState, persistTenantAgenticState } from "./persistence.js";
import { getOrCreateFileMap } from "./store.js";
import { MAX_FILES_PER_TENANT, MAX_FILE_SIZE_CHARS } from "./types.js";

/**
 * 1. Virtual Agent Workspace File System (`manage_workspace_files`)
 *
 * A tenant-scoped, path-validated file store the agent can read, write, append,
 * search and delete from, backed by the in-memory store and persisted to Neon.
 */

export function sanitizeFileName(raw: string): string {
  const clean = String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, "");
  if (!clean || clean.length > 120 || !/^[A-Za-z0-9_./-]+$/.test(clean)) {
    throw new Error(
      `Invalid filename "${raw}". Use alphanumeric characters, hyphens, underscores, dots, or slashes (e.g., "notes.md", "src/helper.js").`
    );
  }
  return clean;
}

export async function executeManageWorkspaceFiles(
  args: {
    operation: "write" | "append" | "read" | "list" | "delete" | "search";
    filename?: string | undefined;
    content?: string | undefined;
    query?: string | undefined;
  },
  tenantKey: string
): Promise<string> {
  await hydrateTenantAgenticState(tenantKey);
  const fileMap = getOrCreateFileMap(tenantKey);
  const op = args.operation;

  if (op === "list") {
    if (fileMap.size === 0) {
      return "Workspace File System is currently empty (0 files). Use operation='write' to create files.";
    }
    const rows = Array.from(fileMap.values()).map(
      (f) => `• ${f.name} (${f.sizeBytes} bytes, updated ${f.updatedAt})`
    );
    return `Workspace Files (${fileMap.size}/${MAX_FILES_PER_TENANT}):\n${rows.join("\n")}`;
  }

  if (op === "search") {
    const q = String(args.query || "").trim().toLowerCase();
    if (!q) return "Error: 'query' parameter is required for operation='search'.";
    const matches: string[] = [];
    for (const f of fileMap.values()) {
      if (f.name.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)) {
        const matchingLines = f.content
          .split("\n")
          .map((line, i) => ({ line, num: i + 1 }))
          .filter((item) => item.line.toLowerCase().includes(q))
          .slice(0, 5)
          .map((item) => `  L${item.num}: ${item.line.slice(0, 160)}`);
        matches.push(
          `📄 ${f.name}:\n${matchingLines.length > 0 ? matchingLines.join("\n") : "  (Filename match)"}`
        );
      }
    }
    return matches.length > 0
      ? `Search Results for "${args.query}" (${matches.length} files):\n\n${matches.join("\n\n")}`
      : `No workspace files matched "${args.query}".`;
  }

  let safeName: string;
  try {
    safeName = sanitizeFileName(args.filename || "");
  } catch (err) {
    return `Error: ${errorMessage(err)}`;
  }

  if (op === "read") {
    const file = fileMap.get(safeName);
    if (!file) {
      return `Error: File "${safeName}" not found in your workspace. Available files: ${
        Array.from(fileMap.keys()).join(", ") || "none"
      }`;
    }
    return `=== ${file.name} (${file.sizeBytes} bytes) ===\n${file.content}`;
  }

  if (op === "delete") {
    const existed = fileMap.delete(safeName);
    if (existed) await persistTenantAgenticState(tenantKey);
    return existed
      ? `Deleted file "${safeName}" from workspace.`
      : `File "${safeName}" did not exist in workspace.`;
  }

  if (op === "write" || op === "append") {
    const incoming = String(args.content ?? "");
    const existing = fileMap.get(safeName);
    if (!existing && fileMap.size >= MAX_FILES_PER_TENANT) {
      return `Error: Workspace file limit (${MAX_FILES_PER_TENANT}) reached. Delete unused files first.`;
    }
    const nextContent = op === "append" && existing ? `${existing.content}\n${incoming}` : incoming;
    if (nextContent.length > MAX_FILE_SIZE_CHARS) {
      return `Error: File "${safeName}" exceeds maximum size of ${MAX_FILE_SIZE_CHARS} characters.`;
    }
    const sizeBytes = Buffer.byteLength(nextContent, "utf8");
    fileMap.set(safeName, {
      name: safeName,
      content: nextContent,
      sizeBytes,
      updatedAt: new Date().toISOString(),
    });
    await persistTenantAgenticState(tenantKey);
    return `Successfully ${op === "append" ? "appended to" : "saved"} workspace file "${safeName}" (${sizeBytes} bytes).`;
  }

  return `Unsupported workspace file operation: "${op}".`;
}

/**
 * Persist files the JS sandbox created via `writeWorkspaceFile(name, content)`
 * into the tenant's isolated workspace store.
 */
export async function persistSandboxWrittenFiles(
  writtenFiles: Record<string, string> | undefined,
  tenantKey: string
): Promise<string[]> {
  if (!writtenFiles || typeof writtenFiles !== "object") return [];
  const savedNames: string[] = [];
  for (const [rawName, content] of Object.entries(writtenFiles)) {
    const res = await executeManageWorkspaceFiles(
      {
        operation: "write",
        filename: rawName,
        content: String(content ?? ""),
      },
      tenantKey
    );
    if (res.startsWith("Successfully")) {
      savedNames.push(rawName);
    }
  }
  return savedNames;
}
