import vm from "node:vm";

export interface SandboxExecutionOptions {
  timeoutMs?: number | undefined;
}

export interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  executionTimeMs: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 10000;
const MAX_LOG_LINES = 1000;

/**
 * Defines the console inside the sandbox realm.
 *
 * This bootstrap deliberately runs *inside* the context, so every object the
 * user code can reach (the log array, the console methods, the formatting
 * helpers) belongs to the sandbox realm. Injecting host objects such as the
 * host `Object`, `JSON` or a host `console.log` function would hand the code a
 * host-realm `Function` constructor, and `Object.constructor("return process")()`
 * is then a one-line escape to the real host process. Nothing crosses the
 * boundary in that direction.
 */
const SANDBOX_BOOTSTRAP = `
(function () {
  "use strict";
  var logs = [];
  var format = function (value) {
    try {
      if (typeof value === "string") return value;
      if (typeof value === "undefined") return "undefined";
      if (typeof value === "function") return String(value);
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  };
  var push = function (prefix, args) {
    if (logs.length >= ${MAX_LOG_LINES}) return;
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(format(args[i]));
    logs.push(prefix + parts.join(" "));
  };
  globalThis.__shunopsSandboxLogs = logs;
  globalThis.console = {
    log: function () { push("", arguments); },
    warn: function () { push("[WARN] ", arguments); },
    error: function () { push("[ERROR] ", arguments); },
    info: function () { push("", arguments); },
    debug: function () { push("", arguments); }
  };
})();
`;

function resolveTimeout(timeoutMs: number | undefined): number {
  const requested = Number(timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(requested), MAX_TIMEOUT_MS);
}

/**
 * Ultra-Lightweight In-Memory Code Sandbox.
 * Designed for low-resource environments (1GB RAM / Cloud Run 512MB).
 *
 * Security & Isolation:
 * 1. Strict time limit (default: 3000ms, ceiling 10000ms) prevents infinite loops.
 * 2. The code runs in a fresh `vm` realm whose globals are the realm's own
 *    natives; no host object, function, or module is ever passed in, so it has
 *    no reachable `process`, `require`, filesystem, or network.
 * 3. Console output is collected in the realm and copied out as plain strings.
 */
export async function executeInSandbox(
  code: string,
  options: SandboxExecutionOptions = {}
): Promise<SandboxExecutionResult> {
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const startTime = Date.now();

  try {
    const context = vm.createContext(Object.create(null) as object, {
      name: "shunops-sandbox",
      codeGeneration: { strings: true, wasm: false },
    });

    new vm.Script(SANDBOX_BOOTSTRAP, { filename: "shunops-sandbox-bootstrap.js" }).runInContext(
      context,
      { timeout: 1000 }
    );

    // Wrapped in an IIFE so top-level `return` works and strict mode applies.
    const script = new vm.Script(
      `(function () {\n"use strict";\n${code}\n})()`,
      { filename: "shunops-sandbox-user-code.js" }
    );

    const result = script.runInContext(context, { timeout: timeoutMs, displayErrors: true });
    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      result: result !== undefined ? result : null,
      logs: collectLogs(context),
      executionTimeMs,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      error: err?.message || String(err),
      logs: [],
      executionTimeMs,
    };
  }
}

/**
 * Copy the sandbox's log array out as plain host strings. Reading a realm-owned
 * value from the host is safe: it does not push any host object into the realm.
 */
function collectLogs(context: vm.Context): string[] {
  const raw = (context as { __shunopsSandboxLogs?: unknown }).__shunopsSandboxLogs;
  if (!Array.isArray(raw)) return [];
  return Array.prototype.map.call(raw, (line: unknown) => String(line)) as string[];
}
