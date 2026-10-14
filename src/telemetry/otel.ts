import { AsyncLocalStorage } from "node:async_hooks";
import * as crypto from "node:crypto";

// ==========================================
// ShunopsAI Zero-Cost OpenTelemetry (OTel) Engine
// - W3C TraceContext (`00-<traceId>-<spanId>-01`) compliant
// - Automatic AsyncLocalStorage parent-child context propagation
// - OTLP/HTTP JSON v1 exporter (Grafana Cloud, Baselime, Honeycomb, Jaeger)
// - Bounded in-memory telemetry ring buffer & p50/p95/p99 latency analytics
// ==========================================

export type SpanStatus = "OK" | "ERROR" | "UNSET";

export type SpanKind = "SERVER" | "CLIENT" | "INTERNAL";

export interface TelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  kind: SpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: SpanStatus;
  statusMessage?: string | undefined;
  attributes: Record<string, string | number | boolean>;
}

export interface ActiveSpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
}

export interface HttpRequestSpanHandle {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  startTimeMs: number;
  startTimeUnixNano: string;
  method: string;
  url: string;
}

const traceStorage = new AsyncLocalStorage<ActiveSpanContext>();

const MAX_RECENT_SPANS = 300;
const recentSpans: TelemetrySpan[] = [];
const pendingOtlpQueue: TelemetrySpan[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Aggregated metrics counters
let totalSpansRecorded = 0;
let totalErrorsRecorded = 0;
let totalLlmCalls = 0;
let totalLlmFailovers = 0;
let totalToolCalls = 0;
let totalMcpCalls = 0;
let totalPromptTokensObserved = 0;
let totalCompletionTokensObserved = 0;

const SENSITIVE_ATTR_KEY_REGEX =
  /(?:^|[._-])(?:secret|password|passwd|api_?key|apikey|authorization|cookie|access_?token|refresh_?token|auth_?token|bearer_?token|session_?token|github_?token|cloudflare_?token)(?:$|[._-])/i;

/** Generate a 16-byte (32-hex-char) W3C traceId. */
export function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Generate an 8-byte (16-hex-char) W3C spanId. */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Parse a W3C TraceContext `traceparent` header (`00-<32hex>-<16hex>-<2hex>`).
 */
export function parseTraceparent(header?: string | null): { traceId: string; parentSpanId: string } | null {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length < 4) return null;
  const [, traceId, parentSpanId] = parts;
  if (
    !traceId ||
    !parentSpanId ||
    !/^[0-9a-f]{32}$/i.test(traceId) ||
    !/^[0-9a-f]{16}$/i.test(parentSpanId) ||
    /^0+$/.test(traceId) ||
    /^0+$/.test(parentSpanId)
  ) {
    return null;
  }
  return { traceId: traceId.toLowerCase(), parentSpanId: parentSpanId.toLowerCase() };
}

/**
 * Format a W3C `traceparent` header string.
 */
export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

/** Return the currently active span context from AsyncLocalStorage, if any. */
export function getActiveSpanContext(): ActiveSpanContext | undefined {
  return traceStorage.getStore();
}

/** Sanitize span attributes so secrets or oversized strings never enter telemetry. */
function sanitizeAttributes(
  raw?: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (SENSITIVE_ATTR_KEY_REGEX.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      out[k] = String(v).slice(0, 300);
    }
  }
  return out;
}

function recordCompletedSpan(span: TelemetrySpan): void {
  totalSpansRecorded++;
  if (span.status === "ERROR") totalErrorsRecorded++;

  if (span.name.startsWith("llm.")) {
    totalLlmCalls++;
    if (span.attributes["llm.failover"]) totalLlmFailovers++;
    if (typeof span.attributes["llm.prompt_tokens"] === "number") {
      totalPromptTokensObserved += span.attributes["llm.prompt_tokens"];
    }
    if (typeof span.attributes["llm.completion_tokens"] === "number") {
      totalCompletionTokensObserved += span.attributes["llm.completion_tokens"];
    }
  } else if (span.name.startsWith("tool.")) {
    totalToolCalls++;
  } else if (span.name.startsWith("mcp.")) {
    totalMcpCalls++;
  }

  recentSpans.push(span);
  if (recentSpans.length > MAX_RECENT_SPANS) {
    recentSpans.shift();
  }

  // Queue for OTLP/HTTP export when OTEL_EXPORTER_OTLP_ENDPOINT is configured
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    pendingOtlpQueue.push(span);
    if (pendingOtlpQueue.length >= 25) {
      void flushOtlpSpans();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushOtlpSpans();
      }, 5000);
      if (typeof flushTimer.unref === "function") flushTimer.unref();
    }
  }
}

