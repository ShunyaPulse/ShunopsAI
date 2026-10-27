import vm from "node:vm";
import { Worker } from "node:worker_threads";

export type SandboxEngineTier = "quickjs-wasm" | "worker-v8-isolate" | "vm-realm";

export interface SandboxExecutionOptions {
  timeoutMs?: number | undefined;
  memoryLimitMb?: number | undefined;
  /** Prefer running in a V8 resource-limited worker thread when QuickJS WASM is not installed. */
  useWorkerIsolate?: boolean | undefined;
  /** Optional dictionary of tenant workspace files made accessible via readWorkspaceFile(filename). */
  workspaceFiles?: Record<string, string> | undefined;
  /** Optional array of prior step outputs when running inside a multi-step agentic pipeline. */
  pipelineOutputs?: string[] | undefined;
}

export interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  /** Files created or updated by calling writeWorkspaceFile(filename, content) inside the sandbox. */
  writtenFiles?: Record<string, string> | undefined;
  executionTimeMs: number;
  engine?: SandboxEngineTier;
  memoryLimitMb?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_MEMORY_LIMIT_MB = 32;
const MAX_MEMORY_LIMIT_MB = 128;
const MAX_LOG_LINES = 1000;
const MAX_LOG_LINE_CHARS = 4096;
const MAX_RESULT_JSON_CHARS = 65536;
const MAX_SANDBOX_WRITTEN_FILES = 10;
const MAX_SANDBOX_FILE_CHARS = 100000;

/**
 * Defines the console, mathematical/statistical utilities, workspace file helpers,
 * and return-value serializer inside the sandbox realm.
 */
