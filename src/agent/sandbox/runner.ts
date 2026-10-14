import vm from "node:vm";
import { Worker } from "node:worker_threads";

export type SandboxEngineTier = "quickjs-wasm" | "worker-v8-isolate" | "vm-realm";

export interface SandboxExecutionOptions {
  timeoutMs?: number | undefined;
  memoryLimitMb?: number | undefined;
  /** Prefer running in a V8 resource-limited worker thread when QuickJS WASM is not installed. */
  useWorkerIsolate?: boolean | undefined;
}

export interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
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
  startTime: number
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

    const sourceHandle = vmCtx.newString(code);
    vmCtx.setProp(vmCtx.global, "__shunopsSandboxSource", sourceHandle);
    sourceHandle.dispose();

    const evalRes = vmCtx.evalCode(
      `JSON.stringify({ out: (${SANDBOX_RUNNER_SOURCE}), logs: globalThis.__shunopsSandboxLogs })`,
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

    return {
      success: true,
      result: result !== undefined ? result : null,
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, MAX_LOG_LINES).map(String) : [],
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
  startTime: number
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
        ? context.__shunopsSandboxLogs.slice(0, ${MAX_LOG_LINES}).map( l => String(l).slice(0, ${MAX_LOG_LINE_CHARS}))
        : [];
      parentPort.postMessage({ ok: true, rawResult, logs });
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
      },
      resourceLimits: {
        maxOldGenerationSizeMb: memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.floor(memoryLimitMb / 2)),
        codeRangeSizeMb: 16,
        stackSizeMb: 2,
      },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      resolve({
        success: false,
        error: `Script execution timed out after ${timeoutMs}ms`,
        logs: [],
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    }, timeoutMs + 250);
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
      if (result && typeof result === "object" && typeof (result as any).__json === "string") {
        try {
          result = JSON.parse((result as any).__json);
        } catch {
          result = null;
        }
      }

      resolve({
        success: true,
        result: result !== undefined ? result : null,
        logs: Array.isArray(msg.logs) ? msg.logs : [],
        executionTimeMs: Date.now() - startTime,
        engine: "worker-v8-isolate",
        memoryLimitMb,
      });
    });

    worker.on("error", (err: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        error: err?.message || String(err),
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

/**
 * Multi-Tier SOTA Code Sandbox (`quickjs-wasm` -> `worker-v8-isolate` -> `vm-realm`).
 *
 * Security & Isolation:
 * 1. Tier 1 (`quickjs-wasm`): When `quickjs-emscripten` is installed, executes inside
 *    an isolated WebAssembly linear memory space with a hard 32MB memory cap and interrupt handler.
 * 2. Tier 2 (`worker-v8-isolate`): For memory-intensive scripts or when `useWorkerIsolate` is enabled,
 *    executes inside a dedicated Node `worker_threads` V8 isolate with `resourceLimits`.
 * 3. Tier 3 (`vm-realm`): Zero-overhead null-prototype `vm` context with in-realm result
 *    serialization (no host objects, getters, Proxies, or Thenables ever cross to the host).
 */
export async function executeInSandbox(
  code: string,
  options: SandboxExecutionOptions = {}
): Promise<SandboxExecutionResult> {
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const memoryLimitMb = resolveMemoryLimitMb(options.memoryLimitMb);
  const startTime = Date.now();

  // Tier 1: QuickJS WebAssembly Sandbox (when installed)
  const quickJs = await getQuickJsModule();
  if (quickJs) {
    try {
      return await executeInQuickJsWasm(quickJs, code, timeoutMs, memoryLimitMb, startTime);
    } catch {
      // Fall through to V8 isolate / realm
    }
  }

  // Tier 2: V8 Resource-Limited Worker Isolate (for memory-heavy payloads or explicit request)
  if (shouldUseWorkerIsolate(code, options)) {
    return await executeInWorkerIsolate(code, timeoutMs, memoryLimitMb, startTime);
  }

  // Tier 3: Fast In-Memory Null-Prototype V8 Realm
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