/**
 * Start a root HTTP server span in Fastify's `onRequest` hook and bind it to
 * `AsyncLocalStorage` so all downstream agent/LLM/tool/MCP spans inherit `traceId`.
 */
export function startHttpRequestSpan(
  method: string,
  url: string,
  traceparentHeader?: string | undefined
): HttpRequestSpanHandle {
  const parsed = traceparentHeader ? parseTraceparent(traceparentHeader) : null;
  const traceId = parsed?.traceId || generateTraceId();
  const parentSpanId = parsed?.parentSpanId;
  const spanId = generateSpanId();
  const startTimeMs = Date.now();
  const startTimeUnixNano = (BigInt(startTimeMs) * 1_000_000n).toString();

  traceStorage.enterWith({ traceId, spanId, parentSpanId });

  return {
    traceId,
    spanId,
    parentSpanId,
    startTimeMs,
    startTimeUnixNano,
    method,
    url: url.split("?")[0] || url,
  };
}

/**
 * Complete a root HTTP server span in Fastify's `onResponse` hook.
 */
export function finishHttpRequestSpan(
  handle: HttpRequestSpanHandle,
  statusCode: number,
  errorMessage?: string
): void {
  const startTimeMs = handle.startTimeMs;
  const endTimeMs = Date.now();
  const endTimeUnixNano = (BigInt(endTimeMs) * 1_000_000n).toString();
  const isError = statusCode >= 500 || Boolean(errorMessage);

  recordCompletedSpan({
    traceId: handle.traceId,
    spanId: handle.spanId,
    parentSpanId: handle.parentSpanId,
    name: `http.request ${handle.method} ${handle.url}`,
    kind: "SERVER",
    startTimeUnixNano: handle.startTimeUnixNano,
    endTimeUnixNano,
    startTimeMs: handle.startTimeMs,
    endTimeMs,
    durationMs: Math.max(0, endTimeMs - startTimeMs),
    status: isError ? "ERROR" : "OK",
    statusMessage: errorMessage,
    attributes: {
      "http.method": handle.method,
      "http.target": handle.url,
      "http.status_code": statusCode,
    },
  });
}

/**
 * Execute an async operation within an OpenTelemetry span, automatically linking
 * to the parent span in `AsyncLocalStorage` and recording duration, status, and attributes.
 */
