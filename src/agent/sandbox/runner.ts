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
const MAX_LOG_LINE_CHARS = 4096;
const MAX_RESULT_JSON_CHARS = 65536;

/**
 * Defines the console and return-value serializer inside the sandbox realm.
 *
 * This bootstrap deliberately runs *inside* the context, so every object the
 * user code can reach (the log array, the console methods, the formatting
 * helpers) belongs to the sandbox realm. Furthermore, non-primitive return
 * values are serialized to JSON *inside* the VM timeout boundary so a malicious
 * `toJSON()` getter, `Proxy` trap, or thenable returned by user code can never
 * execute on the host thread outside `timeoutMs`.
 */
const SANDBOX_BOOTSTRAP = `
(function () {
  "use strict";
  var logs = [];
  var format = function (value) {
    try {
      if (typeof value === "string") return value.slice(0, ${MAX_LOG_LINE_CHARS});
      if (typeof value === "undefined") return "undefined";
      if (typeof value === "function") return String(value).slice(0, ${MAX_LOG_LINE_CHARS});
      var json = JSON.stringify(value);
      return typeof json === "string" ? json.slice(0, ${MAX_LOG_LINE_CHARS}) : String(value).slice(0, ${MAX_LOG_LINE_CHARS});
    } catch (e) {
      return String(value).slice(0, ${MAX_LOG_LINE_CHARS});
    }
  };
  var push = function (prefix, args) {
    if (logs.length >= ${MAX_LOG_LINES}) return;
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(format(args[i]));
    logs.push((prefix + parts.join(" ")).slice(0, ${MAX_LOG_LINE_CHARS}));
  };
  globalThis.__shunopsSandboxLogs = logs;
  globalThis.console = {
    log: function () { push("", arguments); },
    warn: function () { push("[WARN] ", arguments); },
    error: function () { push("[ERROR] ", arguments); },
    info: function () { push("", arguments); },
    debug: function () { push("", arguments); }
  };
  // Compile, run, and serialize the return value inside the realm's timeout
  // boundary so no live Proxy, getter, or Thenable ever crosses to the host.
  globalThis.__shunopsRun = function (source) {
    if (typeof source !== "string") throw new TypeError("Sandbox program must be a string.");
    var raw = new Function('"use strict";\\n' + source)();
    if (raw === undefined || raw === null) return null;
    var t = typeof raw;
    if (t === "number" || t === "boolean") return raw;
    if (t === "string") return raw.slice(0, ${MAX_RESULT_JSON_CHARS});
    if (t === "bigint") return String(raw);
    var serialized = JSON.stringify(raw);
    if (typeof serialized !== "string") return null;
    if (serialized.length > ${MAX_RESULT_JSON_CHARS}) {
      throw new RangeError("Sandbox return value exceeded maximum serialized size (64KB).");
    }
    return { __json: serialized };
  };
})();
`;

/**
 * Constant, host-authored entry point: it reads the program out of the realm and
 * hands it to the realm's own evaluator. Nothing user-supplied is interpolated
 * into a script this file builds.
 */
const SANDBOX_RUNNER_SOURCE =
  '(function () { "use strict"; return globalThis.__shunopsRun(globalThis.__shunopsSandboxSource); })()';

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
 *    natives; no host object, function, or module is ever passed in.
 * 3. Non-primitive return values are JSON-serialized inside `runInContext` so
 *    host callers never invoke sandbox getters, Proxies, or Thenables.
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

    // Hand the program over as data, then let the realm compile, run, and serialize it
    // (the whole call, including result serialization, is inside the timeout).
    (context as Record<string, unknown>).__shunopsSandboxSource = code;
    let rawResult: unknown;
    try {
      rawResult = new vm.Script(SANDBOX_RUNNER_SOURCE, {
        filename: "shunops-sandbox-runner.js",
      }).runInContext(context, { timeout: timeoutMs, displayErrors: true });
    } finally {
      delete (context as Record<string, unknown>).__shunopsSandboxSource;
    }

    let result: unknown = rawResult;
    if (
      rawResult &&
      typeof rawResult === "object" &&
      typeof (rawResult as { __json?: unknown }).__json === "string"
    ) {
      result = JSON.parse(String((rawResult as { __json: string }).__json));
    }

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
  return Array.prototype.slice
    .call(raw, 0, MAX_LOG_LINES)
    .map((line: unknown) => String(line).slice(0, MAX_LOG_LINE_CHARS));
}
