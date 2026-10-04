import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

// ANSI color helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export interface CodeAlert {
  number: number;
  rule: {
    id: string;
    name?: string;
    description?: string;
    severity?: string;
    help?: string;
  };
  tool: {
    name: string;
  };
  most_recent_instance: {
    location: {
      path: string;
      start_line: number;
      end_line?: number;
      start_column?: number;
      end_column?: number;
    };
    message?: {
      text: string;
    };
  };
  state: "open" | "fixed" | "dismissed";
}

function getAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.GH_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "";
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

function getLLMClient(): { client: OpenAI; model: string; provider: string } {
  const apiKey = process.env.GROQ_API_KEY || "dummy";
  return {
    client: new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey,
    }),
    model: "openai/gpt-oss-120b",
    provider: "GROQ",
  };
}

/**
 * Fetch all open code scanning alerts from GitHub
 */
export async function fetchOpenCodeScanningAlerts(repo = "ShunyaPulse/ShunopsAI"): Promise<CodeAlert[]> {
  try {
    // execFileSync (argv form) avoids shell interpolation of the repo name.
    const raw = execFileSync("gh", ["api", `repos/${repo}/code-scanning/alerts`, "--paginate"], {
      encoding: "utf-8",
      env: getAuthEnv(),
    });
    const parsed: CodeAlert[] = JSON.parse(raw || "[]");
    return parsed.filter((a) => a.state === "open");
  } catch (err: any) {
    console.error(`[Error fetching alerts] ${String(err?.message || err)}`);
    return [];
  }
}

/**
 * Resolve a single code scanning alert automatically using targeted search/replace
 */
export async function resolveAlertWithAI(alert: CodeAlert): Promise<{ success: boolean; message: string }> {
  const filePath = alert.most_recent_instance?.location?.path;
  const lineNo = alert.most_recent_instance?.location?.start_line;
  const ruleId = alert.rule?.id || "unknown-rule";
  const toolName = alert.tool?.name || "Code Scanning Tool";

  if (!filePath || !lineNo) {
    return { success: false, message: "Missing file path or line number in alert metadata" };
  }

  const fullPath = path.resolve(process.cwd(), filePath);
  let fileContent: string;
  try {
    fileContent = await fs.readFile(fullPath, "utf-8");
  } catch (e: any) {
    return { success: false, message: `Could not read file ${filePath}: ${e.message}` };
  }

  const lines = fileContent.split("\n");
  const startIdx = Math.max(0, lineNo - 12);
  const endIdx = Math.min(lines.length, lineNo + 12);
  const snippet = lines.slice(startIdx, endIdx).join("\n");

  console.log(`\n${colors.cyan}${colors.bold}🔧 Resolving Alert #${alert.number} [${toolName}] ${ruleId}${colors.reset}`);
  console.log(`${colors.gray}File: ${filePath}:${lineNo}${colors.reset}`);

  const { client, model } = getLLMClient();

  const prompt = `You are an elite Security & TypeScript Engineer fixing a GitHub Code Scanning alert.
Alert Details:
- Tool: ${toolName}
- Rule: ${ruleId}
- Description: ${alert.rule?.description || alert.most_recent_instance?.message?.text || "Security violation detected"}
- Target File: ${filePath}
- Flagged Line: ${lineNo}

Context Snippet from ${filePath}:
\`\`\`typescript
${snippet}
\`\`\`

RULES FOR SECURITY FIX:
1. For "js/clear-text-logging" (sensitive info logging like tokens, keys, passwords):
   - Redact or mask the secret (e.g. replace \`\${token}\` with \`\${token ? token.slice(0, 4) + '***' : 'none'}\` or '[REDACTED]').
2. For "js/insecure-randomness":
   - Replace Math.random() with randomInt() from 'node:crypto'.
3. For "js/unvalidated-dynamic-method-call":
   - Use an allowlist or explicit property validation check.
4. For "js/reflected-xss":
   - Sanitize or escape any user parameter before returning it in HTML.
5. For "unsafe-formatstring":
   - Ensure the first argument of console.error/console.log is a constant string literal without variable interpolations, or use string concatenation.

OUTPUT FORMAT:
Output ONLY a JSON object with two fields:
{
  "search": "exact string to find in the snippet",
  "replace": "replacement string with the security fix"
}
Do NOT include any markdown code blocks, conversational text, or explanation. ONLY the raw JSON.`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are an automated security patching engine. Return ONLY valid JSON with search and replace keys." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    });

    const reply = res.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, message: `Model did not return valid JSON: ${reply.slice(0, 100)}` };
    }

    const { search, replace } = JSON.parse(jsonMatch[0]);
    if (!search || typeof replace !== "string") {
      return { success: false, message: "Parsed JSON missing search or replace string" };
    }

    if (!fileContent.includes(search)) {
      return { success: false, message: `Search target not found in ${filePath}` };
    }

    const patchedCode = fileContent.replace(search, replace);
    await fs.writeFile(fullPath, patchedCode, "utf-8");

    // Verify typecheck
    try {
      execFileSync("npm", ["run", "typecheck"], { stdio: "pipe" });
      console.log(`${colors.green}✓ Alert #${alert.number} successfully patched & verified with typecheck!${colors.reset}`);
      return { success: true, message: `Patched ${filePath} for ${ruleId}` };
    } catch (typeErr: any) {
      console.warn(`${colors.yellow}⚠️ Typecheck failed after patch. Rolling back file ${filePath}...${colors.reset}`);
      await fs.writeFile(fullPath, fileContent, "utf-8");
      return { success: false, message: `Typecheck failed: ${typeErr.message}` };
    }
  } catch (err: any) {
    return { success: false, message: `LLM inference or parse failed: ${err.message}` };
  }
}