const SANDBOX_BOOTSTRAP = `
(function () {
  "use strict";
  var logs = [];
  var writtenFiles = Object.create(null);
  var writtenCount = 0;

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
  globalThis.__shunopsWrittenFiles = writtenFiles;
  globalThis.workspaceFiles = Object.create(null);
  globalThis.pipelineOutputs = [];

  globalThis.console = {
    log: function () { push("", arguments); },
    warn: function () { push("[WARN] ", arguments); },
    error: function () { push("[ERROR] ", arguments); },
    info: function () { push("", arguments); },
    debug: function () { push("", arguments); }
  };

  // Workspace File I/O helpers inside sandbox
  globalThis.readWorkspaceFile = function (name) {
    var key = String(name || "").trim();
    if (Object.prototype.hasOwnProperty.call(writtenFiles, key)) {
      return writtenFiles[key];
    }
    if (globalThis.workspaceFiles && typeof globalThis.workspaceFiles[key] === "string") {
      return globalThis.workspaceFiles[key];
    }
    return null;
  };

  globalThis.writeWorkspaceFile = function (name, content) {
    var clean = String(name || "").trim().replace(/\\\\/g, "/").replace(/^\\/+/, "").replace(/\\.\\.+/g, "");
    if (!clean || clean.length > 120 || !/^[A-Za-z0-9_./-]+$/.test(clean)) {
      throw new Error("Invalid workspace filename: " + name);
    }
    if (!Object.prototype.hasOwnProperty.call(writtenFiles, clean)) {
      if (writtenCount >= ${MAX_SANDBOX_WRITTEN_FILES}) {
        throw new RangeError("Exceeded maximum files written per sandbox run (${MAX_SANDBOX_WRITTEN_FILES}).");
      }
      writtenCount++;
    }
    var str = String(content === undefined || content === null ? "" : content);
    if (str.length > ${MAX_SANDBOX_FILE_CHARS}) {
      throw new RangeError("Workspace file content exceeds maximum size (${MAX_SANDBOX_FILE_CHARS} chars).");
    }
    writtenFiles[clean] = str;
    if (globalThis.workspaceFiles && typeof globalThis.workspaceFiles === "object") {
      globalThis.workspaceFiles[clean] = str;
    }
    return true;
  };

  // Built-in analytical, statistical & data manipulation helpers
  globalThis.sum = function (arr) {
    return Array.isArray(arr) ? arr.reduce(function (a, b) { return a + Number(b || 0); }, 0) : 0;
  };
  globalThis.mean = function (arr) {
    return (Array.isArray(arr) && arr.length > 0) ? (globalThis.sum(arr) / arr.length) : 0;
  };
  globalThis.median = function (arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    var s = arr.map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : ((s[mid - 1] + s[mid]) / 2);
  };
  globalThis.stdDev = function (arr) {
    if (!Array.isArray(arr) || arr.length <= 1) return 0;
    var m = globalThis.mean(arr);
    var v = arr.reduce(function (acc, x) { return acc + Math.pow(Number(x) - m, 2); }, 0) / arr.length;
    return Math.sqrt(v);
  };
  globalThis.groupBy = function (arr, key) {
    if (!Array.isArray(arr)) return {};
    return arr.reduce(function (acc, item) {
      var k = String(item && item[key] !== undefined ? item[key] : "other");
      (acc[k] = acc[k] || []).push(item);
      return acc;
    }, {});
  };
  globalThis.csvParse = function (csvText) {
    if (typeof csvText !== "string" || !csvText.trim()) return [];
    var lines = csvText.trim().split(/\\r?\\n/).filter(Boolean);
    if (lines.length === 0) return [];
    var headers = lines[0].split(",").map(function (h) { return h.trim().replace(/^["']|["']$/g, ""); });
    return lines.slice(1).map(function (line) {
      var cols = line.split(",").map(function (c) { return c.trim().replace(/^["']|["']$/g, ""); });
      var row = {};
      for (var i = 0; i < headers.length; i++) row[headers[i] || ("col_" + i)] = cols[i];
      return row;
    });
  };
  globalThis.formatMarkdownTable = function (rows) {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    var headers = Object.keys(rows[0] || {});
    if (headers.length === 0) return "";
    var headLine = "| " + headers.join(" | ") + " |";
    var sepLine = "| " + headers.map(function () { return "---"; }).join(" | ") + " |";
    var bodyLines = rows.map(function (r) {
      return "| " + headers.map(function (h) {
        var v = r && r[h] !== undefined && r[h] !== null ? String(r[h]) : "";
        return v.replace(/\\|/g, "\\\\|").replace(/\\r?\\n/g, " ");
      }).join(" | ") + " |";
    });
    return [headLine, sepLine].concat(bodyLines).join("\\n");
  };
  globalThis.jsonParseSafe = function (text, fallback) {
    try {
      return JSON.parse(String(text));
    } catch (e) {
      return fallback !== undefined ? fallback : null;
    }
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

// Energy Efficiency: Pre-compile V8 bytecode once at startup instead of re-parsing on every sandbox call
const PRECOMPILED_BOOTSTRAP_SCRIPT = new vm.Script(SANDBOX_BOOTSTRAP, {
  filename: "shunops-sandbox-bootstrap.js",
});
const PRECOMPILED_RUNNER_SCRIPT = new vm.Script(SANDBOX_RUNNER_SOURCE, {
  filename: "shunops-sandbox-runner.js",
});

const SCRIPT_CACHE_LIMIT = 64;
const scriptCache = new Map<string, vm.Script>();

export function getCachedVmScript(code: string, filename = "eval.js"): vm.Script {
  if (code.length > 50000) {
    return new vm.Script(code, { filename });
  }
  let s = scriptCache.get(code);
  if (s) {
    scriptCache.delete(code);
    scriptCache.set(code, s);
    return s;
  }
  if (scriptCache.size >= SCRIPT_CACHE_LIMIT) {
    const oldest = scriptCache.keys().next().value;
    if (oldest !== undefined) scriptCache.delete(oldest);
  }
  s = new vm.Script(code, { filename });
  scriptCache.set(code, s);
  return s;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const requested = Number(timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TIMEOUT_MS;
  let t = Math.floor(requested);
  if (t > MAX_TIMEOUT_MS) t = MAX_TIMEOUT_MS;
  if (t < 100) t = 100;
  return t;
}

function resolveMemoryLimitMb(memoryLimitMb: number | undefined): number {
  const requested = Number(memoryLimitMb);
  if (!Number.isFinite(requested) || requested <= 4) return DEFAULT_MEMORY_LIMIT_MB;
  return Math.min(Math.floor(requested), MAX_MEMORY_LIMIT_MB);
}

// Cached QuickJS WebAssembly module lookup (loaded once per process if installed)
let quickJsModulePromise: Promise<any | null> | null = null;

async function getQuickJsModule(): Promise<any | null> {
  if (process.env.DISABLE_QUICKJS_WASM === "true") return null;
  if (!quickJsModulePromise) {
    quickJsModulePromise = (async () => {
      try {
        const specifier = "quickjs-emscripten";
        const mod: any = await import(/* @vite-ignore */ specifier);
        if (mod && typeof mod.getQuickJS === "function") {
          return await mod.getQuickJS();
        }
        return null;
      } catch {
        return null;
      }
    })();
  }
  return quickJsModulePromise;
}

/**
 * Tier 1 SOTA Isolation: Execute inside a disposable QuickJS WebAssembly runtime
 * with deterministic WASM linear memory ceiling, max stack depth, and deadline interrupt.
 */
async function executeInQuickJsWasm(
  QuickJS: any,
  code: string,
  timeoutMs: number,
  memoryLimitMb: number,
  startTime: number,
  workspaceFiles?: Record<string, string>,
  pipelineOutputs?: string[]
): Promise<SandboxExecutionResult> {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryLimitMb * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);

  const vmCtx = runtime.newContext();
  try {
    const bootRes = vmCtx.evalCode(SANDBOX_BOOTSTRAP, "shunops-sandbox-bootstrap.js");
    if (bootRes.error) {
      bootRes.error.dispose();
      throw new Error("QuickJS bootstrap initialization failed.");
    }
    bootRes.value.dispose();

    if (workspaceFiles || pipelineOutputs) {
      const injectScript = [
        workspaceFiles ? `globalThis.workspaceFiles = ${JSON.stringify(workspaceFiles)};` : "",
        pipelineOutputs ? `globalThis.pipelineOutputs = ${JSON.stringify(pipelineOutputs)};` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (injectScript) {
        const injectRes = vmCtx.evalCode(injectScript, "shunops-context-inject.js");
        if (injectRes.value) injectRes.value.dispose();
        if (injectRes.error) injectRes.error.dispose();
      }
    }

    const sourceHandle = vmCtx.newString(code);
    vmCtx.setProp(vmCtx.global, "__shunopsSandboxSource", sourceHandle);
    sourceHandle.dispose();

    const evalRes = vmCtx.evalCode(
      `JSON.stringify({ out: (${SANDBOX_RUNNER_SOURCE}), logs: globalThis.__shunopsSandboxLogs, writtenFiles: globalThis.__shunopsWrittenFiles })`,
      "shunops-sandbox-runner.js"
    );

    if (evalRes.error) {
      const errVal = vmCtx.dump(evalRes.error);
      evalRes.error.dispose();
      const errMsg =
        typeof errVal === "object" && errVal !== null && "message" in errVal
          ? String((errVal as any).message)
          : String(errVal);
      return {
        success: false,
        error: errMsg.includes("interrupted") ? `Script execution timed out after ${timeoutMs}ms` : errMsg,
        logs: [],
        executionTimeMs: Date.now() - startTime,
        engine: "quickjs-wasm",
        memoryLimitMb,
      };
    }

    const dumped = String(vmCtx.dump(evalRes.value) || "{}");
    evalRes.value.dispose();
    const parsed = JSON.parse(dumped);
    let result: unknown = parsed.out;
    if (result && typeof result === "object" && typeof (result as any).__json === "string") {
      result = JSON.parse((result as any).__json);
    }

    const writtenFiles =
      parsed.writtenFiles && typeof parsed.writtenFiles === "object" && Object.keys(parsed.writtenFiles).length > 0
        ? (parsed.writtenFiles as Record<string, string>)
        : undefined;

    return {
      success: true,
      result: result !== undefined ? result : null,
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, MAX_LOG_LINES).map(String) : [],
      ...(writtenFiles ? { writtenFiles } : {}),
      executionTimeMs: Date.now() - startTime,
      engine: "quickjs-wasm",
      memoryLimitMb,
    };
  } finally {
    vmCtx.dispose();
    runtime.dispose();
  }
}

/**
 * Heuristic check for large memory-allocation patterns that benefit from
 * running inside a dedicated V8 `worker_threads` isolate with hard heap limits.
 */
function shouldUseWorkerIsolate(code: string, options: SandboxExecutionOptions): boolean {
  if (options.useWorkerIsolate === true) return true;
  if (options.useWorkerIsolate === false) return false;
  return /\b(?:ArrayBuffer|SharedArrayBuffer|Uint8Array|Float64Array|repeat\s*\(\s*\d{6,}|new\s+Array\s*\(\s*\d{6,})\b/.test(
    code
  );
}

/**
 * Tier 2 SOTA Isolation: Run inside a dedicated Node `worker_threads` V8 isolate
 * configured with strict `resourceLimits` (`maxOldGenerationSizeMb`) so memory
 * exhaustion attacks terminate only the ephemeral worker isolate, never the host.
 */
async function executeInWorkerIsolate(
  code: string,
  timeoutMs: number,
  memoryLimitMb: number,
  startTime: number,
  workspaceFiles?: Record<string, string>,
  pipelineOutputs?: string[]
): Promise<SandboxExecutionResult> {
  const workerScript = `
    const { parentPort, workerData } = require("node:worker_threads");
    const vm = require("node:vm");
    try {
      const context = vm.createContext(Object.create(null), {
        name: "shunops-worker-sandbox",
        codeGeneration: { strings: true, wasm: false },
      });
      new vm.Script(workerData.bootstrap, { filename: "shunops-sandbox-bootstrap.js" }).runInContext(context, { timeout: 1000 });
      if (workerData.workspaceFiles) {
        context.workspaceFiles = Object.assign(Object.create(null), workerData.workspaceFiles);
      }
      if (Array.isArray(workerData.pipelineOutputs)) {
        context.pipelineOutputs = workerData.pipelineOutputs.slice();
      }
      context.__shunopsSandboxSource = workerData.code;
      let rawResult;
      try {
        rawResult = new vm.Script(workerData.runner, { filename: "shunops-sandbox-runner.js" }).runInContext(context, {
          timeout: workerData.timeoutMs,
          displayErrors: true,
        });
      } finally {
        delete context.__shunopsSandboxSource;
      }
      const logs = Array.isArray(context.__shunopsSandboxLogs)
        ? context.__shunopsSandboxLogs.slice(0, ${MAX_LOG_LINES}).map(function(l) { return String(l).slice(0, ${MAX_LOG_LINE_CHARS}); })
        : [];
      const writtenFiles = {};
      if (context.__shunopsWrittenFiles && typeof context.__shunopsWrittenFiles === "object") {
        for (const k of Object.keys(context.__shunopsWrittenFiles)) {
          writtenFiles[k] = String(context.__shunopsWrittenFiles[k]);
        }
      }
      parentPort.postMessage({ ok: true, rawResult, logs, writtenFiles });
    } catch (err) {
      parentPort.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
    }
  `;

  return new Promise<SandboxExecutionResult>((resolve) => {
    let settled = false;
    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        bootstrap: SANDBOX_BOOTSTRAP,
        runner: SANDBOX_RUNNER_SOURCE,
        code,
        timeoutMs,
        workspaceFiles: workspaceFiles || undefined,
        pipelineOutputs: pipelineOutputs || undefined,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.floor(memoryLimitMb / 2)),
        codeRangeSizeMb: 16,
        stackSizeMb: 2,
      },
    });

    // CodeQL js/resource-exhaustion remediation: strictly clamp timer delay with constant literal bounds
    let delayMs = 3250;
    const numTimeout = Number(timeoutMs);
    if (Number.isFinite(numTimeout)) {
      let t = Math.floor(numTimeout);
      if (t > 10000) t = 10000;
      if (t < 100) t = 100;
      delayMs = t + 250;
    }
    if (delayMs > 10250) {
      delayMs = 10250;
    }
    if (delayMs < 350) {
      delayMs = 350;
    }

    const timerDuration = delayMs > 10250 ? 10250 : delayMs < 350 ? 350 : delayMs;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      resolve({
        success: false,
        error: `Script execution timed out after ${timerDuration - 250}ms`,
        logs: [],
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    }, timerDuration);
    if (typeof timer.unref === "function") timer.unref();

    worker.on("message", (msg: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});

      if (!msg?.ok) {
        resolve({
          success: false,
          error: msg?.error || "Sandbox execution failed",
          logs: [],
          executionTimeMs: Date.now() - startTime,
          engine: "worker-v8-isolate",
          memoryLimitMb,
        });
        return;
      }

      let result: unknown = msg.rawResult;
      if (
        msg.rawResult &&
        typeof msg.rawResult === "object" &&
        typeof msg.rawResult.__json === "string"
      ) {
        try {
          result = JSON.parse(msg.rawResult.__json);
        } catch {
          result = msg.rawResult;
        }
      }

      const writtenFiles =
        msg.writtenFiles && typeof msg.writtenFiles === "object" && Object.keys(msg.writtenFiles).length > 0
          ? (msg.writtenFiles as Record<string, string>)
          : undefined;

      resolve({
        success: true,
        result: result !== undefined ? result : null,
        logs: Array.isArray(msg.logs) ? msg.logs : [],
        ...(writtenFiles ? { writtenFiles } : {}),
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    });

    worker.on("error", (workerErr: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Sandbox worker error: ${workerErr?.message || String(workerErr)}`,
        logs: [],
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    });

    worker.on("exit", (codeExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        error:
          codeExit !== 0
            ? `Sandbox worker terminated (exit code ${codeExit}, memory ceiling ${memoryLimitMb}MB)`
            : "Sandbox worker exited without returning a result",
        logs: [],
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    });
  });
}

