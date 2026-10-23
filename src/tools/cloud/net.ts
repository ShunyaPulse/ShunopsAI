/** Hostnames that must never be reachable from agent-initiated requests. */
const BLOCKED_SSRF_HOSTS = new Set([
  "169.254.169.254", // AWS / Azure / GCP instance metadata
  "metadata.google.internal",
  "metadata.platform",
  "100.100.100.200", // Alibaba Cloud metadata
  "::ffff:169.254.169.254",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Returns true when the hostname resolves to a private / loopback / link-local IP or internal domain. */
export function isPrivateHost(hostname: string): boolean {
  // Strip trailing DNS dot and IPv6 brackets
  const clean = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (BLOCKED_SSRF_HOSTS.has(clean)) return true;
  if (
    clean.endsWith(".internal") ||
    clean.endsWith(".local") ||
    clean.endsWith(".localhost") ||
    clean.endsWith(".arpa")
  ) {
    return true;
  }

  // IPv6 loopback, unspecified, link-local, unique-local, or IPv4-mapped IPv6
  if (
    clean === "::1" ||
    clean === "::" ||
    clean === "0:0:0:0:0:0:0:1" ||
    clean === "0:0:0:0:0:0:0:0" ||
    clean.startsWith("fe80:") ||
    clean.startsWith("fc") ||
    clean.startsWith("fd") ||
    clean.startsWith("::ffff:")
  ) {
    return true;
  }

  // IPv4 private ranges (RFC 1918) + loopback + link-local + CGNAT (100.64.0.0/10) + 0.0.0.0/8
  if (
    /^(0\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/.test(
      clean
    )
  ) {
    return true;
  }

  // Block integer/hex/octal single-number IPv4 representations (e.g. 2130706433 or 0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(clean)) {
    return true;
  }

  return false;
}
