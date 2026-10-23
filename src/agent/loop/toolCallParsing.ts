import type OpenAI from "openai";

/**
 * Strip raw XML/ReAct tool-call tags (`<tool_call>...</tool_call>`, `<function=...>...</function>`)
 * from assistant text so internal tool markup never leaks into UI chat bubbles.
 */
export function stripEmbeddedToolCallMarkup(content: string | null | undefined): string {
  if (!content || typeof content !== "string") return "";
  return content
    .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/gi, "")
    .replace(/<function=[a-zA-Z0-9_:-]+>\s*[\s\S]*?\s*<\/function>/gi, "")
    .replace(/<function=[a-zA-Z0-9_:-]+\(\s*\{[\s\S]*?\}\s*\)\s*\/?>/gi, "")
    .trim();
}

type ParsedInvocation = { name: string; arguments: unknown };

/** Read `{name, arguments|args|parameters}` from a parsed payload. */
function readInvocation(parsed: any): ParsedInvocation | null {
  const name = String(parsed?.name || parsed?.tool || "").trim();
  if (!name) return null;
  // Preserve `null` vs. absent so the fenced-block parser can keep its
  // "arguments must be present" rule exactly as before.
  const args =
    parsed?.arguments !== undefined
      ? parsed.arguments
      : parsed?.args !== undefined
        ? parsed.args
        : parsed?.parameters;
  return { name, arguments: args };
}

function toToolCall(
  parsed: ParsedInvocation,
  id: string,
  allowedNames: Set<string>,
  requireArgs = false
): OpenAI.ChatCompletionMessageToolCall | null {
  if (!allowedNames.has(parsed.name)) return null;
  if (requireArgs && parsed.arguments === undefined) return null;
  const args = parsed.arguments === undefined ? {} : parsed.arguments;
  return {
    id,
    type: "function",
    function: {
      name: parsed.name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  };
}

function safeJsonParse(raw: string): { ok: true; value: any } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/**
 * Extract tool invocations across all 4 common LLM text-based tool-call formats:
 * 1. `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` (Hermes / Qwen / Universal)
 * 2. `<function=tool_name>{"arg": ...}</function>` or `<function=tool_name({...})>` (Llama 3.1/3.3 on Groq & Cloudflare)
 * 3. `Action: tool_name\nAction Input: {...}` (Classic ReAct format)
 * 4. Fenced ```tool_call / ```json blocks with `{"name": "...", "arguments": {...}}`
 */
export function extractEmbeddedToolCalls(
  content: string | null | undefined,
  allowedNames: Set<string>,
  step: number
): OpenAI.ChatCompletionMessageToolCall[] {
  if (!content || typeof content !== "string") return [];
  const extracted: OpenAI.ChatCompletionMessageToolCall[] = [];

  // 1. Check `<tool_call>...</tool_call>` tags
  const xmlMatches = Array.from(content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi));
  for (let i = 0; i < xmlMatches.length; i++) {
    const parsed = safeJsonParse((xmlMatches[i]?.[1] || "").trim());
    const invocation = parsed.ok ? readInvocation(parsed.value) : null;
    if (!invocation) continue;
    const call = toToolCall(invocation, `call_xml_${step}_${i}`, allowedNames);
    if (call) extracted.push(call);
  }
  if (extracted.length > 0) return extracted;

  // 2. Check Llama-style `<function=tool_name>{...}</function>` or `<function=tool_name({...})>`
  const llamaMatches = Array.from(
    content.matchAll(
      /<function=([a-zA-Z0-9_:-]+)(?:>\s*(\{[\s\S]*?\})\s*<\/function>|\(\s*(\{[\s\S]*?\})\s*\)\s*\/?>)/gi
    )
  );
  for (let i = 0; i < llamaMatches.length; i++) {
    const toolName = (llamaMatches[i]?.[1] || "").trim();
    const rawArgs = (llamaMatches[i]?.[2] || llamaMatches[i]?.[3] || "{}").trim();
    if (!toolName || !allowedNames.has(toolName)) continue;
    const parsedArgs = safeJsonParse(rawArgs);
    if (!parsedArgs.ok) continue;
    extracted.push({
      id: `call_llama_${step}_${i}`,
      type: "function",
      function: { name: toolName, arguments: JSON.stringify(parsedArgs.value) },
    });
  }
  if (extracted.length > 0) return extracted;

  // 3. Check Classic ReAct `Action: <tool_name>` + `Action Input: {...}`
  const reactMatches = Array.from(
    content.matchAll(/Action\s*:\s*`?([a-zA-Z0-9_:-]+)`?\s*[\r\n]+Action\s+Input\s*:\s*(\{[\s\S]*?\})(?=\r?\n(?:Thought|Action|Observation|$)|$)/gi)
  );
  for (let i = 0; i < reactMatches.length; i++) {
    const toolName = (reactMatches[i]?.[1] || "").trim();
    const rawArgs = (reactMatches[i]?.[2] || "{}").trim();
    if (!toolName || !allowedNames.has(toolName)) continue;
    const parsedArgs = safeJsonParse(rawArgs);
    if (!parsedArgs.ok) continue;
    extracted.push({
      id: `call_react_${step}_${i}`,
      type: "function",
      function: { name: toolName, arguments: JSON.stringify(parsedArgs.value) },
    });
  }
  if (extracted.length > 0) return extracted;

  // 4. Check fenced ```json or ```tool_call blocks that represent a tool invocation
  const fenceMatches = Array.from(
    content.matchAll(/```(?:tool_call|json)?\s*(\{[\s\S]*?\})\s*```/gi)
  );
  for (let i = 0; i < fenceMatches.length; i++) {
    const parsed = safeJsonParse((fenceMatches[i]?.[1] || "").trim());
    const invocation = parsed.ok ? readInvocation(parsed.value) : null;
    if (!invocation) continue;
    const call = toToolCall(invocation, `call_fence_${step}_${i}`, allowedNames, true);
    if (call) extracted.push(call);
  }

  return extracted;
}
