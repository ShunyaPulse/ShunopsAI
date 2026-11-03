// [DISABLED - KAGGLE BENCHMARKS / MODEL PROXY]
// import { execFile } from "node:child_process";
// import { promisify } from "node:util";
// import * as os from "node:os";
// import * as path from "node:path";
// import * as fs from "node:fs/promises";
// import * as dotenv from "dotenv";
// import { colors } from "../core/colors.js";
// import { callChatCompletionWithFailover, AGENT_MODELS_CHAIN } from "../agent/models.js";
// import type OpenAI from "openai";
// 
// dotenv.config();
// 
// const execFileAsync = promisify(execFile);
// 
// const KAGGLE_AI_TIMEOUT_MS = 180000; // 3 minutes timeout for batch evaluation
// 
// export interface KaggleAiTaskOptions {
//   taskName: string;
//   systemPrompt?: string | undefined;
//   prompt: string;
//   model?: string | undefined;
//   temperature?: number | undefined;
//   maxTokens?: number | undefined;
// }
// 
// export interface KaggleAiTaskResult {
//   success: boolean;
//   modelUsed: string;
//   output: string;
//   durationMs: number;
//   source: "kaggle_ai_quota" | "fallback_cascade";
//   error?: string | undefined;
// }
// 
// /** Check if Kaggle credentials are configured in the environment. */
// export function isKaggleConfigured(): boolean {
//   const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME;
//   const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
//   return Boolean(user && key);
// }
// 
// /** Get sanitized Kaggle environment with credentials mapped. */
// function getKaggleEnv(): NodeJS.ProcessEnv {
//   const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
//   const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
//   const pathSep = os.platform() === "win32" ? ";" : ":";
// 
//   return {
//     ...process.env,
//     PYTHONIOENCODING: "utf-8",
//     PYTHONUTF8: "1",
//     KAGGLE_USERNAME: user,
//     KAGGLE_KEY: key,
//     KAGGLE_API_TOKEN: key,
//     PATH: `${process.env.PATH}${pathSep}${path.join(os.homedir(), ".local", "bin")}`,
//   };
// }
// 
// /**
//  * Executes a prompt against Kaggle's hosted AI model evaluation infrastructure ($10 daily quota).
//  * If Kaggle is unavailable or unauthenticated, smoothly cascades to the existing multi-provider
//  * fallback chain (Active Gemini Key Pool -> Groq LPUs -> OpenRouter) per Invariant 3.
//  */
// export async function runKaggleAiTask(options: KaggleAiTaskOptions): Promise<KaggleAiTaskResult> {
//   const startTime = Date.now();
//   const targetModel = options.model || "claude-3-5-sonnet";
// 
//   if (!isKaggleConfigured()) {
//     console.log(
//       `${colors.yellow}⚠️ [Kaggle AI] Credentials not detected. Cascading to Multi-Provider Fallback.${colors.reset}`
//     );
//     return fallbackToLocalCascade(options, startTime);
//   }
// 
//   // Attempt headless execution via python script using kaggle_benchmarks or kbench
//   const tempScriptDir = path.join(os.tmpdir(), "kaggle-ai-runners");
//   await fs.mkdir(tempScriptDir, { recursive: true });
//   const scriptPath = path.join(tempScriptDir, `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.py`);
// 
//   const runnerPythonCode = `
// import sys
// import json
// 
// task_prompt = ${JSON.stringify(options.prompt)}
// system_prompt = ${JSON.stringify(options.systemPrompt || "")}
// model_name = ${JSON.stringify(targetModel)}
// 
// try:
//     import kaggle_benchmarks as kbench
//     # Run evaluation using Kaggle's hosted model proxy
//     @kbench.task
//     def execute_eval(llm):
//         full_p = f"{system_prompt}\\n\\n{task_prompt}" if system_prompt else task_prompt
//         resp = llm.prompt(full_p)
//         return resp.text
// 
//     result = kbench.run(execute_eval, model=model_name)
//     print(json.dumps({"success": True, "output": str(result)}))
// except Exception as e:
//     # If kbench runtime encounters issues, return JSON error
//     print(json.dumps({"success": False, "error": str(e)}))
// `;
// 
//   try {
//     await fs.writeFile(scriptPath, runnerPythonCode, "utf-8");
//     const env = getKaggleEnv();
//     const isWin = os.platform() === "win32";
//     const cmd = isWin ? "python" : "python3";
// 
//     const { stdout, stderr } = await execFileAsync(cmd, [scriptPath], {
//       env,
//       timeout: KAGGLE_AI_TIMEOUT_MS,
//       maxBuffer: 10 * 1024 * 1024,
//     });
// 
//     await fs.unlink(scriptPath).catch(() => {});
// 
//     // Parse output
//     const trimmed = (stdout || "").trim();
//     const lastLine = trimmed.split("\n").filter(Boolean).pop() || "{}";
//     try {
//       const parsed = JSON.parse(lastLine);
//       if (parsed.success && parsed.output) {
//         return {
//           success: true,
//           modelUsed: `Kaggle-Hosted/${targetModel}`,
//           output: parsed.output,
//           durationMs: Date.now() - startTime,
//           source: "kaggle_ai_quota",
//         };
//       }
//     } catch {
//       // JSON parse failed, proceed to fallback
//     }
//   } catch (err: any) {
//     await fs.unlink(scriptPath).catch(() => {});
//     console.log(
//       `${colors.yellow}⚠️ [Kaggle AI] Execution failed (${err.message}). Cascading to Multi-Provider Fallback.${colors.reset}`
//     );
//   }
// 
//   // Graceful degradation per Multi-Provider Fallback Cascade Rule
//   return fallbackToLocalCascade(options, startTime);
// }
// 
// /** Multi-Provider Fallback Cascade (Active Gemini -> Groq 120B -> OpenRouter). */
// async function fallbackToLocalCascade(
//   options: KaggleAiTaskOptions,
//   startTime: number
// ): Promise<KaggleAiTaskResult> {
//   try {
//     const messages: OpenAI.ChatCompletionMessageParam[] = [];
//     if (options.systemPrompt) {
//       messages.push({ role: "system", content: options.systemPrompt });
//     }
//     messages.push({ role: "user", content: options.prompt });
// 
//     const completion = await callChatCompletionWithFailover(
//       messages,
//       AGENT_MODELS_CHAIN,
//       [],
//       options.temperature ?? 0.2
//     );
// 
//     const replyContent = completion.response.choices[0]?.message?.content || "";
// 
//     return {
//       success: true,
//       modelUsed: completion.usedModel || "fallback-model",
//       output: replyContent,
//       durationMs: Date.now() - startTime,
//       source: "fallback_cascade",
//     };
//   } catch (fallbackErr: any) {
//     return {
//       success: false,
//       modelUsed: "none",
//       output: "",
//       durationMs: Date.now() - startTime,
//       source: "fallback_cascade",
//       error: fallbackErr.message || "All fallback models exhausted",
//     };
//   }
// }
// 
