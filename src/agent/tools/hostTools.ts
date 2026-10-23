import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveInsideProject, listDirectoryTree, assertAccessible } from "../sandbox.js";
import type { ToolGroup } from "./types.js";

const execAsync = promisify(exec);

/** Host filesystem and shell access, available only to operator-scoped runs. */
export const hostTools: ToolGroup<
  "run_shell_command" | "read_file" | "write_file" | "list_directory"
> = {
  run_shell_command: {
    schema: {
      type: "function",
      function: {
        name: "run_shell_command",
        description:
          "Executes a shell command on the host system within a timeout (default 30s) and returns stdout and stderr.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute (e.g., 'npm test', 'git status', 'ls -la', 'dir')",
            },
            cwd: {
              type: "string",
              description: "Optional working directory relative to current working directory",
            },
            timeoutMs: {
              type: "number",
              description: "Optional execution timeout in milliseconds (default: 30000ms)",
            },
          },
          required: ["command"],
        },
      },
    },
    execute: async (args: { command: string; cwd?: string; timeoutMs?: number }) => {
      let workingDir = process.cwd();
      try {
        workingDir = args.cwd ? resolveInsideProject(args.cwd) : process.cwd();
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
      // Cap timeout to 60 seconds maximum to prevent runner lockups
      const timeout = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 60000);

      try {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: workingDir,
          timeout,
          maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        });

        const outputParts: string[] = [];
        if (stdout && stdout.trim().length > 0) {
          outputParts.push(`--- STDOUT ---\n${stdout.trim()}`);
        }
        if (stderr && stderr.trim().length > 0) {
          outputParts.push(`--- STDERR ---\n${stderr.trim()}`);
        }
        if (outputParts.length === 0) {
          outputParts.push("(Command executed successfully with no output)");
        }

        return outputParts.join("\n\n");
      } catch (error: any) {
        const stdoutPart = error.stdout ? `\nStdout:\n${error.stdout.trim()}` : "";
        const stderrPart = error.stderr ? `\nStderr:\n${error.stderr.trim()}` : "";
        return `Command Failed (Exit code: ${error.code ?? "unknown"}): ${error.message}${stdoutPart}${stderrPart}`;
      }
    },
  },

  read_file: {
    schema: {
      type: "function",
      function: {
        name: "read_file",
        description: "Reads and returns the complete text content of a file at the specified path.",
        parameters: {
          type: "object",
          properties: {
            filepath: {
              type: "string",
              description: "Relative or absolute path to the file to read",
            },
          },
          required: ["filepath"],
        },
      },
    },
    execute: async (args: { filepath: string }) => {
      try {
        const targetPath = assertAccessible(args.filepath);
        const content = await fs.readFile(targetPath, "utf-8");
        const lines = content.split("\n").length;
        return `--- File: ${args.filepath} (${lines} lines, ${content.length} bytes) ---\n${content}`;
      } catch (error: any) {
        return `Error reading file "${args.filepath}": ${error.message}`;
      }
    },
  },

  write_file: {
    schema: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Writes content to a file at the target path, creating any required parent directories automatically.",
        parameters: {
          type: "object",
          properties: {
            filepath: {
              type: "string",
              description: "Target file path (relative or absolute)",
            },
            content: {
              type: "string",
              description: "Text content to write to the file",
            },
          },
          required: ["filepath", "content"],
        },
      },
    },
    execute: async (args: { filepath: string; content: string }) => {
      try {
        const targetPath = assertAccessible(args.filepath);
        const parentDir = path.dirname(targetPath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(targetPath, args.content, "utf-8");
        return `Successfully wrote ${args.content.length} characters to "${args.filepath}".`;
      } catch (error: any) {
        return `Error writing file "${args.filepath}": ${error.message}`;
      }
    },
  },

  list_directory: {
    schema: {
      type: "function",
      function: {
        name: "list_directory",
        description:
          "Lists directory contents recursively as a tree structure, automatically ignoring node_modules and .git folders.",
        parameters: {
          type: "object",
          properties: {
            directoryPath: {
              type: "string",
              description: "Directory path to inspect (defaults to current project root '.')",
            },
            maxDepth: {
              type: "number",
              description: "Maximum folder depth recursion (default: 3)",
            },
          },
        },
      },
    },
    execute: async (args: { directoryPath?: string; maxDepth?: number }) => {
      let targetDir: string;
      try {
        targetDir = resolveInsideProject(args.directoryPath || ".");
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
      const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : 3;

      try {
        const tree = await listDirectoryTree(targetDir, maxDepth);
        if (tree.length === 0) {
          return `Directory "${args.directoryPath || "."}" is empty.`;
        }
        return `Directory structure for "${args.directoryPath || "."}":\n${tree.join("\n")}`;
      } catch (error: any) {
        return `Error listing directory "${args.directoryPath || "."}": ${error.message}`;
      }
    },
  },
};
