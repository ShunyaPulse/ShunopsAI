import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  getRecentTraces,
  getTelemetryMetrics,
  flushOtlpSpans,
} from "../../telemetry/otel.js";
import { getKnowledgeStats } from "../db.js";
import { isAdminUser } from "../scope.js";

export interface TelemetryRouteOptions {
  requireAuth?: preHandlerHookHandler;
  requireDashboardAuth?: preHandlerHookHandler;
}

/**
 * OpenTelemetry (OTel) Distributed Tracing, Latency Percentiles (p50/p95/p99),
 * and SOTA Runtime Capabilities routes.
 */
export async function telemetryRoutes(
  app: FastifyInstance,
  opts: TelemetryRouteOptions = {}
): Promise<void> {
  const readPreHandler = opts.requireDashboardAuth ? [opts.requireDashboardAuth] : [];
  const writePreHandler = opts.requireAuth ? [opts.requireAuth] : [];

  app.get<{
    Querystring: { limit?: string };
  }>("/api/telemetry/traces", { preHandler: readPreHandler }, async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 200);
    return {
      success: true,
      traces: getRecentTraces(limit),
    };
  });

  app.get("/api/telemetry/metrics", { preHandler: readPreHandler }, async () => {
    return {
      success: true,
      telemetry: getTelemetryMetrics(),
      knowledgeEngine: getKnowledgeStats(),
      sandboxEngine: {
        tiers: ["quickjs-wasm", "worker-v8-isolate", "vm-realm"],
        wasmMemoryCeilingMb: 32,
        workerMaxOldGenMb: 32,
      },
    };
  });

  app.post("/api/telemetry/flush", { preHandler: writePreHandler }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return {
        success: false,
        error: "Access denied. Administrator privileges required to flush OTLP trace batches.",
      };
    }
    const result = await flushOtlpSpans();
    return {
      success: result.ok,
      exported: result.exported,
    };
  });
}
