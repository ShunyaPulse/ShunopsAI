import OpenAI from "openai";
import * as dotenv from "dotenv";
import { randomInt } from "node:crypto";
import { colors } from "../core/colors.js";
import type { ProviderKeyOverrides } from "../agent/models.js";
import {
  isModelDegraded,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
} from "../agent/circuitBreaker.js";

dotenv.config();

export interface ModelEndpoint {
  provider: "groq" | "gemini" | "openrouter" | "github" | "cloudflare";
  model: string;
  name?: string;
}

export interface DebateTurn {
  round: number;
  speaker: "Model-1 (Proposer)" | "Model-2 (Critic/Auditor)";
  modelUsed: string;
  role: "propose" | "critique" | "consensus";
  content: string;
  timestamp: string;
}

export interface ConsensusOptions {
  maxRounds?: number | undefined; // Total debate rounds (default: 2)
  model1?: ModelEndpoint | undefined; // Proposer model
  model2?: ModelEndpoint | undefined; // Auditor/Critic model
  context?: string | undefined; // Optional context (code, schema, logs, git diff)
  temperature?: number | undefined; // Sampling temp (default: 0.2)
  requireUnanimous?: boolean | undefined;
  /** Optional request-scoped BYOK or platform key overrides. */
  keyOverrides?: ProviderKeyOverrides | undefined;
}

export interface ConsensusResult {
  consensusReached: boolean;
  roundsCompleted: number;
  initialProposal: string;
  auditCritique: string;
  finalDecision: string;
  transcript: DebateTurn[];
}

// ==========================================
// Comprehensive Multi-Provider Fallback Chains
// ==========================================

