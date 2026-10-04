# ShunopsAI Core Engineering & Model Governance Invariants

## 1. AI Model Selection & Quota Guardrails
- **Banned for Code Debugging & Auditing:**
  - NEVER use `flash-lite` models (`gemini-2-flash-lite`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`) for debugging, code reviews, or security patches — they lack the reasoning capacity for reliable AST evaluation.
  - NEVER use `gemini-2.5-flash` for debugging.
  - NEVER configure models showing `0 / 0` or exhausted quota in AI Studio (e.g. `gemini-2-flash`, `gemini-2.5-pro`, `gemini-3.1-pro`).
- **Verified Active Gemini Flash Models (Active 1/5 Quota):**
  - Always select from:
    1. `gemini-3.8-flash`
    2. `gemini-3.7-flash`
    3. `gemini-3.6-flash`
    4. `gemini-3.5-flash`
    5. `gemini-3-flash-preview`
  - Always rotate keys across the `GEMINI_KEYS` pool (up to 34 keys) with exponential backoff on 429/503 spikes.
- **Heavyweight Reasoning & AST Debugging Backbones:**
  - Groq LPUs: `openai/gpt-oss-120b` (120-Billion parameter reasoning model for deep AST code analysis and security auditing) and `qwen/qwen3.8-27b`.
  - OpenRouter Heavyweights: `nvidia/nemotron-3-ultra-550b-a55b:free`, `meta-llama/llama-3.3-70b-instruct:free`, `cohere/north-mini-code:free`.

## 2. Dual-Model Consensus Invariant (PRs & Code Alerts)
- **Zero Single-Model Merges:** No Pull Request can be approved or merged by a single AI agent alone.
- **Protocol:**
  - **Round 1 (Proposer):** Active Gemini Flash (`gemini-3.8-flash` / `3.7-flash` / `3.6-flash`) analyzes the diff/alert and proposes the patch/verdict with technical rationale.
  - **Round 2 (Auditor):** Groq `openai/gpt-oss-120b` cross-audits the proposal, checking for hidden vulnerabilities, injection vectors, syntax breaks, or regressions.
  - **Consensus Lock:** Only unanimous approval allows merging.
- **Verification Rule:** Every code remediation must pass `npm run typecheck` (`tsc --noEmit`) before git commit and push.

## 3. Multi-Provider Fallback Cascade Rule
- Anywhere AI inference is invoked (`agent.ts`, `consensus.ts`, `video.ts`, `cloudflare-ai.ts`), a single model failure (404, 429, 503) must never crash the operation.
- Always cascade through the ordered chain:
  `Active Gemini Key Pool` -> `Groq LPUs (120B / 27B)` -> `OpenRouter High-Capacity (550B / 70B / Free Router)`.

## 4. Autonomous Proactive Code Healing
- Do not wait for external bots or GitHub alert webhooks to fix repository flaws.
- `src/tools/autonomous-repo-auditor.ts` must proactively scan and auto-heal:
  1. Insecure randomness (`Math.random` in auth/token/ID contexts -> `crypto.randomInt`)
  2. Command injection (`execSync` with template strings -> `execFileSync` argv arrays)
  3. Sensitive clear-text logging (unredacted tokens, keys, passwords, or raw `err.message`)
  4. Hardcoded filesystem paths
- Support multi-repository healing via `AUTONOMOUS_TARGET_REPOS`.
