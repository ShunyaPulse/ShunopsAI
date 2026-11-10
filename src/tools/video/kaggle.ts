import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { resolvePythonBin } from "../kokoro-tts.js";

const execFileAsync = promisify(execFile);

const KAGGLE_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024 * 5;

/**
 * Ensures ~/.kaggle/kaggle.json exists with secure permissions on Linux/Mac/Windows.
 * Prevents CLI authentication failures on cloud runners where secrets are provided as env vars.
 */
function ensureKaggleCredentials(): void {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "romomaxer";
  const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
  if (!user || !key) return;

  try {
    const kaggleDir = path.join(os.homedir(), ".kaggle");
    const kaggleJson = path.join(kaggleDir, "kaggle.json");
    if (!fs.existsSync(kaggleDir)) {
      fs.mkdirSync(kaggleDir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(kaggleJson, JSON.stringify({ username: user, key }), { mode: 0o600 });
  } catch {}
}

function kaggleEnv(): NodeJS.ProcessEnv {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "romomaxer";
  const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
  const kaggleDir = path.join(os.homedir(), ".kaggle");
  const pathSep = os.platform() === "win32" ? ";" : ":";
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    KAGGLE_USERNAME: user,
    KAGGLE_KEY: key,
    KAGGLE_API_TOKEN: key,
    KAGGLE_CONFIG_DIR: kaggleDir,
    PATH: `${process.env.PATH}${pathSep}${path.join(os.homedir(), ".local", "bin")}`,
  };
}

/**
 * Normalizes Kaggle CLI arguments to guarantee dataset subdirectories are never skipped
 * and paths are resolved to absolute to prevent Windows upload mangling.
 */
function normalizeKaggleArgs(args: string[]): string[] {
  const normalized = [...args];
  if (normalized[0] === "datasets" && (normalized[1] === "create" || normalized[1] === "version")) {
    const hasDirMode = normalized.includes("--dir-mode") || normalized.includes("-r");
    if (!hasDirMode) {
      normalized.push("-r", "zip");
    }
    const pIdx = normalized.findIndex((a) => a === "-p" || a === "--path");
    if (pIdx !== -1 && pIdx + 1 < normalized.length) {
      const targetPath = normalized[pIdx + 1];
      if (targetPath) {
        normalized[pIdx + 1] = path.resolve(targetPath);
      }
    }
  }
  return normalized;
}

/** Run the Kaggle CLI, falling back to `python3 -m kaggle` / `python -m kaggle` off Windows. */
export async function kaggle(args: string[], timeout = KAGGLE_TIMEOUT_MS): Promise<string> {
  ensureKaggleCredentials();
  const env = kaggleEnv();
  const safeArgs = normalizeKaggleArgs(args);
  const isWin = os.platform() === "win32";
  const cmd = isWin ? await resolvePythonBin() : "kaggle";
  const finalArgs = isWin ? ["-X", "utf8", "-m", "kaggle", ...safeArgs] : safeArgs;

  try {
    const { stdout, stderr } = await execFileAsync(cmd, finalArgs, {
      env,
      timeout,
      maxBuffer: MAX_BUFFER,
    });
    return (stdout + (stderr ? `\n${stderr}` : "")).trim();
  } catch (e: any) {
    if (!isWin) {
      try {
        const pyBin = await resolvePythonBin();
        const { stdout, stderr } = await execFileAsync(pyBin, ["-X", "utf8", "-m", "kaggle", ...safeArgs], {
          env,
          timeout,
          maxBuffer: MAX_BUFFER,
        });
        return (stdout + (stderr ? `\n${stderr}` : "")).trim();
      } catch (pyErr: any) {
        return `Kaggle CLI Error: ${pyErr.message}\n${pyErr.stderr || ""}`.trim();
      }
    }
    return `Kaggle CLI Error: ${e.message}\n${e.stderr || ""}`.trim();
  }
}