/**
 * Main automated loop to resolve all open code scanning alerts
 */
export async function runAutoAlertResolver(limit = 10): Promise<{ resolved: number; total: number }> {
  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🤖 ShunopsAI Autonomous Code Scanning Alert Resolver${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);

  const alerts = await fetchOpenCodeScanningAlerts();
  console.log(`Found ${alerts.length} open security & quality alerts.`);

  if (alerts.length === 0) {
    console.log(`${colors.green}All code scanning alerts are already clean! 🎉${colors.reset}`);
    return { resolved: 0, total: 0 };
  }

  let resolvedCount = 0;
  const toProcess = alerts.slice(0, limit);

  for (const alert of toProcess) {
    const res = await resolveAlertWithAI(alert);
    if (res.success) {
      resolvedCount++;
    } else {
      console.log(`${colors.gray}Notice on #${alert.number}: ${res.message}${colors.reset}`);
    }
  }

  if (resolvedCount > 0) {
    console.log(`\n${colors.green}Pushing ${resolvedCount} auto-resolved security patches to main...${colors.reset}`);
    try {
      execFileSync("git", ["add", "-A"]);
      execFileSync("git", [
        "commit",
        "-m",
        `fix(security): auto-resolved ${resolvedCount} code scanning alerts by ShunopsAI [skip ci]`,
      ]);
      const pat = process.env.GH_PAT || process.env.GITHUB_PAT;
      const authEnv = getAuthEnv();
      if (pat) {
        execFileSync(
          "git",
          ["push", `https://${pat}@github.com/ShunyaPulse/ShunopsAI.git`, "main:main"],
          { stdio: "inherit", env: authEnv }
        );
      } else {
        execFileSync("git", ["push", "origin", "main"], { stdio: "inherit", env: authEnv });
      }
      console.log(`${colors.green}✓ All patches pushed to GitHub main successfully!${colors.reset}`);
    } catch (pushErr: any) {
      console.error(`[Push failed] ${String(pushErr?.message || pushErr)}`);
    }
  }

  return { resolved: resolvedCount, total: alerts.length };
}

// CLI handler
const isCLI = process.argv[1]?.endsWith("code-scanner-resolver.ts") || process.argv[1]?.endsWith("code-scanner-resolver.js");
if (isCLI) {
  const limit = parseInt(process.argv[2] || "5", 10);
  runAutoAlertResolver(limit).then((res) => {
    console.log(`\nBatch complete: ${res.resolved}/${res.total} alerts resolved.`);
    process.exit(0);
  });
}

