import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

const KAGGLE_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024 * 5;

function kaggleEnv(): NodeJS.ProcessEnv {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
  const pathSep = os.platform() === "win32" ? ";" : ":";
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    KAGGLE_USERNAME: user,
    KAGGLE_KEY: key,
    KAGGLE_API_TOKEN: key,
    PATH: `${process.env.PATH}${pathSep}${path.join(os.homedir(), ".local", "bin")}`,
  };
}

/** Run the Kaggle CLI, falling back to `python -m kaggle` off Windows. */
export async function kaggle(args: string[], timeout = KAGGLE_TIMEOUT_MS): Promise<string> {
  const env = kaggleEnv();
  const isWin = os.platform() === "win32";
  const cmd = isWin ? "python" : "kaggle";
  const finalArgs = isWin ? ["-X", "utf8", "-m", "kaggle", ...args] : args;

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
        const { stdout, stderr } = await execFileAsync("python", ["-X", "utf8", "-m", "kaggle", ...args], {
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
