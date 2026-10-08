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

## 5. Smart Quota Guardrails & Duplicate Run Throttling
- When a target repository has no new commits, `autonomous-repo-auditor.ts` runs at most 2 consecutive 12-hour cycles on the exact same commit SHA for double verification.
- On run 3 and beyond, if the commit SHA is unchanged, it skips all LLM inference calls to conserve model quotas.
- As soon as a new commit is detected (pushed by user, bot, or PR merge), the audit cycle automatically resets to run 1.
- Capped flaw remediation: maximum 5 flaws per audit run to prevent token bursts.
- State persistence: distributed OCI Redis (`REDIS_URL` / `REDIS_HOST`) across cloud runners with local `.auditor-state.json` fallback.

## 6. Multi-Service API Key Pool Anti-Contention Invariant
- **Shared Key Permutation Rule:** Multiple services (`SaralGati`, `AI Predictor`, `AI Damage Inspector Pro`, `Flow State`, `ShunopsAI`) sharing the master `GEMINI_KEYS` / `GEMINI_API_KEY` pool must NEVER use identical key ordering.
- **Startup Offset Initialization:** Each service environment must initialize a randomized startup offset (or cryptographic permutation) ONCE at process/module launch so that separate services and runner instances start at different initial pool indices.
- **Zero-Latency Hot-Path Invariant:** On live user/elder query paths, NEVER execute per-request array shuffling, sorting, or cloning. Selection must strictly be $O(1)$ round-robin pointer advancement (`roundRobinIndex = (roundRobinIndex + 1) % keys.length`) to preserve sub-second response times.
- **Bounded Retries on 429:** When a key encounters a 429 rate-limit, advance the pointer to the next key in the pool immediately. Limit in-request key retries to at most 1–2 attempts before model fallback to prevent latency spikes.
- **Universal Key-Alias Resolution:** All services must uniformly support `process.env.GEMINI_KEYS || process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY` to guarantee 34-key pool interoperability across GitHub Actions, Cloud Run, and local environments.


## 7. Operational Cadence & Autonomous Sentinel Schedule
- Standard operational frequency across GitHub Actions (`ops.yml`), n8n orchestrator triggers, and sentinel health audits is strictly **12 hours** (`0 */12 * * *`).
- The duplicate commit SHA verification ceiling in `autonomous-repo-auditor.ts` is calibrated to 2 consecutive 12-hour cycles before skipping LLM inference.

## 8. Clear-Text Logging & CodeQL Sanitization
- Never pass raw API responses, error objects with stack traces, or external payloads (`rawAlert`, `data.result`, `healReport`) directly into `console.log` or logging formatters.
- Always redact sensitive variables with `[REDACTED]` or extract safe primitive strings to avoid GitHub CodeQL `js/clear-text-logging` alerts.

