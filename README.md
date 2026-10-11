# ⚡ ShunopsAI

> **Autonomous Multi-Cloud Operations, Proactive Code-Healing Sentinel & Edge AI Command Center powered by Gemini 34-Key Pool, Groq LPUs, OpenRouter, and GitHub Actions.**

[![CI/CD & Security Auditing](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/ci-deploy.yml)
[![Services Sentinel](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/sentinel-healthcheck.yml/badge.svg)](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/sentinel-healthcheck.yml)
[![CodeQL Security](https://img.shields.io/badge/CodeQL-0%20Alerts-brightgreen.svg)](https://github.com/ShunyaPulse/ShunopsAI/security/code-scanning)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-NodeNext-3178C6.svg)](https://www.typescriptlang.org/)

---

## 🌟 Overview

**ShunopsAI** is an enterprise-grade autonomous DevOps sentinel, proactive security remediation engine, and distributed operations orchestrator. It bridges multi-cloud infrastructure monitoring (**Google Cloud Run**, **Oracle Cloud Redis**, **Neon Serverless Postgres**, **Cloudflare Workers AI**) with autonomous GitOps code healing, dual-model AST consensus, and embeddable ReAct edge AI widgets.

```
                    +-------------------------------------------------------+
                    |                SHUNOPSAI MASTER BRAIN                 |
                    |   Dual-Model Consensus (Gemini Flash + Groq 120B)     |
                    |   34-Key Anti-Contention Pool | OpenRouter Fallbacks  |
                    +---------------------------+---------------------------+
                                                |
        +-------------------+-------------------+-------------------+-------------------+
        |                   |                   |                   |                   |
        v                   v                   v                   v                   v
[DevOps Sentinel]   [Proactive Healer]  [Kaggle Media GPU]  [GitOps Auto-Fix]   [Edge AI Widget]
 - Cloud Run health  - Insecure random   - Multi-scene gen   - CodeQL scanner    - Context aware
 - Neon connection   - Command injection - Anti-hallucination- Dependabot PRs    - Action chips
 - OCI Redis cache   - Sensitive logging - Film grain & roll - Typecheck verify  - HMAC cards
 - Workers AI LoRA   - Smart SHA quota   - Kaggle CLI runner - Zero single-agent - SSE streaming
```

---

## 🚀 Key Capabilities

### 1. Dual-Model Consensus & AST Verification
- **Zero Single-Agent Merges**: No PR or automated fix is committed by a single model alone.
- **Protocol**:
  - **Round 1 (Proposer)**: Active Gemini Flash (`gemini-3.8-flash` / `3.7-flash` / `3.6-flash`) evaluates repository diffs or alerts and drafts remediation.
  - **Round 2 (Auditor)**: Groq LPU `openai/gpt-oss-120b` cross-audits the proposal, rigorously evaluating AST trees, injection vectors, and regressions.
- **Deterministic Gates**: Every remediation must pass strict `npm run typecheck` (`tsc --noEmit`) before git commit and push.

### 2. Multi-Service 34-Key Anti-Contention Engine
- Supports rotating up to 34 Gemini API keys with **$O(1)$ zero-latency round-robin pointer advancement** (`roundRobinIndex = (roundRobinIndex + 1) % keys.length`) on live query hot-paths.
- **Startup Permutation Offset**: Distinct services (`SaralGati`, `Kanban Cloud`, `AI Damage Inspector Pro`, `ShunopsAI`) initialize unique randomized starting indices at launch, preventing pool collision and 429 rate spikes.
- Universal environment resolution: `GEMINI_KEYS` || `GEMINI_API_KEYS` || `GEMINI_API_KEY`.

### 3. Autonomous Proactive Repository Healing
- Proactively inspects target repositories (`AUTONOMOUS_TARGET_REPOS`) and heals four critical vulnerability classes without waiting for alert webhooks:
  1. **Insecure Randomness**: Converts unseeded `Math.random` in token/ID contexts to `crypto.randomInt`.
  2. **Command Injection**: Refactors interpolated shell strings into safe `execFileSync` argument vectors.
  3. **Clear-Text Logging**: Redacts raw credentials, access tokens, and stack traces to enforce strict GitHub CodeQL compliance (`CWE-312 / CWE-532`).
  4. **Hardcoded Paths**: Replaces brittle directory strings with cross-platform `path.resolve`.
- **Smart Quota Guardrails**: Caches commit SHAs in distributed Redis (`REDIS_URL`) and throttles execution after 2 consecutive identical commit runs to conserve model quotas.

### 4. Automated Kaggle GPU Video Engine
- Generates 24-scene YouTube documentary scripts using structured Gemini prompts.
- Packages dataset bundles and launches remote Dual-T4 Kaggle GPU rendering kernels via cross-platform Kaggle CLI runner.
- **Quality Safeguards**:
  - Rigid camera geometry directives eliminating AI UI/screen hallucination.
  - Custom highlight roll-off color curves (`curves=all='0/0 0.85/0.83 1/0.92'`) preventing electric blue saturation clipping.
  - 35mm optical grain matching (`noise=alls=1.5`) across all synthetic cuts.

### 5. Embeddable ReAct Edge AI Command Center
- Lightweight, zero-dependency drop-in JavaScript widget (`/api/widget.js`).
- Features client domain awareness, customizable quick-action chips, dark/light theme adaptation, and SSE streaming responses.
- Generates interactive, cryptographic HMAC-signed action cards for one-click trigger executions.

---

## 🧩 Project Structure

```
├── agent.ts                     # CLI entrypoint & ReAct autonomous agent interface
├── server.ts                    # Fastify HTTP command server & REST API
├── wrangler.jsonc               # Cloudflare Workers edge deployment configuration
├── public/
│   └── widget.js                # Zero-dependency embeddable website AI chat widget (~5KB)
├── video/
│   └── kernel/
│       └── render.py            # Kaggle GPU rendering engine (diffusers, curves, film grain)
├── integrations/
│   ├── n8n/                     # n8n autonomous webhook & incident orchestrator workflows
│   └── dify/                    # Dify OpenAPI tool specifications
├── .github/
│   └── workflows/
│       ├── ci-deploy.yml        # CI/CD security pipeline (Semgrep, Trivy, Gitleaks, CodeQL)
│       └── ops.yml              # 12-hour scheduled autonomous sentinel cron
└── src/
    ├── index.ts                 # Cloudflare Workers Edge AI entrypoint (SSE streaming & action cards)
    ├── types.ts                 # Universal TypeScript definitions & contract interfaces
    ├── widget-script.ts         # Edge widget JavaScript generator & security escape filters
    ├── agent/                   # Autonomous ReAct agent core
    │   ├── loop.ts              #   Autonomous reasoning & tool execution loop
    │   ├── models.ts            #   Failover cascade (Gemini 34-key pool -> Groq -> OpenRouter)
    │   ├── engine.ts            #   Streaming agent execution engine
    │   ├── prompts.ts           #   System prompt engineering & tool directives
    │   ├── sandbox.ts           #   Path traversal, symlink defense & secret redaction
    │   └── tools.ts             #   Tool registry & JSON schema definitions
    ├── server/                  # Fastify backend application
    │   ├── app.ts               #   Fastify factory, rate limiting, CORS, & security headers
    │   ├── taskQueue.ts         #   Asynchronous task lifecycle manager with Redis persistence
    │   ├── middleware/
    │   │   └── auth.ts          #   Basic Auth, Bearer verification, & loopback dev bypass
    │   ├── routes/              #   Modular REST endpoints
    │   │   ├── dashboard.ts     #     Web Command Center & JSON service index
    │   │   ├── sentinel.ts      #     Multi-cloud status & on-demand auto-healing
    │   │   ├── autonomy.ts      #     Autonomous repo audit triggers & state queries
    │   │   ├── task.ts          #     Synchronous & async autonomous task executions
    │   │   ├── chat.ts          #     Public visitor AI assistant endpoint
    │   │   ├── approvals.ts     #     Human-in-the-loop pending approval queue
    │   │   ├── webhook.ts       #     GitHub HMAC & multi-cloud alert listener
    │   │   └── widget.ts        #     Host-safe embeddable widget script provider
    │   └── schemas/
    │       └── alert.ts         #   TypeBox request validation schemas
    ├── tools/                   # Operational and autonomous tools
    │   ├── autonomous-repo-auditor.ts # Proactive code-healing engine (AST fixes & auto-PRs)
    │   ├── code-scanner-resolver.ts   # CodeQL, Semgrep & Trivy alert auto-remediator
    │   ├── pr-auto-resolver.ts        # Dependabot & automated PR verifier
    │   ├── sentinel.ts          # Multi-cloud health checks & service auto-healing
    │   ├── cloud.ts             # Cloud Run, OCI Redis, Neon Postgres, & SSRF-safe inspector
    │   ├── cloudflare-ai.ts     # Cloudflare Workers AI & LoRA inference runner
    │   ├── wire-cloud-webhooks.ts # GCP Cloud Monitoring & alert notification auto-wirer
    │   ├── video.ts             # Kaggle script generator, GPU runner, & rerun manager
    │   ├── trends.ts            # Google Trends & topic discovery engine
    │   ├── youtube.ts           # YouTube Data API upload & metadata manager
    │   ├── safety.ts            # Destructive command heuristics & HITL approval queue
    │   └── registry.ts          # HMAC token signing, verification, & edge action executor
    ├── ai/
    │   └── consensus.ts         # Dual-model consensus protocol (Gemini Flash + Groq 120B)
    ├── cron/                    # Scheduled automations
    │   ├── sentinel-cron.ts     #   12-hour multi-cloud health audit job
    │   └── daily-autopilot.ts   #   Automated daily YouTube documentary pipeline
    ├── dashboard/               # Embedded Command Center UI
    │   ├── html.ts              #   Dashboard HTML template
    │   ├── styles.ts            #   Cyberpunk dark-theme CSS styles
    │   └── scripts.ts           #   Interactive client-side JavaScript
    └── core/
        ├── repos.ts             # Autonomous target-repo fleet manager & environment resolver
        ├── json.ts              # Robust JSON payload extraction from model inference streams
        ├── github.ts            # GitHub CLI & API integration wrapper
        └── colors.ts            # Terminal formatting & chalk color utilities
```

---

## 🛠️ Quick Start

### 1. Installation
```bash
git clone https://github.com/ShunyaPulse/ShunopsAI.git
cd ShunopsAI
npm install
```

### 2. Configure Environment
Create your `.env` file from the provided template:
```bash
cp .env.example .env
```
Ensure primary credentials are populated:
```env
# AI Providers
GEMINI_KEYS=key1,key2,key3,...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-...

# GitHub & Cloud Infrastructure
GITHUB_TOKEN=ghp_...
KAGGLE_USERNAME=shunyapulse
KAGGLE_KEY=...
REDIS_URL=redis://...
NEON_DATABASE_URL=postgres://...
```

### 3. Run Autonomous DevOps Tasks
Execute tasks via CLI:
```bash
# Infrastructure health check
npx tsx agent.ts "Check status of Cloud Run services and verify Neon DB connection pool"

# Code healing audit
npx tsx src/tools/autonomous-repo-auditor.ts
```

### 4. Launch Command Server & Web Dashboard
```bash
npm run server
```
Access the Command Center at `http://localhost:4000`.

### 5. Typecheck & Verification
```bash
npm run typecheck
```

---

## 🛡️ Security & Compliance

- **CodeQL**: Zero open alerts (`0 Alerts` on GitHub Security tab).
- **Redaction**: Strict string sanitation prevents sensitive credentials from leaking into clear-text logs.
- **Deterministic CI**: Automated Semgrep, Trivy, Gitleaks, and CodeQL security checks running on every commit.

---

## 📄 License

MIT © [ShunyaPulse](https://github.com/ShunyaPulse)
