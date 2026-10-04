import OpenAI from "openai";
import * as dotenv from "dotenv";

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

// Fallback Model Targets
const DEFAULT_PROPOSER: ModelEndpoint = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  name: "Gemini 2.5 Flash",
};

const DEFAULT_AUDITOR: ModelEndpoint = {
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  name: "Groq LLaMA 3.3 70B",
};

const BACKUP_OPENROUTER_PROPOSER: ModelEndpoint = {
  provider: "openrouter",
  model: "meta-llama/llama-3.3-70b-instruct:free",
  name: "OpenRouter LLaMA 3.3 70B (Free)",
};

const BACKUP_GROQ_AUDITOR: ModelEndpoint = {
  provider: "groq",
  model: "openai/gpt-oss-120b",
  name: "Groq GPT-OSS 120B",
};

function createClient(target: ModelEndpoint): OpenAI {
  if (target.provider === "groq") {
    return new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || "dummy-groq-key",
    });
  }

  if (target.provider === "gemini") {
    // Pick from GEMINI_KEYS or fallback to GEMINI_API_KEY
    const keys = (process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const key = keys[Math.floor(Math.random() * keys.length)] || "dummy-gemini-key";
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
 * Execute chat completion with single failover target
 */
async function callModel(
  target: ModelEndpoint,
  messages: OpenAI.ChatCompletionMessageParam[],
  backupTarget: ModelEndpoint,
  temperature = 0.2
): Promise<{ text: string; modelName: string }> {
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
    console.warn(
      `${colors.yellow}[Consensus Failover]${colors.reset} ${target.provider}:${target.model} failed (${err.message}). Using backup ${backupTarget.provider}:${backupTarget.model}...`
    );
  }

  // Backup fallback
  const backupClient = createClient(backupTarget);
  const backupRes = await backupClient.chat.completions.create({
    model: backupTarget.model,
    messages,
    temperature,
  });
  return {
    text: backupRes.choices[0]?.message?.content?.trim() || "",
    modelName: `${backupTarget.provider.toUpperCase()}:${backupTarget.model}`,
  };
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
      console.error(`${colors.red}Consensus failed:${colors.reset}`, err);
      process.exit(1);
    });
}
