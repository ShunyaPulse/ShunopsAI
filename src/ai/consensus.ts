import OpenAI from "openai";
import * as dotenv from "dotenv";
import { randomInt } from "node:crypto";

dotenv.config();

// ANSI color helpers for terminal readability
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

export interface ModelEndpoint {
  provider: "groq" | "gemini" | "openrouter";
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
  // 1. Google AI Studio (Active Non-Lite Models with Verified 1/5 Quota)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3.5-flash", name: "Gemini 3.5 Flash (Active 1/5)" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash (Active 1/5)" },

  // 2. Groq High-Speed LPU Execution (Ultra-Fast Zero-Lag Reasoning)
  { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B (High Reasoning 120B)" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Groq Qwen 3.8 27B (LPU Fast Tool Calling)" },

  // 3. OpenRouter High-Capability Free Models (550B, 120B, 70B Heavyweights)
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

  // 2. Google AI Studio (Active Non-Lite Models with Verified 1/5 Quota)
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Audit Backup)" },
  { provider: "gemini", model: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { provider: "gemini", model: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
  { provider: "gemini", model: "gemini-3-flash-preview", name: "Gemini 3 Flash" },

  // 3. OpenRouter High-Capability Free Models (Specialized Code & Reasoning)
  { provider: "openrouter", model: "cohere/north-mini-code:free", name: "Cohere North Mini Code (Audit)" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B" },
  { provider: "openrouter", model: "openrouter/free", name: "OpenRouter Free Router Fallback" },
];

export const DEFAULT_PROPOSER = PROPOSER_MODELS_CHAIN[0]!;
export const DEFAULT_AUDITOR = AUDITOR_MODELS_CHAIN[0]!;
export const BACKUP_PROPOSER = PROPOSER_MODELS_CHAIN[4]!;
export const BACKUP_OPENROUTER_PROPOSER = BACKUP_PROPOSER;
export const BACKUP_GROQ_AUDITOR = AUDITOR_MODELS_CHAIN[1]!;

export function createClient(target: ModelEndpoint): OpenAI {
  if (target.provider === "groq") {
    return new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || "dummy-groq-key",
    });
  }

  if (target.provider === "gemini") {
    const raw = process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY || "";
    const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
    const key = keys.length > 0 ? keys[randomInt(0, keys.length)] : "dummy-gemini-key";
    return new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: key,
    });
  }

  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "dummy-openrouter-key",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/ShunyaPulse/ShunopsAI",
      "X-Title": "ShunopsAI-Consensus-Engine",
    },
  });
}

/**
 * Execute chat completion iterating across an ordered multi-provider fallback chain
 */
export async function callModelWithChain(
  chain: ModelEndpoint[],
  messages: OpenAI.ChatCompletionMessageParam[],
  temperature = 0.2
): Promise<{ text: string; modelName: string }> {
  let lastErr: any = null;

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    // For Gemini, attempt with up to 3 different keys from the pool before moving to next model
    const attempts = target.provider === "gemini" ? 3 : 1;

    for (let att = 0; att < attempts; att++) {
      try {
        const client = createClient(target);
        const res = await client.chat.completions.create({
          model: target.model,
          messages,
          temperature,
        });
        const text = res.choices[0]?.message?.content?.trim() || "";
        if (text) {
          return { text, modelName: `${target.provider.toUpperCase()}:${target.model}` };
        }
      } catch (err: any) {
        lastErr = err;
        const status = err?.status || err?.statusCode || "err";
        console.warn(
          `${colors.yellow}[Fallback Chain]${colors.reset} [${target.provider}] ${target.model} attempt ${att + 1}/${attempts} failed (${status}: ${err.message}). Trying next fallback...`
        );
        if (err?.status === 404) break; // Model does not exist, advance to next model in chain immediately
        await new Promise((r) => setTimeout(r, 250));
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
  temperature = 0.2
): Promise<{ text: string; modelName: string }> {
  const chain: ModelEndpoint[] = [target];
  if (backupTarget && (backupTarget.provider !== target.provider || backupTarget.model !== target.model)) {
    chain.push(backupTarget);
  }

  // Determine whether this target behaves more like a proposer or auditor and load its chain
  const isAuditor = target.provider === "groq" || target.model.includes("oss");
  const preferredChain = isAuditor ? AUDITOR_MODELS_CHAIN : PROPOSER_MODELS_CHAIN;
  const secondaryChain = isAuditor ? PROPOSER_MODELS_CHAIN : AUDITOR_MODELS_CHAIN;

  for (const m of [...preferredChain, ...secondaryChain]) {
    if (!chain.some((c) => c.provider === m.provider && c.model === m.model)) {
      chain.push(m);
    }
  }

  return callModelWithChain(chain, messages, temperature);
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
    options.temperature
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
    options.temperature
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
    options.temperature
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
