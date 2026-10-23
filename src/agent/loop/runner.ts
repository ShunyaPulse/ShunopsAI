import type OpenAI from "openai";
import { colors } from "../../core/colors.js";
import { callChatCompletionWithFailover } from "../models.js";
import { withSpan } from "../../telemetry/otel.js";
import { autoSyncTasksOnRunCompletion } from "../../tools/agentic.js";
import {
  extractEmbeddedToolCalls,
  stripEmbeddedToolCallMarkup,
} from "./toolCallParsing.js";
import { selectEnergyEfficientToolsForGoal } from "./toolSelection.js";
import { prepareRun } from "./runContext.js";
import {
  createActionCounters,
  findUnfulfilledRequestedActions,
} from "./guardrails.js";
import { executeToolCall, type ToolCallContext } from "./toolExecution.js";
import type { AgentOptions, AgentRunResult, AgentStepLogEntry } from "./types.js";

/**
 * Autonomous Agent Runner Loop
 * - OpenTelemetry W3C TraceContext spans (`agent.run`, `tool.execute`)
 * - Real-Time Progress Event Hooks (`onProgress`) for SSE streaming
 * - 4-Format Universal Tool Call Parser
 * - Multi-Intent Action & Deliverable Verification Guardrail + task sync
 */
export async function runAutonomousAgent(
  userGoal: string,
  options: AgentOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 15;
  const temperature = options.temperature ?? 0.2;

  return withSpan(
    "agent.run",
    {
      kind: "INTERNAL",
      attributes: {
        "agent.goal": userGoal.slice(0, 160),
        "agent.max_steps": maxSteps,
        "agent.scope": options.scope?.kind || "admin",
        "agent.multimodal": Boolean(options.image),
      },
    },
    async (runSpan) => {
      const run = await prepareRun(userGoal, options);
      const { targets, scope, activeTenantKey, messages, activeTools, allowedNames } = run;

      const counters = createActionCounters();

      console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
      console.log(`${colors.green}${colors.bold}🎯 Autonomous Agent Initiated${colors.reset}`);
      console.log(`${colors.green}Goal:${colors.reset} ${userGoal}`);
      console.log(`${colors.green}Max Steps:${colors.reset} ${maxSteps}`);
      console.log(
        `${colors.green}Primary Model:${colors.reset} [${targets[0]?.provider.toUpperCase() ?? "UNKNOWN"}] ${targets[0]?.model ?? "unknown"}`
      );
      console.log(`${colors.green}${colors.bold}========================================${colors.reset}\n`);

      let stepsTaken = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let lastUsedModel = targets[0]?.model || "unknown";

      // Stage 8 & Step 2 Self-Reflection Guardrail & Action Verification Counters
      const priorToolCallSignatures = new Map<string, number>();
      const stepsLog: AgentStepLogEntry[] = [];
      let deliverableVerificationTriggered = false;

      const toolContext: Omit<ToolCallContext, "step"> = {
        scope,
        allowedNames,
        mcpToolHandlers: run.mcpToolHandlers,
        stepsLog,
        priorToolCallSignatures,
        counters,
        onProgress: options.onProgress,
      };

      for (let step = 1; step <= maxSteps; step++) {
        stepsTaken = step;
        console.log(`\n${colors.cyan}${colors.bold}--- [Step ${step}/${maxSteps}] ---${colors.reset}`);

        try {
          options.onProgress?.({
            type: "step_start",
            step,
            maxSteps,
            primaryModel: lastUsedModel,
          });
        } catch {}

        try {
          if (step === maxSteps && maxSteps > 1 && stepsLog.length > 0) {
            messages.push({
              role: "user",
              content: `[Final Step Alert]: This is your final allowed step (${step}/${maxSteps}). Formulate and deliver your comprehensive final answer to the user now based on the findings above. Do not call any further tools.`,
            });
          }

          const stepTools =
            step === maxSteps && maxSteps > 2 && stepsLog.length >= 2
              ? []
              : selectEnergyEfficientToolsForGoal(userGoal, activeTools, step);
          const { response, usedModel } = await callChatCompletionWithFailover(
            messages,
            targets,
            stepTools,
            temperature,
            options.keyOverrides
          );
          lastUsedModel = usedModel;

          // Accumulate industry-grade token metrics
          if (response.usage) {
            totalPromptTokens += response.usage.prompt_tokens || 0;
            totalCompletionTokens += response.usage.completion_tokens || 0;
          } else {
            const inChars = messages.reduce(
              (acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0),
              0
            );
            const outChars = response.choices?.[0]?.message?.content?.length || 0;
            totalPromptTokens += Math.ceil(inChars / 4);
            totalCompletionTokens += Math.ceil(outChars / 4);
          }

          const choice = response.choices?.[0];
          if (!choice || !choice.message) {
            throw new Error("Received an invalid response choice from OpenRouter API.");
          }

          const assistantMessage = choice.message;

          // Check native tool_calls first; if empty, check the text-based parser
          let toolCalls = assistantMessage.tool_calls;
          if (!toolCalls || toolCalls.length === 0) {
            const embeddedCalls = extractEmbeddedToolCalls(
              assistantMessage.content,
              allowedNames,
              step
            );
            if (embeddedCalls.length > 0) {
              toolCalls = embeddedCalls;
              assistantMessage.tool_calls = embeddedCalls;
              assistantMessage.content = stripEmbeddedToolCallMarkup(assistantMessage.content);
            }
          }

          messages.push(assistantMessage);

          // Log reasoning / thoughts if returned
          if (assistantMessage.content) {
            console.log(
              `\n${colors.magenta}${colors.bold}[Agent Reasoning (${usedModel})]${colors.reset}`
            );
            console.log(`${assistantMessage.content}`);
          }

          if (!toolCalls || toolCalls.length === 0) {
            if (!deliverableVerificationTriggered && step < maxSteps) {
              const missingPrompts = findUnfulfilledRequestedActions(
                userGoal,
                allowedNames,
                counters
              );

              if (missingPrompts.length > 0) {
                deliverableVerificationTriggered = true;
                console.log(
                  `${colors.yellow}[Action Verification Guardrail]${colors.reset} Prompting agent to complete ${missingPrompts.length} unfulfilled action(s).`
                );
                messages.push({
                  role: "user",
                  content: `[Autonomous Action Verification Guardrail]: Before concluding your final response, you must execute the following requested tool action(s):\n- ${missingPrompts.join("\n- ")}`,
                });
                continue;
              }
            }

            // Synchronize active checklist tasks when multi-tool execution finishes
            if (stepsLog.length > 0) {
              autoSyncTasksOnRunCompletion(
                activeTenantKey,
                stepsLog.map((s) => s.tool),
                userGoal
              );
            }

            const finalText = stripEmbeddedToolCallMarkup(choice.message.content || "");
            console.log(`\n${colors.green}${colors.bold}========================================${colors.reset}`);
            console.log(`${colors.green}${colors.bold}✅ Task Finished Successfully${colors.reset}`);
            console.log(`${colors.green}${colors.bold}========================================${colors.reset}`);
            console.log(`\n${finalText || "(No text response provided)"}\n`);

            runSpan.setAttribute("agent.steps_taken", stepsTaken);
            runSpan.setAttribute("agent.used_model", lastUsedModel);
            runSpan.setAttribute("agent.total_tokens", totalPromptTokens + totalCompletionTokens);

            try {
              options.onProgress?.({
                type: "final_answer",
                step,
                model: lastUsedModel,
                text: finalText,
              });
            } catch {}

            return {
              success: true,
              finalAnswer: finalText,
              stepsTaken,
              stepsLog,
              history: messages,
              usedModel: lastUsedModel,
              usage: {
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalPromptTokens + totalCompletionTokens,
              },
            };
          }

          if (assistantMessage.content) {
            try {
              options.onProgress?.({
                type: "reasoning",
                step,
                model: lastUsedModel,
                text: assistantMessage.content,
              });
            } catch {}
          }

          // Execute tool calls in parallel (Concurrent SOTA Execution)
          const toolResults = await Promise.all(
            toolCalls.map((toolCall) => executeToolCall(toolCall, { ...toolContext, step }))
          );
          for (const res of toolResults) {
            messages.push(res);
          }
        } catch (loopError: any) {
          console.error(
            `\n${colors.red}${colors.bold}[Step Error]${colors.reset} ${loopError.message}`
          );
          runSpan.setStatus("ERROR", loopError.message);
          return {
            success: false,
            finalAnswer: `Error during execution: ${loopError.message}`,
            stepsTaken,
            stepsLog,
            history: messages,
            usedModel: lastUsedModel,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
            },
          };
        }
      }

      console.warn(
        `\n${colors.yellow}${colors.bold}[Max Steps Reached]${colors.reset} Agent completed maximum allowed iterations (${maxSteps}). Running autonomous final synthesis...`
      );
      runSpan.setAttribute("agent.steps_taken", stepsTaken);
      runSpan.setAttribute("agent.max_steps_reached", true);

      // Autonomous Final Synthesis: spend one tools-disabled turn turning the
      // gathered research into a complete answer instead of returning nothing.
      try {
        const synthesisPrompt: OpenAI.ChatCompletionUserMessageParam = {
          role: "user",
          content:
            "Maximum tool execution iterations reached. Based on all research, tool results, and findings collected above, formulate and deliver your comprehensive, well-structured final answer to the user now. Do not attempt to call any more tools.",
        };
        const synthesisMessages = [...messages, synthesisPrompt];
        const { response: synthResponse, usedModel: synthModel } =
          await callChatCompletionWithFailover(
            synthesisMessages,
            targets,
            [], // Force pure text synthesis
            temperature,
            options.keyOverrides
          );

        const synthText = synthResponse.choices?.[0]?.message?.content?.trim();
        if (synthText) {
          console.log(
            `\n${colors.green}${colors.bold}[Autonomous Final Synthesis Delivered]${colors.reset}\n${synthText}`
          );
          try {
            options.onProgress?.({
              type: "final_answer",
              step: stepsTaken,
              model: synthModel,
              text: synthText,
            });
          } catch {}

          const promptToks = synthResponse.usage?.prompt_tokens || 0;
          const compToks = synthResponse.usage?.completion_tokens || 0;

          return {
            success: true,
            finalAnswer: synthText,
            stepsTaken,
            stepsLog,
            history: synthesisMessages,
            usedModel: synthModel,
            usage: {
              promptTokens: totalPromptTokens + promptToks,
              completionTokens: totalCompletionTokens + compToks,
              totalTokens:
                totalPromptTokens + totalCompletionTokens + promptToks + compToks,
            },
          };
        }
      } catch (synthError: any) {
        console.warn(`[Autonomous Synthesis Fallback Error]: ${synthError?.message || synthError}`);
      }

      return {
        success: false,
        finalAnswer: "Max steps reached without explicit task completion.",
        stepsTaken,
        stepsLog,
        history: messages,
        usedModel: lastUsedModel,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
      };
    }
  );
}
