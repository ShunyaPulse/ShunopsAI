import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CodeFlawCandidate } from "./types.js";

// ==========================================
// Heuristic flaw scanning
// ==========================================

const SKIPPED_DIRECTORIES = ["node_modules", "dist", ".git", ".next", ".cache", "tmp"];
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|mjs)$/;
const SELF_AUDIT_FILES = ["autonomous-repo-auditor", "code-scanner-resolver"];

/** A ±4-line window around a flagged line, used as model context. */
function surroundingSnippet(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 5)).join("\n");
}

function isTestFile(filePath: string): boolean {
  return filePath.includes(".test.") || filePath.includes("test_") || filePath.includes("spec.");
}

function flaw(
  filePath: string,
  lineNo: number,
  lines: string[],
  index: number,
  category: CodeFlawCandidate["category"],
  ruleId: string,
  description: string
): CodeFlawCandidate {
  return { filePath, lineNo, snippet: surroundingSnippet(lines, index), category, ruleId, description };
}

/** Rule 1: insecure randomness used for tokens, ids, or secrets. */
function detectInsecureRandomness(
  filePath: string,
  line: string,
  lines: string[],
  index: number,
  lineNo: number
): CodeFlawCandidate | null {
  if (!/Math\.random\(\)/.test(line) || isTestFile(filePath)) return null;
  if (!/id|token|key|secret|auth|nonce|session|approval/i.test(line)) return null;

  return flaw(
    filePath,
    lineNo,
    lines,
    index,
    "security",
    "insecure-randomness-for-secrets",
    "Math.random() used in security or identity sensitive context. Replace with crypto.randomInt() or crypto.randomBytes()."
  );
}

/** Rule 2: shell execution built from an interpolated template string. */
function detectShellInjection(
  filePath: string,
  line: string,
  lines: string[],
  index: number,
  lineNo: number
): CodeFlawCandidate | null {
  if (!/execSync\s*\(\s*`[^`]*\$\{/.test(line)) return null;

  return flaw(
    filePath,
    lineNo,
    lines,
    index,
    "security",
    "shell-command-injection-risk",
    "execSync with template string interpolation vulnerable to shell injection. Replace with execFileSync and argv array."
  );
}

/** Rule 3: sensitive values or unredacted errors written to the console. */
function detectSensitiveLogging(
  filePath: string,
  line: string,
  lines: string[],
  index: number,
  lineNo: number
): CodeFlawCandidate | null {
  const logsSensitiveInterpolation =
    /console\.(?:error|log)\([^)]*(?:\$\{[^}]*(?:token|secret|key|password|apiKey|cred)[^}]*\}|(?:\btoken\b|\bsecret\b|\bapiKey\b|\bpassword\b)\s*[,)])/i.test(
      line
    );
  const logsSensitiveErrorMessage =
    /console\.error\([^)]*(?:err\.message|error\.message)[^)]*\)/.test(line) && /token|secret|key|api|auth/i.test(line);

  if (!logsSensitiveInterpolation && !logsSensitiveErrorMessage) return null;

  return flaw(
    filePath,
    lineNo,
    lines,
    index,
    "security",
    "clear-text-sensitive-logging",
    "Potentially sensitive token, secret, or unredacted error logged to console. Redact or mask the value."
  );
}

/** Rule 4: hardcoded local user filesystem paths. */
function detectHardcodedUserPath(
  filePath: string,
  line: string,
  lines: string[],
  index: number,
  lineNo: number
): CodeFlawCandidate | null {
  if (!/[a-zA-Z]:\\\\Users\\\\/i.test(line) && !/\/Users\/[a-zA-Z0-9_-]+\//i.test(line)) return null;

  return flaw(
    filePath,
    lineNo,
    lines,
    index,
    "reliability",
    "hardcoded-user-path",
    "Hardcoded local user filesystem path. Replace with configurable env var or relative path."
  );
}

const HEURISTIC_RULES = [
  detectInsecureRandomness,
  detectShellInjection,
  detectSensitiveLogging,
  detectHardcodedUserPath,
];

/**
 * Scan a single file for known bug patterns and security anti-patterns
 */
export function scanFileForHeuristicFlaws(filePath: string, content: string): CodeFlawCandidate[] {
  if (SELF_AUDIT_FILES.some((name) => filePath.includes(name))) {
    return [];
  }

  const flaws: CodeFlawCandidate[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    for (const rule of HEURISTIC_RULES) {
      const detected = rule(filePath, line, lines, i, lineNo);
      if (detected) flaws.push(detected);
    }
  }

  return flaws;
}

/**
 * List every source file in a repository directory, relative to `baseDir`
 */
async function getSourceFiles(dir: string, baseDir = dir): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        continue;
      }
      results.push(...(await getSourceFiles(full, baseDir)));
    } else if (entry.isFile()) {
      if (SOURCE_FILE_PATTERN.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        results.push(rel);
      }
    }
  }
  return results;
}

/** Read every source file under `rootDir` and collect heuristic flaw candidates. */
export async function collectFlawCandidates(
  rootDir: string
): Promise<{ files: string[]; flaws: CodeFlawCandidate[] }> {
  const files = await getSourceFiles(rootDir);
  console.log(`Auditing ${files.length} source code files for vulnerabilities and flaws...`);

  const flaws: CodeFlawCandidate[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(path.resolve(rootDir, file), "utf-8");
      flaws.push(...scanFileForHeuristicFlaws(file, content));
    } catch {}
  }

  return { files, flaws };
}
