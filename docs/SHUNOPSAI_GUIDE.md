# ⚡ ShunopsAI: Autonomous Multi-Cloud & DevOps Sentinel Guide

## 1. Overview & Architecture

**ShunopsAI** is an autonomous multi-agent engineering and cloud operations orchestrator built to manage infrastructure (Google Cloud Run, Redis on OCI, Neon Postgres, Cloudflare Workers AI, Kaggle), automate creative media pipelines, deploy code via GitOps, and solve any out-of-the-box task on demand.

```
                    +---------------------------------------------+
                    |            SHUNOPSAI MASTER BRAIN           |
                    |   (OpenRouter / Groq / Gemini 34-Key Pool)   |
                    +----------------------+----------------------+
                                           |
    +------------------+-------------------+------------------+------------------+
    |                  |                   |                  |                  |
    v                  v                   v                  v                  v
[DevOps Sentinel] [Media Engine]    [Cloud Services]   [GitHub GitOps]   [Visual Bridges]
 - Neon DBs        - Scripting       - Cloud Run        - Scheduled Cron  - n8n Webhook
 - OCI Redis       - Kaggle GPU      - GCE Host SSH     - Issue Trigger   - Dify OpenAPI
 - CF Workers AI   - Edge TTS        - CF Workers AI    - Auto-Resolver   - Web Dashboard
 - Uptime & URLs   - Auto-YouTube    - Auto-Healing     - CI Security     - Web Widget
```

---

### 1.1 Module Layout

The codebase is organized into focused, single-responsibility modules:

```
agent.ts                     # CLI entrypoint + public re-exports
server.ts                    # HTTP entrypoint
src/agent/                   # agent core: models, prompts, sandbox, tools, loop
src/server/                  # Express app: app.ts, middleware/, routes/
src/core/                    # cross-cutting helpers (colors, github, llm)
src/tools/                   # cloud, media, GitHub, sentinel, notifier, safety
src/ai/                      # dual-model consensus engine
src/cron/                    # scheduled autopilot & sentinel jobs
src/dashboard/               # dashboard HTML, stylesheet, client script
```

---

## 2. Core Pillars & Capabilities

### 🛡️ Pillar 1: DevOps Sentinel & Auto-Healing
Monitors, benchmarks, and maintains 100% error-free operation across all services:
- **Neon Serverless Postgres**: Tests Primary DB, Saralgati DB, and Kanban DB (`SELECT 1`), monitors latency and connection pools.
- **OCI Redis (Oracle Cloud VM)**: Pings Redis, inspects memory allocation (`INFO memory`), checks network latency.
- **Cloudflare Workers AI**: Probes real-time inference on models like `@cf/meta/llama-3.1-8b-instruct` or custom LoRA adapters.
- **Google Cloud Run Applications**: Monitors live HTTPS endpoints (`SARALGATI_APP_URL`, `KANBAN_APP_URL`) and revisions.
- **Kaggle GPU Clusters**: Monitors batch render kernels and quota.
- **Auto-Healing**: Reconnects hung pools, verifies service recovery, and triggers alerts.

### 🚀 Pillar 2: GitHub Actions Zero-Cost Automation
- **`.github/workflows/ops.yml`**: Scheduled 6-hour sentinel health check & incident creator, plus manual cloud dispatch (`workflow_dispatch`) and issue-triggered tasks for Cloud Run, OCI Redis, Neon, Cloudflare, and Kaggle.
- **`.github/workflows/ci-deploy.yml`**: Runs Semgrep, Trivy, Gitleaks, CodeQL, and Promptfoo, then auto-remediates CI/security failures and resolves Code Scanning alerts.

### 🌐 Pillar 3: Web Dashboard & Website Bot
- **Interactive Control Center (`http://localhost:4000/`)**:
  - Live HUD displaying real-time health cards for Neon, Redis, Cloudflare, Cloud Run, and Kaggle.
  - Interactive ShunopsAI Terminal: Ask any out-of-the-box question or command.
  - 1-Click "Scan Now" and "Auto-Heal".
- **Website Bot (Dify)**:
  - Exclusively for visitors/users to answer questions and provide support without exposing privileged tools.

---

## 3. Quick Start & Execution

### Start the ShunopsAI Command Server
```bash
npm run server
```
Visit `http://localhost:4000` in your browser.

### Run an Autonomous Task via CLI
```bash
npx tsx agent.ts "Check OCI Redis memory and run a health check on Neon Postgres"
```

### Run Infrastructure Sentinel Check
```bash
npx tsx src/cron/sentinel-cron.ts
```