export async function withSpan<T>(
  name: string,
  options: {
    kind?: SpanKind | undefined;
    attributes?: Record<string, unknown> | undefined;
    traceparent?: string | undefined;
  },
  fn: (span: {
    traceId: string;
    spanId: string;
    setAttribute: (key: string, value: string | number | boolean) => void;
    setStatus: (status: SpanStatus, message?: string) => void;
  }) => Promise<T>
): Promise<T> {
  const parent = traceStorage.getStore();
  const parsedHeader = options.traceparent ? parseTraceparent(options.traceparent) : null;

  const traceId = parsedHeader?.traceId || parent?.traceId || generateTraceId();
  const parentSpanId = parsedHeader?.parentSpanId || parent?.spanId;
  const spanId = generateSpanId();

  const startTimeMs = Date.now();
  const startTimeUnixNano = (BigInt(startTimeMs) * 1_000_000n).toString();
  const attrs = sanitizeAttributes(options.attributes);
  let status: SpanStatus = "OK";
  let statusMessage: string | undefined;

  const spanHandle = {
    traceId,
    spanId,
    setAttribute: (key: string, value: string | number | boolean) => {
      if (SENSITIVE_ATTR_KEY_REGEX.test(key)) {
        attrs[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        attrs[key] = value.slice(0, 300);
      } else {
        attrs[key] = value;
      }
    },
    setStatus: (s: SpanStatus, msg?: string) => {
      status = s;
      if (msg) statusMessage = msg.slice(0, 300);
    },
  };

  return traceStorage.run({ traceId, spanId, parentSpanId }, async () => {
    try {
      const result = await fn(spanHandle);
      return result;
    } catch (err: any) {
      status = "ERROR";
      statusMessage = String(err?.message || err || "Unhandled span exception").slice(0, 300);
      attrs["exception.message"] = statusMessage;
      throw err;
    } finally {
      const endTimeMs = Date.now();
      const endTimeUnixNano = (BigInt(endTimeMs) * 1_000_000n).toString();
      recordCompletedSpan({
        traceId,
        spanId,
        parentSpanId,
        name,
        kind: options.kind || "INTERNAL",
        startTimeUnixNano,
        endTimeUnixNano,
        startTimeMs,
        endTimeMs,
        durationMs: Math.max(0, endTimeMs - startTimeMs),
        status,
        statusMessage,
        attributes: attrs,
      });
    }
  });
}

/**
 * Convert recorded spans into standard OTLP/HTTP JSON v1 `resourceSpans` format
 * and POST to `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. Grafana Cloud, Baselime, Honeycomb).
 */
export async function flushOtlpSpans(): Promise<{ exported: number; ok: boolean }> {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
  if (!endpoint || pendingOtlpQueue.length === 0) {
    return { exported: 0, ok: true };
  }

  const batch = pendingOtlpQueue.splice(0, 100);
  const serviceName = process.env.OTEL_SERVICE_NAME || "shunopsai-autonomous-engine";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS || "";
  if (rawHeaders) {
    for (const pair of rawHeaders.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (k && v) headers[k] = v;
      }
    }
  }

  const otlpPayload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "service.version", value: { stringValue: "1.0.0" } },
            { key: "telemetry.sdk.name", value: { stringValue: "shunops-otel-light" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "shunops.agent.tracer", version: "1.0.0" },
            spans: batch.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: s.kind === "SERVER" ? 2 : s.kind === "CLIENT" ? 3 : 1,
              startTimeUnixNano: s.startTimeUnixNano,
              endTimeUnixNano: s.endTimeUnixNano,
              attributes: Object.entries(s.attributes).map(([k, v]) => ({
                key: k,
                value:
                  typeof v === "number"
                    ? Number.isInteger(v)
                      ? { intValue: String(v) }
                      : { doubleValue: v }
                    : typeof v === "boolean"
                    ? { boolValue: v }
                    : { stringValue: String(v) },
              })),
              status: {
                code: s.status === "OK" ? 1 : s.status === "ERROR" ? 2 : 0,
                ...(s.statusMessage ? { message: s.statusMessage } : {}),
              },
            })),
          },
        ],
      },
    ],
  };

  try {
    const targetUrl = endpoint.endsWith("/v1/traces")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/v1/traces`;
    const res = await fetch(targetUrl, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify(otlpPayload),
      signal: AbortSignal.timeout(5000),
    });
    return { exported: batch.length, ok: res.ok };
  } catch {
    return { exported: 0, ok: false };
  }
}

/** Return the most recent spans (newest first). */
export function getRecentTraces(limit = 50): TelemetrySpan[] {
  const capped = Math.min(Math.max(1, limit), MAX_RECENT_SPANS);
  return recentSpans.slice(-capped).reverse();
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx] ?? 0;
}

/** Compute live latency percentiles (p50, p95, p99) and throughput counters. */
export function getTelemetryMetrics() {
  const durations = recentSpans.map((s) => s.durationMs).sort((a, b) => a - b);
  return {
    serviceName: process.env.OTEL_SERVICE_NAME || "shunopsai-autonomous-engine",
    otlpExporterConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    totalSpansRecorded,
    totalErrorsRecorded,
    bufferedSpansCount: recentSpans.length,
    latencyMs: {
      p50: computePercentile(durations, 50),
      p95: computePercentile(durations, 95),
      p99: computePercentile(durations, 99),
    },
    counters: {
      llmCalls: totalLlmCalls,
      llmFailovers: totalLlmFailovers,
      toolExecutions: totalToolCalls,
      mcpJsonRpcCalls: totalMcpCalls,
      promptTokens: totalPromptTokensObserved,
      completionTokens: totalCompletionTokensObserved,
    },
  };
}
