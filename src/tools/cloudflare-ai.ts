/**
 * Cloudflare Workers AI & Model Inference Tool
 * Provides direct REST API inference for Cloudflare Workers AI models & Embeddings.
 */

export interface CloudflareAiOptions {
  model?: string | undefined;
  prompt?: string | undefined;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface CloudflareAiResponse {
  success: boolean;
  result?: any;
  errors?: any[];
  latencyMs?: number;
}

/**
 * Run inference on Cloudflare Workers AI
 */
export async function runCloudflareAiInference(
  promptOrOptions: string | CloudflareAiOptions
): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    return "Error: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not configured in .env.";
  }

  const defaultModel =
    process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";

  let model = defaultModel;
  let bodyPayload: any = {};

  if (typeof promptOrOptions === "string") {
    bodyPayload = {
      prompt: promptOrOptions,
      max_tokens: 1024,
    };
  } else {
    model = promptOrOptions.model || defaultModel;
    if (promptOrOptions.messages && promptOrOptions.messages.length > 0) {
      bodyPayload = {
        messages: promptOrOptions.messages,
        max_tokens: promptOrOptions.maxTokens || 1024,
        temperature: promptOrOptions.temperature ?? 0.7,
      };
    } else {
      bodyPayload = {
        prompt: promptOrOptions.prompt || "",
        max_tokens: promptOrOptions.maxTokens || 1024,
        temperature: promptOrOptions.temperature ?? 0.7,
      };
    }
  }

  // If a custom LoRA adapter is configured in .env and model supports it
  if (process.env.CLOUDFLARE_LORA_NAME && !bodyPayload.lora) {
    bodyPayload.lora = process.env.CLOUDFLARE_LORA_NAME;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const start = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(30000),
    });

    const latencyMs = Date.now() - start;
    const data = (await res.json()) as any;

    if (!res.ok || !data.success) {
      const errMsg = JSON.stringify(data.errors || data);
      return `Cloudflare AI Error (${res.status}, ${latencyMs}ms): ${errMsg}`;
    }

    const outputText =
      data.result?.response ||
      data.result?.generated_text ||
      JSON.stringify(data.result, null, 2);

    return `Cloudflare AI Response [Model: ${model}, Latency: ${latencyMs}ms]:\n${outputText}`;
  } catch (err: any) {
    return `Cloudflare AI Request Failed: ${err.message}`;
  }
}

/**
 * Health check probe for Cloudflare Workers AI
 */
export async function pingCloudflareAi(): Promise<{
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string | undefined;
}> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    return {
      ok: false,
      latencyMs: 0,
      model: "none",
      error: "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in .env",
    };
  }

  const model =
    process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const start = Date.now();

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "PING. Reply with 'PONG'.",
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    const latencyMs = Date.now() - start;
    const data = (await res.json()) as any;

    if (res.ok && data.success) {
      return { ok: true, latencyMs, model };
    }
    return {
      ok: false,
      latencyMs,
      model,
      error: JSON.stringify(data.errors || "Unknown error"),
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      model,
      error: err.message,
    };
  }
}
