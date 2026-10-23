import type OpenAI from "openai";
import type { ModelTarget, ProviderKeyOverrides } from "../models.js";
import type { ToolName } from "../tools.js";
import type { ToolScope } from "../scope.js";

export type AgentProgressEvent =
  | { type: "step_start"; step: number; maxSteps: number; primaryModel: string }
  | { type: "reasoning"; step: number; model: string; text: string }
  | { type: "tool_call"; step: number; name: string; args: Record<string, any> }
  | { type: "tool_result"; step: number; name: string; preview: string; isError: boolean }
  | { type: "final_answer"; step: number; model: string; text: string };

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
  /** Optional validated base64 image data URI for multimodal vision turns. */
  image?: string | undefined;
  /**
   * Whose accounts this run may touch. Defaults to the operator scope, which is
   * what internal CLI/cron/admin callers have always used.
   */
  scope?: ToolScope | undefined;
  /**
   * Optional real-time progress callback for Server-Sent Events (SSE) streaming.
   */
  onProgress?: ((event: AgentProgressEvent) => void) | undefined;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentStepLogEntry {
  step: number;
  tool: string;
  argsPreview: string;
  resultPreview: string;
  durationMs: number;
  isError: boolean;
}

export interface AgentRunResult {
  success: boolean;
  finalAnswer?: string;
  stepsTaken: number;
  stepsLog?: AgentStepLogEntry[];
  history: OpenAI.ChatCompletionMessageParam[];
  usage?: AgentTokenUsage;
  usedModel?: string;
}
