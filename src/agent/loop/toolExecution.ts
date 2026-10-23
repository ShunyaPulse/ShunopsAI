import type OpenAI from "openai";
import { colors } from "../../core/colors.js";
import { toolRegistry, type ToolDefinition } from "../tools.js";
import { type ToolScope } from "../scope.js";
import { sensitivityPayload } from "../sandbox.js";
import { requestHumanApproval, isActionSensitive } from "../../tools/safety.js";
import { withSpan } from "../../telemetry/otel.js";
import type { DynamicMcpTool } from "../mcp/registry.js";
import {
  augmentWithReflexionCue,
  isErrorToolOutput,
  recordFulfilledActions,
  type FulfilledActionCounts,
} from "./guardrails.js";
import type { AgentProgressEvent, AgentStepLogEntry } from "./types.js";

/** Shared per-run state the executor reads and updates. */
export interface ToolCallContext {
  step: number;
  scope: ToolScope | undefined;
  allowedNames: Set<string>;
  mcpToolHandlers: Map<string, DynamicMcpTool>;
  stepsLog: AgentStepLogEntry[];
  priorToolCallSignatures: Map<string, number>;
  counters: FulfilledActionCounts;
  onProgress?: ((event: AgentProgressEvent) => void) | undefined;
}

function parseToolArguments(toolName: string, raw: string | undefined): Record<string, any> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    console.error(
      `${colors.red}[Tool Parse Error]${colors.reset} Invalid JSON in arguments for ${toolName}: ${raw}`
    );
    return { raw };
  }
}

function emitProgress(ctx: ToolCallContext, event: AgentProgressEvent): void {
  try {
    ctx.onProgress?.(event);
  } catch {}
}

/** Run an MCP tool behind the same human-approval gate as native tools. */
async function runMcpTool(
  tool: DynamicMcpTool,
  toolName: string,
  parsedArgs: Record<string, any>,
  ctx: ToolCallContext,
  toolSpan: any
): Promise<string> {
  try {
    const payload = sensitivityPayload(toolName, parsedArgs);
    const sensitivity = isActionSensitive(payload);
    if (sensitivity.isSensitive) {
      const approval = await requestHumanApproval(
        `MCP Tool: ${toolName}`,
        payload,
        sensitivity.reason,
        { userId: ctx.scope?.userId, username: ctx.scope?.username }
      );
      return approval.approved
        ? await tool.execute(parsedArgs)
        : `Aborted by safety gate: ${approval.message}`;
    }
    return await tool.execute(parsedArgs);
  } catch (mcpErr: any) {
    toolSpan.setStatus("ERROR", mcpErr?.message || String(mcpErr));
    return `Error executing MCP tool ${toolName}: ${mcpErr?.message || String(mcpErr)}`;
  }
}

/** Run a native tool behind the same human-approval gate. */
async function runNativeTool(
  handler: ToolDefinition,
  toolName: string,
  parsedArgs: Record<string, any>,
  ctx: ToolCallContext,
  toolSpan: any
): Promise<string> {
  try {
    const payload = sensitivityPayload(toolName, parsedArgs);
    const sensitivity = isActionSensitive(payload);
    if (sensitivity.isSensitive) {
      const approval = await requestHumanApproval(
        `Tool: ${toolName}`,
        payload,
        sensitivity.reason,
        { userId: ctx.scope?.userId, username: ctx.scope?.username }
      );
      return approval.approved
        ? await handler
            .execute(parsedArgs, ctx.scope)
            .catch((e: any) => `Error executing tool ${toolName}: ${e.message}`)
        : `Aborted by safety gate: ${approval.message}`;
    }
    return await handler
      .execute(parsedArgs, ctx.scope)
      .catch((e: any) => `Error executing tool ${toolName}: ${e.message}`);
  } catch (execErr: any) {
    toolSpan.setStatus("ERROR", execErr?.message || String(execErr));
    return `Error executing tool ${toolName}: ${execErr?.message || String(execErr)}`;
  }
}