export const PROPOSER_MODELS_CHAIN: ModelEndpoint[] = [
  // 1. Google AI Studio (Active Gemini 3.8 Flash; 3.5/3.6/3.7 deprecated & routed to 3.8)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash (Active 1/5)" },

  // 2. Groq High-Speed LPU Execution (Ultra-Fast Zero-Lag Reasoning)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning 120B)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (LPU Fast Tool Calling)" },

  // 3. GitHub Models & Cloudflare Workers AI (When connected or configured)
  { provider: "github", model: "gpt-4o", name: "OpenAI GPT-4o (GitHub Models)" },
  { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Fast (Cloudflare AI)" },

  // 4. OpenRouter High-Capability Free Models (550B, 120B, 70B Heavyweights)
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (Primary #1)" },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (1M Context)" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" },
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "qwen/qwen3.8-27b:free", name: "Qwen 3.8 27B (OpenRouter)" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },
];

export const AUDITOR_MODELS_CHAIN: ModelEndpoint[] = [
  // 1. Groq Ultra-Fast LPUs (Specialized 120B AST Reasoning & Deep Debugging)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (Lead 120B Auditor)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (Fast Audit)" },

  // 2. Google AI Studio (Active Gemini 3.8 Flash; 3.5/3.6/3.7 deprecated & routed to 3.8)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Audit Backup)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash" },

  // 3. GitHub Models & Cloudflare Workers AI (When connected or configured)
  { provider: "github", model: "gpt-4o", name: "OpenAI GPT-4o (GitHub Audit)" },
  { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Fast (Cloudflare Audit)" },

  // 4. OpenRouter High-Capability Free Models (Specialized Code & Reasoning)
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code (Audit)" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },
];

export const DEFAULT_PROPOSER = PROPOSER_MODELS_CHAIN[0]!;
export const DEFAULT_AUDITOR = AUDITOR_MODELS_CHAIN[0]!;
export const BACKUP_PROPOSER = PROPOSER_MODELS_CHAIN[6]!;
export const BACKUP_OPENROUTER_PROPOSER = BACKUP_PROPOSER;
export const BACKUP_GROQ_AUDITOR = AUDITOR_MODELS_CHAIN[1]!;

/** Gemini keys configured for this process (pool first, then the single-key var). */
export function getGeminiKeys(): string[] {
  const raw =
    process.env.GEMINI_KEYS ||
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

/** Groq keys configured for this process (pool first, then the single-key var). */
export function getGroqKeys(): string[] {
  const raw =
    process.env.GROQ_KEYS ||
    process.env.GROQ_API_KEYS ||
    process.env.GROQ_API_KEY ||
    "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

/** OpenRouter keys configured for this process (pool first, then the single-key var). */
export function getOpenRouterKeys(): string[] {
  const raw =
    process.env.OPENROUTER_KEYS ||
    process.env.OPENROUTER_API_KEYS ||
    process.env.OPENROUTER_API_KEY ||
    "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

/**
 * Whether usable credentials exist for a provider (honoring BYOK isolation when overrides are supplied).
 */
export function hasProviderCredentials(
  provider: ModelEndpoint["provider"],
  overrides?: ProviderKeyOverrides
): boolean {
  const isBYOK = Boolean(
    overrides?.groqApiKey || overrides?.geminiApiKey || overrides?.openrouterApiKey
  );
  if (isBYOK) {
    if (provider === "gemini") return Boolean(overrides?.geminiApiKey);
    if (provider === "groq") return Boolean(overrides?.groqApiKey);
    if (provider === "openrouter") return Boolean(overrides?.openrouterApiKey);
    if (provider === "github") return Boolean(overrides?.githubToken);
    if (provider === "cloudflare") {
      return Boolean(overrides?.cloudflareAccountId && overrides?.cloudflareApiToken);
    }
    return false;
  }

  if (provider === "gemini") return Boolean(overrides?.geminiApiKey || getGeminiKeys().length > 0);
  if (provider === "groq") return Boolean(overrides?.groqApiKey || getGroqKeys().length > 0);
  if (provider === "github") {
    return Boolean(overrides?.githubToken || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN);
  }
  if (provider === "cloudflare") {
    return Boolean(
      (overrides?.cloudflareAccountId && overrides?.cloudflareApiToken) ||
        (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)
    );
  }
  return Boolean(overrides?.openrouterApiKey || getOpenRouterKeys().length > 0);
}

// Fast failover timeout for automated consensus inference (15s max)
const CONSENSUS_TIMEOUT_MS = 15000;

export function createClient(target: ModelEndpoint, overrides?: ProviderKeyOverrides): OpenAI {
  if (target.provider === "groq") {
    const keys = getGroqKeys();
    const key =
      overrides?.groqApiKey ||
      (keys.length > 0 ? keys[randomInt(0, keys.length)] : process.env.GROQ_API_KEY || "dummy-groq-key");
    return new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: key,
      timeout: CONSENSUS_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  if (target.provider === "gemini") {
    const keys = getGeminiKeys();
    const key =
      overrides?.geminiApiKey ||
      (keys.length > 0 ? keys[randomInt(0, keys.length)] : "dummy-gemini-key");
    return new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: key,
      timeout: CONSENSUS_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  if (target.provider === "github") {
    const key = overrides?.githubToken || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "dummy-gh-key";
    return new OpenAI({
      baseURL: "https://models.inference.ai.azure.com",
      apiKey: key,
      timeout: CONSENSUS_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  if (target.provider === "cloudflare") {
    const accountId = overrides?.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || "dummy";
    const key = overrides?.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN || "dummy-cf-key";
    return new OpenAI({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      apiKey: key,
      timeout: CONSENSUS_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  const keys = getOpenRouterKeys();
  const key =
    overrides?.openrouterApiKey ||
    (keys.length > 0 ? keys[randomInt(0, keys.length)] : process.env.OPENROUTER_API_KEY || "dummy-openrouter-key");
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: key,
    timeout: CONSENSUS_TIMEOUT_MS,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/ShunyaPulse/ShunopsAI",
      "X-Title": "ShunopsAI-Consensus-Engine",
    },
  });
}

/**
 * Execute chat completion iterating across an ordered multi-provider fallback chain
 * with passive circuit-breaker awareness and optional BYOK key overrides.
 */
export async function callModelWithChain(
  chain: ModelEndpoint[],
  messages: OpenAI.ChatCompletionMessageParam[],
  temperature = 0.2,
  overrides?: ProviderKeyOverrides
): Promise<{ text: string; modelName: string }> {
  let lastErr: any = null;

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;

    // Skip providers with no credentials instead of burning attempts on a dummy key.
    if (!hasProviderCredentials(target.provider, overrides)) {
      lastErr = new Error(`${target.provider} credentials are not configured`);
      continue;
    }

    // Skip models currently in passive circuit-breaker cooldown
    if (await isModelDegraded(target.provider, target.model)) {
      continue;
    }

    // For Gemini pool, attempt with up to 2 different keys before moving to next model
    const attempts = !overrides?.geminiApiKey && target.provider === "gemini" ? Math.min(2, Math.max(1, getGeminiKeys().length)) : 1;

    for (let att = 0; att < attempts; att++) {
      try {
        const client = createClient(target, overrides);
        const res = await client.chat.completions.create({
          model: target.model,
          messages,
          temperature,
        });
        const text = res.choices[0]?.message?.content?.trim() || "";
        if (text) {
          recordCircuitBreakerSuccess(target.provider, target.model).catch(() => {});
          return { text, modelName: `${target.provider.toUpperCase()}:${target.model}` };
        }
      } catch (err: any) {
        lastErr = err;
        const status = err?.status || err?.statusCode || "err";
        recordCircuitBreakerFailure(target.provider, target.model, status, err?.message).catch(() => {});
        console.warn(
          `${colors.yellow}[Fallback Chain]${colors.reset} [${target.provider}] ${target.model} attempt ${att + 1}/${attempts} failed (${status}: ${err.message}). Trying next fallback...`
        );
        if (err?.status === 404 || err?.status === 503) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  throw new Error(`All models in fallback chain failed. Last error: ${lastErr?.message || lastErr}`);
}

/**
 * Execute chat completion with primary target and automatic fallback cascade
 */
export async function callModel(
  target: ModelEndpoint,
  messages: OpenAI.ChatCompletionMessageParam[],
  backupTarget?: ModelEndpoint,
  temperature = 0.2,
  overrides?: ProviderKeyOverrides
): Promise<{ text: string; modelName: string }> {
  // Determine whether this target behaves more like a proposer or auditor and load its chain
  const isAuditor = target.provider === "groq" || target.model.includes("oss");
  const preferredChain = isAuditor ? AUDITOR_MODELS_CHAIN : PROPOSER_MODELS_CHAIN;
  const secondaryChain = isAuditor ? PROPOSER_MODELS_CHAIN : AUDITOR_MODELS_CHAIN;

  // Build ordered chain strictly respecting Rule 3 cascade:
  // Proposer: Active Gemini -> Groq LPUs (120B / 27B) -> OpenRouter High-Capacity
  // Auditor: Groq LPUs (120B / 27B) -> Active Gemini -> OpenRouter High-Capacity
  const chain: ModelEndpoint[] = [target];
  for (const m of [...preferredChain, ...secondaryChain]) {
    if (!chain.some((c) => c.provider === m.provider && c.model === m.model)) {
      chain.push(m);
    }
  }

  // If backupTarget is provided and not already present, ensure it's in the chain
  if (backupTarget && !chain.some((c) => c.provider === backupTarget.provider && c.model === backupTarget.model)) {
    chain.push(backupTarget);
  }

  return callModelWithChain(chain, messages, temperature, overrides);
}

/**
 * Run Dual-Model Consensus with strict round budget and full turn awareness
 */
export async function runDualModelConsensus(
  taskGoal: string,
  options: ConsensusOptions = {}
): Promise<ConsensusResult> {
  const maxRounds = options.maxRounds ?? 2; // Strict default: 2 rounds
  const proposerTarget = options.model1 ?? DEFAULT_PROPOSER;
  const auditorTarget = options.model2 ?? DEFAULT_AUDITOR;
  const context = options.context ? `\n\n### Task Context & Details:\n${options.context}` : "";
  const transcript: DebateTurn[] = [];
  const overrides = options.keyOverrides;

  console.log(`\n${colors.cyan}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}🤝 ShunopsAI Dual-Model Consensus Engine Initiated${colors.reset}`);
  console.log(`${colors.cyan}🎯 Task:${colors.reset} ${taskGoal}`);
  console.log(`${colors.cyan}⏱️ Round Budget:${colors.reset} Exactly ${maxRounds} Rounds (Turn Awareness Enforced)`);
  console.log(`${colors.cyan}🧠 Proposer (Model 1):${colors.reset} [${proposerTarget.provider.toUpperCase()}] ${proposerTarget.model}`);
  console.log(`${colors.cyan}🕵️ Auditor (Model 2):${colors.reset}  [${auditorTarget.provider.toUpperCase()}] ${auditorTarget.model}`);
  console.log(`${colors.cyan}${colors.bold}====================================================${colors.reset}\n`);

  // ==========================================
  // ROUND 1: Propose Solution (Model 1)
  // ==========================================
  console.log(`${colors.green}${colors.bold}--- [Round 1 of ${maxRounds}]: Initial Proposal (Model 1) ---${colors.reset}`);

  const proposerRound1Prompt: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Model 1 (Lead System Architect & Proposer) participating in a strict ${maxRounds}-Round Consensus Protocol.
PROTOCOL RULES:
- Total Rounds: ${maxRounds}.
- Current Step: Round 1 of ${maxRounds} (Initial Proposal).
- Turns Remaining After This: Exactly 1 turn (in Round ${maxRounds}) to finalize.
- Your Goal: Propose an optimal, actionable, and concrete solution for the task.
- Address architecture, edge cases, potential failure modes, and security considerations.`,
    },
    {
      role: "user",
      content: `Task: "${taskGoal}"${context}

Please provide your comprehensive proposal. Be structured, precise, and practical.`,
    },
  ];

  const round1Proposal = await callModel(
    proposerTarget,
    proposerRound1Prompt,
    BACKUP_OPENROUTER_PROPOSER,
    options.temperature,
    overrides
  );

  transcript.push({
    round: 1,
    speaker: "Model-1 (Proposer)",
    modelUsed: round1Proposal.modelName,
    role: "propose",
    content: round1Proposal.text,
    timestamp: new Date().toISOString(),
  });

  console.log(`${colors.gray}[Model 1 - ${round1Proposal.modelName}]: Proposal generated (${round1Proposal.text.length} chars).${colors.reset}`);

  // ==========================================
  // ROUND 1: Audit & Critique (Model 2)
  // ==========================================
  console.log(`\n${colors.yellow}${colors.bold}--- [Round 1 of ${maxRounds}]: Peer Review & Security Audit (Model 2) ---${colors.reset}`);

  const auditorRound1Prompt: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Model 2 (Chief DevOps, Reliability & Security Auditor) in a strict ${maxRounds}-Round Consensus Protocol.
PROTOCOL RULES:
- Total Rounds: ${maxRounds}.
- Current Step: Round 1 of ${maxRounds} (Independent Audit & Critique).
- Turns Remaining: THIS IS YOUR ONLY TURN TO CRITIQUE. Model 1 will synthesize the final decision in the next turn based on your feedback.
- Your Goal: Thoroughly review Model 1's proposal.
- You must:
  1. Highlight subtle edge cases, race conditions, or unhandled errors.
  2. Check for security vulnerabilities, secret exposure, or cloud permission pitfalls.
  3. Validate performance, cost, and maintainability.
  4. Provide explicit, concrete modifications or give unconditional endorsement if flaw-free.`,
    },
    {
      role: "user",
      content: `Task: "${taskGoal}"${context}

### Model 1's Proposal:
${round1Proposal.text}

Provide your rigorous peer-review and specific corrections now.`,
    },
  ];

  const round1Critique = await callModel(
    auditorTarget,
    auditorRound1Prompt,
    BACKUP_GROQ_AUDITOR,
    options.temperature,
    overrides
  );

  transcript.push({
    round: 1,
    speaker: "Model-2 (Critic/Auditor)",
    modelUsed: round1Critique.modelName,
    role: "critique",
    content: round1Critique.text,
    timestamp: new Date().toISOString(),
  });

  console.log(`${colors.gray}[Model 2 - ${round1Critique.modelName}]: Audit critique completed (${round1Critique.text.length} chars).${colors.reset}`);

  // ==========================================
  // ROUND 2: Final Synthesis & Consensus (Model 1)
  // ==========================================
  console.log(`\n${colors.magenta}${colors.bold}--- [Round 2 of ${maxRounds} (FINAL)]: Synthesis & Consensus Lock ---${colors.reset}`);

  const finalConsensusPrompt: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Model 1 (Lead System Architect) concluding the ${maxRounds}-Round Consensus Protocol.
CRITICAL PROTOCOL NOTICE:
- Total Rounds: ${maxRounds}.
- Current Step: FINAL ROUND (${maxRounds} of ${maxRounds}).
- TURNS REMAINING: 0. THIS IS THE FINAL TURN.
- DO NOT prolong debate, ask questions, or request further review.
- You MUST synthesize the debate into a single, cohesive, production-ready FINAL DECISION.
- Incorporate Model 2's valid corrections. If you disagree with any critique, briefly state why, but resolve all ambiguities.
- Output Format:
  1. Summary of Consensus (What both models agreed on)
  2. Resolved Concerns (How Model 2's critiques were addressed)
  3. Final Actionable Execution Plan (Exact steps, commands, or code to execute)`,
    },
    {
      role: "user",
      content: `Task: "${taskGoal}"${context}

### Your Initial Proposal:
${round1Proposal.text}

### Model 2's Independent Audit & Critique:
${round1Critique.text}

Deliver the FINAL AUTHORITATIVE DECISION now.`,
    },
  ];

  const finalDecision = await callModel(
    proposerTarget,
    finalConsensusPrompt,
    BACKUP_OPENROUTER_PROPOSER,
    options.temperature,
    overrides
  );

  transcript.push({
    round: 2,
    speaker: "Model-1 (Proposer)",
    modelUsed: finalDecision.modelName,
    role: "consensus",
    content: finalDecision.text,
    timestamp: new Date().toISOString(),
  });

  console.log(`${colors.green}${colors.bold}====================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bold}✅ Consensus Locked Successfully (${maxRounds}/${maxRounds} Rounds)${colors.reset}`);
  console.log(`${colors.green}${colors.bold}====================================================${colors.reset}\n`);

  return {
    consensusReached: true,
    roundsCompleted: maxRounds,
    initialProposal: round1Proposal.text,
    auditCritique: round1Critique.text,
    finalDecision: finalDecision.text,
    transcript,
  };
}

// ==========================================
// CLI Self-Execution Demo Handler
// ==========================================
const isMain = process.argv[1]?.endsWith("consensus.ts") || process.argv[1]?.endsWith("consensus.js");
if (isMain) {
  const goal =
    process.argv.slice(2).join(" ") ||
    "Determine the safest zero-downtime deployment strategy for updating OCI Redis schema and Cloud Run services simultaneously.";

  runDualModelConsensus(goal, { maxRounds: 2 })
    .then((res) => {
      console.log(`\n${colors.bold}=== Final Actionable Decision ===${colors.reset}\n`);
      console.log(res.finalDecision);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Consensus failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
