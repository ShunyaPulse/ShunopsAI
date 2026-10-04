import { execSync, spawnSync } from "node:child_process";
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

function getLLMClient(): { client: OpenAI; model: string; provider: string } {
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "llama-3.3-70b-versatile",
      provider: "GROQ",
    };
  }

  const keys = (process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length > 0) {
    return {
      client: new OpenAI({
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: keys[0],
      }),
      model: "gemini-2.5-flash",
      provider: "GEMINI",
    };
  }

  return {
    client: new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || "dummy",
    }),
    model: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "OPENROUTER",
  };
}

/**
 * Fetch all open code scanning alerts from GitHub
 */
export async function fetchOpenCodeScanningAlerts(repo = "ShunyaPulse/ShunopsAI"): Promise<CodeAlert[]> {
  try {
    const raw = execSync(`gh api repos/${repo}/code-scanning/alerts --paginate`, { encoding: "utf-8" });
    const parsed: CodeAlert[] = JSON.parse(raw || "[]");
    return parsed.filter((a) => a.state === "open");
  } catch (err: any) {
    console.error(`${colors.red}[Error fetching alerts]${colors.reset}`, err.message);
    return [];
  }
}

/**
 * Resolve a single code scanning alert automatically using LLM
 */
export async function resolveAlertWithAI(alert: CodeAlert): Promise<{ success: boolean; message: string }> {
  const filePath = alert.most_recent_instance?.location?.path;
  const lineNo = alert.most_recent_instance?.location?.start_line;
  const ruleId = alert.rule?.id || "unknown-rule";
  const toolName = alert.tool?.name || "Code Scanning Tool";

  if (!filePath) {
    return { success: false, message: "Missing file path in alert metadata" };
  }

  const fullPath = path.resolve(process.cwd(), filePath);
  let fileContent: string;
  try {
    fileContent = await fs.readFile(fullPath, "utf-8");
  } catch (e: any) {
    return { success: false, message: `Could not read file ${filePath}: ${e.message}` };
  }

  console.log(`\n${colors.cyan}${colors.bold}🔧 Resolving Alert #${alert.number} [${toolName}] ${ruleId}${colors.reset}`);
  console.log(`${colors.gray}File: ${filePath} (around line ${lineNo})${colors.reset}`);

  const { client, model, provider } = getLLMClient();

  const prompt = `You are an elite Security & TypeScript Engineer fixing a GitHub Code Scanning alert.
Alert Metadata:
- Tool: ${toolName}
- Rule: ${ruleId}
- Description: ${alert.rule?.description || alert.most_recent_instance?.message?.text || "Security violation detected"}
- Target File: ${filePath}
- Target Line: ${lineNo}

RULES FOR YOUR REPLACEMENT:
1. Provide the complete updated file content that fixes this vulnerability completely without breaking any existing features.
2. If this is "js/clear-text-logging" (sensitive info logging like tokens, passwords, keys), mask or redact the secret before logging (e.g. redact tokens with \`\${token.slice(0, 4)}***\` or avoid logging secrets altogether).
3. If this is "js/insecure-randomness", use \`randomInt\` or \`randomBytes\` from \`node:crypto\`.
4. Output ONLY the raw file content in markdown fenced block like:
\`\`\`typescript
<full code>
\`\`\`
Do not include any chat commentary or conversational filler.`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are an automated security patching engine. Return only the patched file." },
        {
          role: "user",
          content: `${prompt}\n\n### Current File Content (${filePath}):\n\`\`\`\n${fileContent}\n\`\`\``,
        },
      ],
      temperature: 0.1,
    });

    const reply = res.choices[0]?.message?.content || "";
    const codeMatch = reply.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/);
    const matchedGroup = codeMatch && codeMatch[1] ? codeMatch[1].trim() : undefined;
    const patchedCode = matchedGroup || reply.trim();

    if (!patchedCode || patchedCode.length < 50) {
      return { success: false, message: "LLM returned empty or corrupted code" };
    }

    // Backup and write
    await fs.writeFile(fullPath, patchedCode, "utf-8");

    // Verify typecheck
    try {
      execSync("npm run typecheck", { stdio: "pipe" });
      console.log(`${colors.green}✓ Alert #${alert.number} successfully patched and typechecked!${colors.reset}`);
      return { success: true, message: `Patched ${filePath} for ${ruleId}` };
    } catch (typeErr: any) {
      console.warn(`${colors.yellow}⚠️ Typecheck failed after patch. Rolling back file ${filePath}...${colors.reset}`);
      await fs.writeFile(fullPath, fileContent, "utf-8");
      return { success: false, message: `Typecheck failed: ${typeErr.message}` };
    }
  } catch (err: any) {
    return { success: false, message: `LLM inference failed: ${err.message}` };
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
    }
  }

  if (resolvedCount > 0) {
    console.log(`\n${colors.green}Pushing ${resolvedCount} auto-resolved security patches to main...${colors.reset}`);
    try {
      execSync("git add -A");
      execSync(`git commit -m "fix(security): auto-resolved ${resolvedCount} code scanning alerts by ShunopsAI [skip ci]"`);
      const pat = process.env.GH_PAT || process.env.GITHUB_PAT;
      if (pat) {
        execSync(`git push https://${pat}@github.com/ShunyaPulse/ShunopsAI.git main:main`, { stdio: "inherit" });
      } else {
        execSync("git push origin main", { stdio: "inherit" });
      }
      console.log(`${colors.green}✓ All patches pushed to GitHub main successfully!${colors.reset}`);
    } catch (pushErr: any) {
      console.error(`${colors.red}Push failed:${colors.reset}`, pushErr.message);
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
