import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Google Cloud Run management via the gcloud CLI. */
export async function manageCloudRun(subcommand: string, args: string[] = []): Promise<string> {
  // No shell: pass argv directly so user-controlled values cannot inject commands.
  const argv = ["run", ...subcommand.split(/\s+/).filter(Boolean), ...args];
  try {
    const { stdout, stderr } = await execFileAsync("gcloud", argv, { timeout: 45000 });
    return stdout || stderr || "Cloud Run command executed.";
  } catch (err: any) {
    return `Cloud Run Command Error: ${err.message}\n${err.stderr || ""}`;
  }
}

/** Cloudflare Workers management via the wrangler CLI. */
export async function manageCloudflare(command: string): Promise<string> {
  // No shell: pass argv directly so user-controlled values cannot inject commands.
  const argv = command.split(/\s+/).filter(Boolean);
  try {
    const { stdout, stderr } = await execFileAsync("wrangler", argv, { timeout: 45000 });
    return stdout || stderr || "Cloudflare command executed.";
  } catch (err: any) {
    return `Cloudflare Command Error: ${err.message}\n${err.stderr || ""}`;
  }
}
