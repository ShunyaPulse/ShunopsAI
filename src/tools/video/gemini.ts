/**
 * Parse the comma-separated GEMINI_API_KEY pool and return an array of trimmed keys.
 */
function geminiKeyPool(): string[] {
  const raw =
    process.env.GEMINI_KEYS ??
    process.env.GEMINI_API_KEYS ??
    process.env.GEMINI_API_KEY ??
    "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Quality-ranked order of Gemini models.
 * For each model, 5-6 keys from the pool are attempted.
 * If all 5-6 keys encounter errors (rate limit, quota, overloaded),
 * quality is degraded to the next model in this order.
 */
export const GEMINI_MODELS_QUALITY_ORDER = [
  "gemini-3.8-flash",        // Active verified primary (3.5/3.6/3.7 deprecated & routed to 3.8)
  "gemini-3-flash-preview",  // Active verified quota (1 / 5)
];

const KEYS_PER_MODEL_ATTEMPT = 10;
const KEY_RETRY_DELAY_MS = 400;

/**
 * Select a slice of `count` keys starting at a random offset to distribute load evenly.
 */
function pickKeySubset(pool: string[], count: number): string[] {
  if (pool.length <= count) return [...pool];
  const start = Math.floor(Math.random() * pool.length);
  const subset: string[] = [];
  for (let i = 0; i < count; i++) {
    const k = pool[(start + i) % pool.length];
    if (k) subset.push(k);
  }
  return subset;
}

function parseEnvKeyPool(...names: string[]): string[] {
  const raw = names.map((n) => process.env[n]).find((v) => v && v.length > 0) || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function pickRandom<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : undefined;
}

type GenerationResult = { text: string; modelUsed: string };

/** One Gemini generateContent call; returns "" when the response has no text. */
async function callGeminiModel(model: string, key: string, prompt: string): Promise<{
  ok: boolean;
  text: string;
  status: number;
  body: string;
}> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8,
          maxOutputTokens: 32768,
        },
      }),
      signal: AbortSignal.timeout(35000),
    }
  );

  const rawBody = await res.text();

  if (res.ok) {
    try {
      const data: any = JSON.parse(rawBody);
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
      if (text) return { ok: true, text, status: res.status, body: "" };
    } catch {
      // Body was not JSON
    }
  }

  return { ok: false, text: "", status: res.status, body: rawBody };
}

/** Try every Gemini model/key in quality order. */
async function tryGeminiModels(
  prompt: string,
  preferredModel?: string
): Promise<{ result: GenerationResult | null; lastError: string }> {
  const pool = geminiKeyPool();
  if (!pool.length) throw new Error("GEMINI_API_KEY pool is empty");

  const activePreferred =
    preferredModel && !preferredModel.includes("2.5") && !preferredModel.includes("2-flash")
      ? preferredModel
      : undefined;

  const modelsToTry = activePreferred
    ? [activePreferred, ...GEMINI_MODELS_QUALITY_ORDER.filter((m) => m !== activePreferred)]
    : GEMINI_MODELS_QUALITY_ORDER;

  let globalLastErr = "";

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx]!;
    const candidateKeys = pickKeySubset(pool, Math.min(KEYS_PER_MODEL_ATTEMPT, pool.length));
    console.log(`[Video] Trying model [${mIdx + 1}/${modelsToTry.length}]: "${model}" with ${candidateKeys.length} attempts...`);

    for (let kIdx = 0; kIdx < candidateKeys.length; kIdx++) {
      const key = candidateKeys[kIdx];
      if (!key) continue;
      const keySuffix = key.slice(-6);

      try {
        const result = await callGeminiModel(model, key, prompt);
        if (result.ok) {
          console.log(`[Video] Success with model: "${model}"`);
          return { result: { text: result.text, modelUsed: model ?? "unknown" }, lastError: globalLastErr };
        }

        const errMsg = `Status ${result.status}: ${result.body.slice(0, 180)}`;
        globalLastErr = `Model ${model} (key ...${keySuffix}) -> ${errMsg}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] failed for ${model}: ${errMsg}`);

        // If model is 404 (does not exist / deprecated), do not waste other keys on this model
        if (result.status === 404) {
          console.warn(`[Video] Model "${model}" returned 404. Skipping remaining keys for this model.`);
          break;
        }

        if (result.status === 503 && kIdx >= 2) {
          console.warn(`[Video] Model "${model}" returning multiple 503 demand spikes. Fast-failing to next tier.`);
          break;
        }

        await new Promise((r) => setTimeout(r, KEY_RETRY_DELAY_MS));
      } catch (err: any) {
        globalLastErr = `Model ${model} (key ...${keySuffix}) error: ${err.message}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] network error: ${err.message}`);
        await new Promise((r) => setTimeout(r, KEY_RETRY_DELAY_MS));
      }
    }

    if (mIdx < modelsToTry.length - 1) {
      console.warn(`[Video] ⚠️ Model "${model}" failed across keys. Degrading quality to next model: "${modelsToTry[mIdx + 1]}"...`);
    }
  }

  return { result: null, lastError: globalLastErr };
}

