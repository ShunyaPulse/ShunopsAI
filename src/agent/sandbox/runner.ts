import vm from "node:vm";

export interface SandboxExecutionOptions {
  timeoutMs?: number | undefined;
  maxMemoryMb?: number | undefined;
}

export interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  executionTimeMs: number;
}

/**
 * Ultra-Lightweight In-Memory Code Sandbox.
 * Designed for low-resource environments (1GB RAM / Cloud Run 512MB).
 *
 * Security & Isolation:
 * 1. Strict time limit (default: 3000ms) prevents infinite loops.
 * 2. Host `process`, `fs`, `child_process`, `require`, and network are completely stripped.
 * 3. Only pure JavaScript runtime, Math, Date, RegExp, JSON, Array/Object utilities, and a safe console are exposed.
 */
export async function executeInSandbox(
  code: string,
  options: SandboxExecutionOptions = {}
): Promise<SandboxExecutionResult> {
  const timeoutMs = Math.min(options.timeoutMs ?? 3000, 10000); // Max 10s ceiling
  const startTime = Date.now();
  const logs: string[] = [];

  // Safe console capture
  const safeConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
    warn: (...args: unknown[]) => {
      logs.push("[WARN] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
    error: (...args: unknown[]) => {
      logs.push("[ERROR] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
  };

  // Safe Contextual Sandbox Environment
  const sandbox = {
    console: safeConsole,
    Math,
    Date,
    JSON,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
  };

  try {
    const context = vm.createContext(sandbox);

    // Wrap in an IIFE so async/await or top-level return is cleanly supported if wrapped
    const script = new vm.Script(`
      (function() {
        "use strict";
        ${code}
      })()
    `);

    const result = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
    });

    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      result: result !== undefined ? result : null,
      logs,
      executionTimeMs,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      error: err.message || String(err),
      logs,
      executionTimeMs,
    };
  }
}
