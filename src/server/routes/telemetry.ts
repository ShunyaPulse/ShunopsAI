import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  getRecentTraces,
  getTelemetryMetrics,
  flushOtlpSpans,
} from "../../telemetry/otel.js";
import { getKnowledgeStats } from "../db.js";
import { getSemanticCacheStats, clearSemanticCache, getModelsHealthStatus } from "../../agent/index.js";
import { isAdminUser } from "../scope.js";

export interface TelemetryRouteOptions {
  requireAuth?: preHandlerHookHandler;
  requireDashboardAuth?: preHandlerHookHandler;
}

/**
 * OpenTelemetry (OTel) Distributed Tracing, Latency Percentiles (p50/p95/p99),
 * Stage 8 Semantic Cache, Multi-Armed Bandit Model Telemetry, and SOTA Runtime routes.
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
    const models = await getModelsHealthStatus();
    return {
      success: true,
      telemetry: getTelemetryMetrics(),
      knowledgeEngine: getKnowledgeStats(),
      semanticCache: getSemanticCacheStats(),
      banditRouter: {
        algorithm: "beta-binomial-ewma-bandit",
        trackedModelsCount: models.length,
        topModels: models
          .slice(0, 5)
          .map((m) => ({
            id: m.id,
            banditScore: m.banditScore,
            ewmaLatencyMs: m.ewmaLatencyMs,
            successRatePercent: m.successRatePercent,
          })),
      },
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

  app.post("/api/telemetry/semantic-cache/clear", { preHandler: writePreHandler }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return {
        success: false,
        error: "Access denied. Administrator privileges required to clear the semantic cache.",
      };
    }
    clearSemanticCache();
    return {
      success: true,
      message: "Semantic response cache cleared.",
    };
  });
}