/** Cross-provider fallback: Groq LPUs. */
async function tryGroqFallback(prompt: string): Promise<GenerationResult | null> {
  const groqPool = parseEnvKeyPool("GROQ_KEYS", "GROQ_API_KEYS", "GROQ_API_KEY");
  const groqKey = pickRandom(groqPool) || process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  console.warn(`[Video] ⚠️ Attempting cross-provider fallback to Groq (openai/gpt-oss-120b, qwen/qwen3.8-27b)...`);
  const groqModels = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
  for (const gModel of groqModels) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: gModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        if (text) {
          console.log(`[Video] Success with Groq fallback model: "${gModel}"`);
          return { text, modelUsed: `groq:${gModel}` };
        }
      }
    } catch (err: any) {
      console.warn(`[Video] Groq fallback ${gModel} failed: ${err.message}`);
    }
  }
  return null;
}

/** Cross-provider fallback: OpenRouter high-capability models. */
async function tryOpenRouterFallback(prompt: string): Promise<GenerationResult | null> {
  const openrouterPool = parseEnvKeyPool("OPENROUTER_KEYS", "OPENROUTER_API_KEYS", "OPENROUTER_API_KEY");
  const openrouterKey = pickRandom(openrouterPool) || process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) return null;

  console.warn(`[Video] ⚠️ Attempting cross-provider fallback to OpenRouter...`);
  const openrouterModels = [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-4-31b-it:free",
    "cohere/north-mini-code:free",
    "openrouter/free",
  ];
  for (const oModel of openrouterModels) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://github.com/ShunyaPulse/ShunopsAI",
          "X-Title": "ShunopsAI Video Script Generation",
        },
        body: JSON.stringify({
          model: oModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        if (text) {
          console.log(`[Video] Success with OpenRouter fallback model: "${oModel}"`);
          return { text, modelUsed: `openrouter:${oModel}` };
        }
      }
    } catch (err: any) {
      console.warn(`[Video] OpenRouter fallback ${oModel} failed: ${err.message}`);
    }
  }
  return null;
}

/**
 * Call Gemini generateContent with 5-6 key retries per model,
 * degrading to the next model in GEMINI_MODELS_QUALITY_ORDER only if all keys fail,
 * then to Groq and OpenRouter.
 */
export async function geminiGenerate(
  prompt: string,
  preferredModel?: string
): Promise<GenerationResult> {
  const { result: geminiResult, lastError } = await tryGeminiModels(prompt, preferredModel);
  if (geminiResult) return geminiResult;

  const groqResult = await tryGroqFallback(prompt);
  if (groqResult) return groqResult;

  const openRouterResult = await tryOpenRouterFallback(prompt);
  if (openRouterResult) return openRouterResult;

  throw new Error(`All models in GEMINI_MODELS_QUALITY_ORDER, Groq fallback, and OpenRouter fallback failed. Last error: ${lastError}`);
}
