import OpenAI from "openai";
import { colors } from "../core/colors.js";
import { AGENT_MODELS_CHAIN, callChatCompletionWithFailover, type ModelTarget, type ProviderKeyOverrides } from "./models.js";
import { buildSystemPrompt } from "./prompts.js";
import { sensitivityPayload } from "./sandbox.js";
import { toolRegistry, registeredTools, type ToolDefinition, type ToolName } from "./tools.js";
import { requestHumanApproval, isActionSensitive } from "../tools/safety.js";

// ==========================================
// Autonomous Agent Runner Loop
// ==========================================

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  initialContext?: string | undefined;
  models?: string[];
  targets?: ModelTarget[];
  /** Tools that must never be exposed or executed for this run (least-privilege). */
  disabledTools?: ToolName[];
  /** Optional request-scoped BYOK provider key overrides. */
  keyOverrides?: ProviderKeyOverrides | undefined;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentRunResult {
  success: boolean;
  finalAnswer?: string;
  stepsTaken: number;
  history: OpenAI.ChatCompletionMessageParam[];
  usage?: AgentTokenUsage;
}

/**
 * Resolve the ordered model targets for a run based on caller overrides.
 */
function resolveTargets(options: AgentOptions): ModelTarget[] {
  if (options.targets && options.targets.length > 0) {
    return options.targets;
  }
  if (options.models && options.models.length > 0) {
    return options.models.map((m) => {
      const match = AGENT_MODELS_CHAIN.find((t) => t.model === m);
      if (match) return match;
      if (m.startsWith("gemini")) return { provider: "gemini", model: m, name: m };
      if (m.includes("gpt-oss") || (m.includes("qwen") && !m.endsWith(":free"))) {
        return { provider: "groq", model: m, name: m };
      }
      return { provider: "openrouter", model: m, name: m };
    });
  }
  return AGENT_MODELS_CHAIN;
}

