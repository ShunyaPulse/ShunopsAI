/** Shared result shapes for the infrastructure sentinel (scan + auto-heal). */

export interface ServiceHealthReport {
  service: string;
  category: "database" | "cache" | "ai" | "compute" | "web" | "pipeline";
  status: "healthy" | "degraded" | "down" | "unconfigured";
  latencyMs?: number | undefined;
  details?: Record<string, any> | string | undefined;
  error?: string | undefined;
  lastChecked: string;
}

export interface SentinelStatusSummary {
  timestamp: string;
  overallStatus: "all_systems_operational" | "degraded" | "critical";
  totalServices: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  services: ServiceHealthReport[];
}

/** Outcome of a self-healing attempt against a single service. */
export interface HealReport {
  success: boolean;
  actionTaken: string;
  result: string;
}
