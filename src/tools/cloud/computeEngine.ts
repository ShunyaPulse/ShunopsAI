import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

type DiagnosticAction = "metrics" | "services" | "disk";

const SAFE_SSH_TOKEN = /^[A-Za-z0-9_.@:-]+$/;

/** Cross-platform local host diagnostics (no reliance on Linux-only binaries). */
async function localDiagnostics(action: DiagnosticAction): Promise<string> {
  if (action === "metrics") {
    const cpus = os.cpus();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(", ");
    const mb = (n: number) => Math.round(n / 1024 / 1024);
    return [
      `platform: ${os.platform()} ${os.arch()}`,
      `uptime:   ${Math.round(os.uptime() / 60)} min`,
      `cpu:      ${cpus.length}x ${cpus[0]?.model ?? "unknown"}`,
      `load avg: ${load}`,
      `memory:   ${mb(os.totalmem() - os.freemem())} MB used / ${mb(os.totalmem())} MB total`,
    ].join("\n");
  }

  if (action === "disk") {
    try {
      const st = await fs.promises.statfs(os.homedir());
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      return `disk (${os.homedir()}): ${gb(total - free)} GB used / ${gb(total)} GB total (${gb(free)} GB free)`;
    } catch (err: any) {
      return `Disk diagnostics unavailable: ${err.message}`;
    }
  }

  // services
  const results: string[] = [];
  for (const [label, bin, argv] of [
    ["pm2", "pm2", ["status"]],
    ["docker", "docker", ["ps", "--format", "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"]],
  ] as const) {
    try {
      const { stdout, stderr } = await execFileAsync(bin, [...argv], { timeout: 15000 });
      results.push(`--- ${label} ---\n${stdout || stderr || "(no output)"}`);
    } catch (err: any) {
      results.push(`--- ${label} ---\nnot available (${err.code === "ENOENT" ? "not installed" : err.message})`);
    }
  }
  return results.join("\n\n");
}

/** Expand a leading ~ and $HOME in a configured key path. */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p.replace(/^\$HOME/, os.homedir());
}

interface GceTarget {
  host: string;
  user: string;
  keyPath: string | undefined;
  port: string | undefined;
  zone: string | undefined;
  instance: string | undefined;
}

/** Resolve the GCE SSH target from environment, or an error explaining what is missing. */
function resolveGceTarget(): GceTarget | { error: string } {
  const host = process.env.GCE_SSH_HOST || process.env.GCE_EXTERNAL_IP || process.env.GCE_INTERNAL_IP || "";
  if (!host) return { error: "GCE target not configured (set GCE_SSH_HOST or GCE_EXTERNAL_IP)." };

  const user = process.env.GCE_USER || "";
  if (!user) return { error: "GCE_USER is not set." };

  // Reject anything that could be interpreted as an ssh flag or shell metachar.
  if (!SAFE_SSH_TOKEN.test(host)) return { error: `Unsafe GCE_SSH_HOST value.` };
  if (!/^[A-Za-z0-9_.-]+$/.test(user)) return { error: `Unsafe GCE_USER value.` };

  const port = process.env.GCE_SSH_PORT || "";
  if (port && !/^\d{1,5}$/.test(port)) return { error: `Unsafe GCE_SSH_PORT value.` };

  const rawKey = process.env.GCE_SSH_KEY || "";
  const keyPath = rawKey ? expandHome(rawKey) : undefined;
  if (keyPath && !fs.existsSync(keyPath)) {
    return { error: `GCE_SSH_KEY path does not exist: ${keyPath}` };
  }

  return {
    host,
    user,
    keyPath,
    port: port || undefined,
    zone: process.env.GCE_ZONE || undefined,
    instance: process.env.GCE_INSTANCE_NAME || undefined,
  };
}

/** Fixed, read-only remote commands per diagnostic action (no user input). */
function remoteCommandFor(action: DiagnosticAction): string {
  switch (action) {
    case "services":
      return "echo '--- pm2 ---'; (pm2 status 2>/dev/null || echo 'pm2 not installed'); " +
        "echo; echo '--- docker ---'; (docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'docker not available')";
    case "disk":
      return "df -h /";
    case "metrics":
    default:
      return "echo '--- uptime/load ---'; uptime; echo; echo '--- cpu count ---'; nproc 2>/dev/null || echo n/a; " +
        "echo; echo '--- memory (MB) ---'; free -m; echo; echo '--- top processes ---'; top -bn1 | head -n 12";
  }
}

/**
 * Run a read-only diagnostic command on the configured GCE VM over SSH.
 * Falls back to the LOCAL host only when GCE is unconfigured, and labels it clearly.
 */
export async function manageComputeEngine(action: DiagnosticAction): Promise<string> {
  const target = resolveGceTarget();

  if ("error" in target) {
    // Not configured: report the LOCAL host, clearly labelled, using cross-platform APIs.
    return `[LOCAL HOST — GCE not configured: ${target.error}]\n${await localDiagnostics(action)}`;
  }

  const sshArgs = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15"];
  if (target.keyPath) sshArgs.push("-i", target.keyPath);
  if (target.port) sshArgs.push("-p", target.port);
  sshArgs.push(`${target.user}@${target.host}`, remoteCommandFor(action));

  const label = target.instance
    ? `${target.instance}${target.zone ? ` (${target.zone})` : ""}`
    : target.host;

  try {
    const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
      timeout: 45000,
      maxBuffer: 1024 * 1024 * 5,
    });
    return `[GCE VM: ${label}]\n${stdout || stderr || "(no output)"}`;
  } catch (err: any) {
    return `GCE SSH Error for ${label}: ${err.message}\n${err.stderr || ""}\n(Hint: verify GCE_SSH_KEY, GCE_USER and that the VM firewall allows SSH.)`;
  }
}
