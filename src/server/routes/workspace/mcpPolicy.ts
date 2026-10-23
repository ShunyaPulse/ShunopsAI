import { assertAllowedMcpUrl, isBuiltInMcpEndpoint } from "../../../agent/mcp/client.js";

/**
 * One message shape for every MCP URL refusal, so the panel, the probe and the
 * registry all explain the same policy instead of three near-miss variants.
 */
export function mcpPolicyHint(err: unknown): string {
  const message = err instanceof Error ? err.message : "invalid MCP server URL";
  return `${message} Public MCP hosts must be listed in ALLOWED_MCP_HOSTS; loopback and private addresses are only reachable in a development run.`;
}

/**
 * MCP credentials are only useful if the run-time registry is allowed to call
 * them, and the registry refuses any endpoint that fails the shared outbound
 * URL policy. Reject it at connect time so the panel can never show a green
 * "connected" row for a server the agent could never reach.
 */
export function mcpCredentialRejection(
  platform: string,
  values: Record<string, unknown>
): string | null {
  if (
    platform !== "mcp" &&
    platform !== "local_bridge" &&
    !platform.startsWith("mcp:") &&
    !platform.startsWith("local_bridge:")
  ) {
    return null;
  }

  const candidate = [values.serverUrl, values.bridgeUrl].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (!candidate) return null; // A missing URL is reported by the required-field check.
  if (isBuiltInMcpEndpoint(candidate)) return null;

  try {
    assertAllowedMcpUrl(candidate);
    return null;
  } catch (err) {
    return `That MCP endpoint cannot be used: ${mcpPolicyHint(err)}`;
  }
}