export async function runAutonomousAgent(
  userGoal: string,
  options: AgentOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 15;
  const temperature = options.temperature ?? 0.2;

  const targets = resolveTargets(options);

  // Least-privilege: restrict the toolset exposed to the model for this run.
  const disabled = new Set<ToolName>(options.disabledTools ?? []);
  const activeTools = registeredTools.filter(
    (t) => t.type === "function" && !disabled.has(t.function.name as ToolName)
  );
  const allowedNames = new Set(
    activeTools.map((t) => (t.type === "function" ? t.function.name : ""))
  );

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
  ];

  if (options.initialContext) {
    messages.push({
      role: "system",
      content: `Initial Workspace Context:\n${options.initialContext}`,
    });
  }

  messages.push({ role: "user", content: userGoal });

  console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
  console.log(`${colors.green}${colors.bold}🎯 Autonomous Agent Initiated${colors.reset}`);
  console.log(`${colors.green}Goal:${colors.reset} ${userGoal}`);
  console.log(`${colors.green}Max Steps:${colors.reset} ${maxSteps}`);
  console.log(`${colors.green}Primary Model:${colors.reset} [${targets[0]?.provider.toUpperCase() ?? "UNKNOWN"}] ${targets[0]?.model ?? "unknown"}`);
  console.log(`${colors.green}${colors.bold}========================================${colors.reset}\n`);

  let stepsTaken = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let step = 1; step <= maxSteps; step++) {
    stepsTaken = step;
    console.log(
      `\n${colors.cyan}${colors.bold}--- [Step ${step}/${maxSteps}] ---${colors.reset}`
    );

    try {
      const { response, usedModel } = await callChatCompletionWithFailover(
        messages,
        targets,
        activeTools,
        temperature,
        options.keyOverrides
      );

      // Accumulate industry-grade token metrics
      if (response.usage) {
        totalPromptTokens += response.usage.prompt_tokens || 0;
        totalCompletionTokens += response.usage.completion_tokens || 0;
      } else {
        const inChars = messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0);
        const outChars = response.choices?.[0]?.message?.content?.length || 0;
        totalPromptTokens += Math.ceil(inChars / 4);
        totalCompletionTokens += Math.ceil(outChars / 4);
      }

      const choice = response.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error("Received an invalid response choice from OpenRouter API.");
      }

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      // Log reasoning / thoughts if returned
      if (assistantMessage.content) {
        console.log(`\n${colors.magenta}${colors.bold}[Agent Reasoning (${usedModel})]${colors.reset}`);
        console.log(`${assistantMessage.content}`);
      }

      const toolCalls = assistantMessage.tool_calls;

      // Final Answer Check: If no tool calls, the agent concluded its task
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
        console.log(`${colors.green}${colors.bold}✅ Task Finished Successfully${colors.reset}`);
        console.log(`${colors.green}${colors.bold}========================================${colors.reset}`);
        console.log(`\n${choice.message.content || "(No text response provided)"}\n`);

        return {
          success: true,
          finalAnswer: choice.message.content || "",
          stepsTaken,
          history: messages,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
        };
      }

      // Execute tool calls in parallel (Concurrent SOTA Execution)
      const toolPromises = toolCalls.map(async (toolCall) => {
        if (toolCall.type !== "function") {
          // Every tool_call in the assistant message must be answered by a
          // matching `tool` message, otherwise the next API request is
          // rejected with "must be followed by tool messages".
          return {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            content: "Error: Unsupported non-function tool call. Skipped.",
          };
        }

        const toolName = toolCall.function.name;
        let parsedArgs: Record<string, any> = {};

        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
        } catch (parseErr: any) {
          console.error(
            `${colors.red}[Tool Parse Error]${colors.reset} Invalid JSON in arguments for ${toolName}: ${toolCall.function.arguments}`
          );
          parsedArgs = { raw: toolCall.function.arguments };
        }

        console.log(
          `\n${colors.yellow}${colors.bold}[Tool Dispatch]${colors.reset} ${colors.bold}${toolName}${colors.reset}(${JSON.stringify(
            parsedArgs,
            null,
            2
          )})`
        );

        let executionResult: string;
        const toolHandler = (toolRegistry as Record<string, ToolDefinition | undefined>)[toolName];

        if (!allowedNames.has(toolName)) {
          executionResult = `Error: Tool "${toolName}" is not permitted for this task. Allowed tools: ${[...allowedNames].join(", ")}`;
        } else if (!toolHandler) {
          executionResult = `Error: Unknown tool "${toolName}". Available tools: ${Object.keys(
            toolRegistry
          ).join(", ")}`;
        } else {
          // Centralized safety gate: EVERY tool (including shell/git) is checked here,
          // so individual wrappers can no longer bypass the human-in-the-loop guard.
          try {
            const payload = sensitivityPayload(toolName, parsedArgs);
            const sensitivity = isActionSensitive(payload);
            if (sensitivity.isSensitive) {
              const approval = await requestHumanApproval(`Tool: ${toolName}`, payload, sensitivity.reason);
              executionResult = approval.approved
                ? await toolHandler.execute(parsedArgs).catch((e: any) => `Error executing tool ${toolName}: ${e.message}`)
                : `Aborted by safety gate: ${approval.message}`;
            } else {
              executionResult = await toolHandler.execute(parsedArgs).catch((e: any) => `Error executing tool ${toolName}: ${e.message}`);
            }
          } catch (execErr: any) {
            executionResult = `Error executing tool ${toolName}: ${execErr?.message || String(execErr)}`;
          }
        }

        // Print truncated preview of tool result in console for clean readability
        const resultPreview =
          executionResult.length > 500
            ? executionResult.slice(0, 500) + `\n... [${executionResult.length - 500} more chars]`
            : executionResult;

        console.log(`${colors.blue}[Tool Result] [${toolName}]${colors.reset}\n${resultPreview}`);

        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: executionResult,
        };
      });

      const toolResults = await Promise.all(toolPromises);
      for (const res of toolResults) {
        messages.push(res);
      }
    } catch (loopError: any) {
      console.error(
        `\n${colors.red}${colors.bold}[Step Error]${colors.reset} ${loopError.message}`
      );
      return {
        success: false,
        finalAnswer: `Error during execution: ${loopError.message}`,
        stepsTaken,
        history: messages,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
      };
    }
  }

  console.warn(
    `\n${colors.yellow}${colors.bold}[Max Steps Reached]${colors.reset} Agent completed maximum allowed iterations (${maxSteps}).`
  );

  return {
    success: false,
    finalAnswer: "Max steps reached without explicit task completion.",
    stepsTaken,
    history: messages,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
    },
  };
}
