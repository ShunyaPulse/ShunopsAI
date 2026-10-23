export interface GcpAction {
  operation: "list_cloud_run_services" | "query_bigquery" | "list_logs";
  region?: string | undefined;
  sqlQuery?: string | undefined;
  logFilter?: string | undefined;
}

/**
 * Inspect Cloud Run services, query BigQuery, or read Cloud Logging using the
 * caller's GCP access token.
 */
export async function inspectGcpCloud(
  action: GcpAction,
  opts: { projectId?: string | undefined; token?: string | undefined } = {}
): Promise<string> {
  const projectId = (opts.projectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "").trim();
  const rawToken = (opts.token || process.env.GCP_ACCESS_TOKEN || "").trim();

  if (!projectId || !rawToken) {
    return "Error: GCP Project ID and OAuth/Access Token are required. Connect Google Cloud Platform (GCP) under Account Settings → Platform Connections.";
  }

  if (!/^[a-z0-9:-]{4,64}$/i.test(projectId)) {
    return "Error: Invalid GCP Project ID format.";
  }

  const headers: Record<string, string> = {
    Authorization: rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    if (action.operation === "list_cloud_run_services") {
      const location = (action.region || "-").replace(/[^a-z0-9-]/gi, "");
      const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/services`;
      const res = await fetch(url, { method: "GET", redirect: "error", headers, signal: AbortSignal.timeout(12000) });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP Cloud Run API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      const services = Array.isArray(data?.services) ? data.services : [];
      return `GCP Cloud Run Services in project "${projectId}" (${services.length}):\n` +
        (services.map((s: any) => `• ${s.name} -> ${s.uri || "no-uri"} (updated: ${s.updateTime || "unknown"})`).join("\n") || "No services found.");
    }

    if (action.operation === "query_bigquery") {
      if (!action.sqlQuery) return "Error: sqlQuery is required for query_bigquery.";
      const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({ query: action.sqlQuery, useLegacySql: false, maxResults: 50 }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP BigQuery API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      return `GCP BigQuery Result (${data?.totalRows || 0} rows):\n${JSON.stringify(data?.rows || [], null, 2)}`;
    }

    if (action.operation === "list_logs") {
      const url = `https://logging.googleapis.com/v2/entries:list`;
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({
          resourceNames: [`projects/${projectId}`],
          filter: action.logFilter || "severity>=ERROR",
          pageSize: 20,
          orderBy: "timestamp desc",
        }),
        signal: AbortSignal.timeout(12000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        return `GCP Cloud Logging API Error (${res.status}): ${data?.error?.message || res.statusText}`;
      }
      return `GCP Cloud Logging Entries (${(data?.entries || []).length}):\n${JSON.stringify(data?.entries || [], null, 2)}`;
    }

    return `Unsupported GCP operation: ${action.operation}`;
  } catch (err: any) {
    return `GCP API Error: ${err.message}`;
  }
}