/**
 * Execute one model-requested tool call and return the `role: "tool"` message
 * that gets appended to the conversation.
 */
export async function executeToolCall(
  toolCall: OpenAI.ChatCompletionMessageToolCall,
  ctx: ToolCallContext
): Promise<OpenAI.ChatCompletionMessageParam> {
  if (toolCall.type !== "function") {
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: "Error: Unsupported non-function tool call. Skipped.",
    };
  }

  const toolName = toolCall.function.name;
  const parsedArgs = parseToolArguments(toolName, toolCall.function.arguments);

  console.log(
    `\n${colors.yellow}${colors.bold}[Tool Dispatch]${colors.reset} ${colors.bold}${toolName}${colors.reset}(${JSON.stringify(
      parsedArgs,
      null,
      2
    )})`
  );

  emitProgress(ctx, { type: "tool_call", step: ctx.step, name: toolName, args: parsedArgs });

  const callSignature = `${toolName}:${JSON.stringify(parsedArgs)}`;
  const repeatCount = (ctx.priorToolCallSignatures.get(callSignature) || 0) + 1;
  ctx.priorToolCallSignatures.set(callSignature, repeatCount);

  return withSpan(
    `tool.execute ${toolName}`,
    {
      kind: "INTERNAL",
      attributes: {
        "tool.name": toolName,
        "tool.step": ctx.step,
        "tool.is_mcp": ctx.mcpToolHandlers.has(toolName),
      },
    },
    async (toolSpan) => {
      const toolStartMs = Date.now();
      let executionResult: string;
      const toolHandler = (toolRegistry as Record<string, ToolDefinition | undefined>)[toolName];

      if (!ctx.allowedNames.has(toolName)) {
        executionResult = `Error: Tool "${toolName}" is not permitted for this task. Allowed tools: ${[...ctx.allowedNames].join(", ")}`;
        toolSpan.setStatus("ERROR", "Tool not permitted for scope");
      } else if (ctx.mcpToolHandlers.has(toolName)) {
        executionResult = await runMcpTool(
          ctx.mcpToolHandlers.get(toolName)!,
          toolName,
          parsedArgs,
          ctx,
          toolSpan
        );
      } else if (!toolHandler) {
        executionResult = `Error: Unknown tool "${toolName}". Available tools: ${Object.keys(
          toolRegistry
        ).join(", ")}`;
        toolSpan.setStatus("ERROR", "Unknown tool");
      } else {
        executionResult = await runNativeTool(toolHandler, toolName, parsedArgs, ctx, toolSpan);
      }

      const isErrorOutput = isErrorToolOutput(executionResult);

      // Track fulfilled agentic actions for Step 2 verification guardrail
      if (!isErrorOutput) {
        recordFulfilledActions(toolName, parsedArgs, executionResult, ctx.counters);
      }

      executionResult = augmentWithReflexionCue(
        toolName,
        executionResult,
        isErrorOutput,
        repeatCount
      );

      const resultPreview =
        executionResult.length > 500
          ? executionResult.slice(0, 500) + `\n... [${executionResult.length - 500} more chars]`
          : executionResult;

      console.log(`${colors.blue}[Tool Result] [${toolName}]${colors.reset}\n${resultPreview}`);

      const toolDurationMs = Math.max(1, Date.now() - toolStartMs);
      ctx.stepsLog.push({
        step: ctx.step,
        tool: toolName,
        argsPreview: JSON.stringify(parsedArgs).slice(0, 180),
        resultPreview: resultPreview.slice(0, 260),
        durationMs: toolDurationMs,
        isError: isErrorOutput,
      });

      emitProgress(ctx, {
        type: "tool_result",
        step: ctx.step,
        name: toolName,
        preview: resultPreview.slice(0, 240),
        isError: isErrorOutput,
      });

      return {
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: executionResult,
      };
    }
  );
}
