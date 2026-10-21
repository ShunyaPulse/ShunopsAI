# ShunopsAI Core Engineering & Model Governance Invariants

## 1. AI Model Selection & Quota Guardrails
- **Banned for Code Debugging & Auditing:**
  - NEVER use `flash-lite` models (`gemini-2-flash-lite`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`) for debugging, code reviews, or security patches — they lack the reasoning capacity for reliable AST evaluation.
  - NEVER use `gemini-2.5-flash` for debugging.
  - NEVER configure models showing `0 / 0` or exhausted quota in AI Studio (e.g. `gemini-2-flash`, `gemini-2.5-pro`, `gemini-3.1-pro`).
- **Verified Active Gemini Flash Models (Active 1/5 Quota):**
  - Always select from:
    1. `gemini-3.8-flash` (Primary Active Flash Backbone; `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash` are deprecated and route to 3.8)
    2. `gemini-3-flash-preview`
  - Always rotate keys across the `GEMINI_KEYS` pool (up to 34 keys) with exponential backoff on 429/503 spikes.
- **Heavyweight Reasoning & AST Debugging Backbones:**
  - Groq LPUs: `openai/gpt-oss-120b` (120-Billion parameter reasoning model for deep AST code analysis and security auditing) and `qwen/qwen3.8-27b`.
  - OpenRouter Heavyweights: `nvidia/nemotron-3-ultra-550b-a55b:free`, `meta-llama/llama-3.3-70b-instruct:free`, `cohere/north-mini-code:free`.

## 2. Dual-Model Consensus Invariant (PRs & Code Alerts)
- **Zero Single-Model Merges:** No Pull Request can be approved or merged by a single AI agent alone.
- **Protocol:**
  - **Round 1 (Proposer):** Active Gemini Flash (`gemini-3.8-flash` / `gemini-3-flash-preview`) analyzes the diff/alert and proposes the patch/verdict with technical rationale.
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

## 9. Multi-Tenant SaaS Auth, Registration & Account Linking Invariants
- **Strict Server-Side HTML Sanitization (Anti-XSS):**
  - Never interpolate raw user inputs (`username`, display names, emails) into server-rendered HTML template strings. Always pass through `escapeHtml()` escaping `&`, `<`, `>`, `"`, `'`.
- **Google OAuth Audience & Verification Lock:**
  - On Google ID token authentication, ALWAYS verify `googleData.aud === GOOGLE_CLIENT_ID` (never accept tokens minted for foreign OAuth client IDs) and ensure `email_verified === true`.
- **Canonical Multi-Provider Account Linking:**
  - When a user signs in via OAuth (Google/GitHub) with a verified email matching an existing account, link the OAuth ID into the existing user record rather than throwing duplicate errors or creating orphaned duplicate accounts.
- **Hashed Session Tokens at Rest:**
  - Session tokens stored in database tables (`shunops_sessions.token`) must ALWAYS be stored as cryptographic hashes (`SHA-256`) rather than plaintext cookies. A read-only database leak must never grant session hijacking.
- **OTP Replay Elimination & Strict Zero-Replay:**
  - One-Time Passwords (OTPs) must burn immediately upon first successful verification. Never provide grace periods or "recently used" replay windows where a consumed code remains valid.
- **Account Enumeration Prevention:**
  - Authentication and OTP endpoints (`/api/auth/email-otp/send`, `/api/auth/send-otp`) must return uniform success responses ("If an account exists, a code was sent") rather than distinct 404 vs 409 responses that reveal whether an email exists.
- **Edge Proxy IP Resolution (Anti-Spoofing):**
  - Never extract client IP via `x-forwarded-for.split(",")[0]` (which is client-controlled). Always read `CF-Connecting-IP` or the LAST hop appended by trusted reverse proxies / Google Cloud Run (`parts[parts.length - 1]`).
- **BYOK Isolation & Quota Drain Protection:**
  - When request-scoped BYOK keys (`x-groq-key`, `x-gemini-key`) are provided, validate format patterns strictly (`gsk_...`, `AIzaSy...`). When BYOK overrides are set, NEVER fall back to server owner pool keys if the user's key fails.
- **Constant-Time Crypto Checks:**
  - All HMAC challenges and signature comparisons must strictly use `crypto.timingSafeEqual` over buffers to prevent timing side-channel attacks.

## 10. Meta-Agent Principle: Empower ShunopsAI First (No Direct Manual Bypasses)
- **Zero Direct Manual Remediation:**
  - When an operational failure, external cloud incident (Kaggle GPU, Google Cloud Run, OCI Redis, Cloudflare Edge Worker), or pipeline failure occurs, NEVER manually patch or re-run the failed resource in isolation as an assistant.
- **Four-Step Autonomous Empowerment Protocol:**
  1. **Audit the Autonomous Blindspot:** First investigate why ShunopsAI's Sentinel (`check*Health`) or Auto-Healer (`heal*`) failed to catch or resolve the issue (e.g. shallow API checks without deep kernel inspection, missing log analysis, or placebo auto-heal handlers).
  2. **Architect Resilient Multi-Tier Fallbacks:** Patch the underlying system with robust degradation tiers (e.g., Primary Google Cloud TTS (Neural2) -> Secondary Edge-TTS with 3 retries -> Fail-Fast Abort to prevent rendering mute videos) so transient cloud blocks never waste GPU quota on broken jobs.
  3. **Equip Sentinel & Auto-Healer:** Upgrade ShunopsAI's Sentinel to detect degraded sub-statuses (`KernelWorkerStatus.ERROR`) and empower `autoHealService` / `heal*` to inspect logs, apply patches, and re-dispatch failed tasks autonomously.
  4. **Execute Through ShunopsAI:** Trigger the remediation through ShunopsAI's own autonomous tools (`npm run agent`, `sentinel-cron.ts`, or `autoHealService`) so the platform self-heals and validates its own autonomous loop.

## 11. Constructive Editorial Governance & Non-Partisan Content Invariant
- **Strictly Banned Content (Zero Aggressive Politics & Zero Bashing):**
  - NEVER generate topics, scripts, or videos centered on controversial politics, election fights, party clashes, or communal debates.
  - STRICTLY ZERO condemnation ("ninda"), fault-finding ("kamiyan"), accusations, corruption exposes, roasts, or attacks on any politician, political party, leader, or government.
- **Constructive Governance & Good Work Permitted:**
  - Videos MAY cover positive news and genuine achievements of politicians, ministries, or governments (e.g., mega infrastructure projects, successful welfare schemes, economic milestones, public health access, clean energy transitions, space missions, semiconductor fabs).
  - When covering such achievements, focus strictly on the engineering facts, implementation scale, and tangible public benefits in an objective, inspiring documentary tone. NEVER attack critics, rivals, or opposition parties.
- **Core Priority Domains:**
  - High-value knowledge domains must remain primary: Science, Space exploration, Deep Ocean / Nature, Technology / AI breakthroughs, Engineering marvels, History, and Inspiring Sports achievements.

## 12. Autonomous Video Production Quality & Aesthetic Invariants
- **Mandatory Character Visual Bible & 100% Actor DNA Lock:**
  - Every recurring character across any storyline, educational chapter, or historical dramatization must have a fixed, explicit Character Visual DNA established in research (exact age, facial structure, skin tone, hairstyle, facial hair, eyewear, signature period garments and fabrics).
  - Every scene visual prompt featuring the character MUST strictly prepend their exact DNA descriptor verbatim to ensure unbroken cross-shot model consistency.
  - STRICTLY FORBIDDEN: Introducing random unrelated characters, unscripted magazine readers, modern crowd extras, or shifting ethnicities across scene cuts.
- **Tone, Emotion & Period Setting Calibration:**
  - Visuals must strictly match the emotional tone and historical setting of the story or topic.
  - STRICTLY FORBIDDEN: Grotesque, violent, or horror depictions in lighthearted, educational, or satirical contexts (e.g. comic head-adjustments must never be depicted as choking, strangling, or physical distress).
  - Indoor settings must strictly match the authentic historical period and location (e.g. cozy Victorian parlors with dark wainscoting and brass bellows cameras; never modern industrial airplane hangars or empty warehouses).
- **Zero-Diffusion Text Rule (Elimination of Corrupt/Gibberish AI Glyphs):**
  - DiT and Diffusion models must NEVER be instructed to generate readable text, bulleted study cards, presentation slides, or infographic charts directly in diffusion latents.
  - Educational takeaways and summary chapters must be depicted exclusively through text-free cinematic visual metaphors (e.g., antique study desk with vintage leather-bound book, brass reading lamp, and fountain pen) with clean typography composited via 2D subtitle/motion graphics overlays in post-production.
- **Anti-Morphing Standard (Linear Blend vs MCI):**
  - Video interpolation in rendering pipelines must strictly employ linear frame blending (`minterpolate=mi_mode=blend`) rather than optical-flow block matching (`mi_mode=mci`), eliminating warped anatomy, melting skin, and distorted hands across adjacent frames.
  - Visual prompts for character dialogue must mandate locked static tripod camera framing, subtle natural breathing, and still hands to avoid complex hand-to-face interaction artifacts.
- **Mathematical Outro Hold & Fade Timing Invariant:**
  - Videos must NEVER begin fading to black or attenuating narration audio while speech is still playing.
  - The fade-out must strictly be calculated from the conclusion of dialogue:
    `fade_start = speech_end_time + 2.0s` with a 1.0s fade duration.
  - The final scene visual and background music must hold at 100% brightness and full volume for a full 2.0 seconds AFTER the last spoken word ends before executing a 1.0s cinematic fade-out to black.

## 13. Principle of Semantic Intelligence over Brittle Hardcoding (No Hardcoded Topic Checks)
- **Zero Narrow Regex/Switch-Case Hardcoding:**
  - NEVER solve generative AI domain/topic defects with narrow, brittle hardcoded conditions (e.g. `if (topic.includes("cricket")) ... else if (topic.includes("airport"))`).
  - Hardcoded checks fail on the very next unseen topic (Formula 1, Deep Sea, Robotics, Ancient Rome, Space Telescopes).
- **Two-Phase Intelligent Synthesis Protocol:**
  - Always design systems to be fundamentally semantic, dynamically adaptive, and universally generalized.
  - Prior to generation or rendering, use LLM reasoning (Active Gemini Flash key pool with multi-provider fallbacks) to dynamically synthesize a bespoke domain/topic schema (such as `VisualBible` with `realWorldGrounding`, `organicSettings`, `latentTrapsToBan`, `characterGrammar`, `zeroTextRules`, and `soundscapeProfile`).
  - Downstream execution runners (Python GPU kernels, renderers, agents) must consume and apply this dynamically synthesized metadata directly, guaranteeing unbroken high-fidelity execution across any arbitrary real-world subject.