function collectLogs(context: any): string[] {
  const raw = context.__shunopsSandboxLogs;
  if (!raw || !Array.isArray(raw)) return [];
  const out: string[] = [];
  const limit = Math.min(raw.length, MAX_LOG_LINES);
  for (let i = 0; i < limit; i++) {
    out.push(String(raw[i] ?? "").slice(0, MAX_LOG_LINE_CHARS));
  }
  return out;
}

function collectWrittenFiles(context: any): Record<string, string> | undefined {
  const raw = context.__shunopsWrittenFiles;
  if (!raw || typeof raw !== "object") return undefined;
  const keys = Object.keys(raw);
  if (keys.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const k of keys.slice(0, MAX_SANDBOX_WRITTEN_FILES)) {
    out[String(k)] = String(raw[k] ?? "").slice(0, MAX_SANDBOX_FILE_CHARS);
  }
  return out;
}

/**
 * Multi-Tier SOTA Code Sandbox (`quickjs-wasm` -> `worker-v8-isolate` -> `vm-realm`).
 * Supports bidirectional workspace file access (`readWorkspaceFile`, `writeWorkspaceFile`),
 * pipeline step chaining (`pipelineOutputs`), and statistical/table helpers.
 */
export async function executeInSandbox(
  code: string,
  options: SandboxExecutionOptions = {}
): Promise<SandboxExecutionResult> {
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const memoryLimitMb = resolveMemoryLimitMb(options.memoryLimitMb);
  const startTime = Date.now();
  const workspaceFiles = options.workspaceFiles;
  const pipelineOutputs = options.pipelineOutputs;

  // Tier 1: QuickJS WebAssembly Sandbox (when installed)
  const quickJs = await getQuickJsModule();
  if (quickJs) {
    try {
      return await executeInQuickJsWasm(
        quickJs,
        code,
        timeoutMs,
        memoryLimitMb,
        startTime,
        workspaceFiles,
        pipelineOutputs
      );
    } catch {
      // Fall through to V8 isolate / realm
    }
  }

  // Tier 2: V8 Resource-Limited Worker Isolate (for memory-heavy payloads or explicit request)
  if (shouldUseWorkerIsolate(code, options)) {
    return await executeInWorkerIsolate(
      code,
      timeoutMs,
      memoryLimitMb,
      startTime,
      workspaceFiles,
      pipelineOutputs
    );
  }

  // Tier 3: Fast In-Memory Null-Prototype V8 Realm
  try {
    const context = vm.createContext(Object.create(null) as object, {
      name: "shunops-sandbox",
      codeGeneration: { strings: true, wasm: false },
    });

    PRECOMPILED_BOOTSTRAP_SCRIPT.runInContext(context, { timeout: 1000 });

    if (workspaceFiles && typeof workspaceFiles === "object") {
      (context as any).workspaceFiles = Object.assign(Object.create(null), workspaceFiles);
    }
    if (Array.isArray(pipelineOutputs)) {
      (context as any).pipelineOutputs = pipelineOutputs.slice();
    }

    // Hand the program over as data, then let the realm compile, run, and serialize it
    (context as Record<string, unknown>).__shunopsSandboxSource = code;
    let rawResult: unknown;
    try {
      rawResult = PRECOMPILED_RUNNER_SCRIPT.runInContext(context, { timeout: timeoutMs, displayErrors: true });
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
    const writtenFiles = collectWrittenFiles(context);

    return {
      success: true,
      result: result !== undefined ? result : null,
      logs: collectLogs(context),
      ...(writtenFiles ? { writtenFiles } : {}),
      executionTimeMs,
      engine: "vm-realm",
      memoryLimitMb,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      error: err?.message || String(err),
      logs: [],
      executionTimeMs,
      engine: "vm-realm",
      memoryLimitMb,
    };
  }
}
