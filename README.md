# ⚡ ShunopsAI

> **Autonomous Multi-Cloud Operations & DevOps Sentinel Agent powered by OpenRouter, GitHub Actions, and n8n.**

[![CI/CD & Security Auditing](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/ci-deploy.yml)
[![Services Sentinel](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/sentinel-healthcheck.yml/badge.svg)](https://github.com/ShunyaPulse/ShunopsAI/actions/workflows/sentinel-healthcheck.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌟 Overview

**ShunopsAI** is an autonomous multi-agent orchestrator designed to keep multi-cloud infrastructure error-free and self-healing, automatically remediate GitHub issues and code scanning alerts, and solve any out-of-the-box engineering task on demand.

```
                    +---------------------------------------------+
                    |           SHUNOPSAI MASTER BRAIN            |
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

## 🚀 Key Capabilities

1. **DevOps Sentinel & Auto-Healing**:
   - Continuous concurrent monitoring across **Google Cloud Run**, **Redis on Oracle Cloud Infrastructure (OCI)**, **Neon Serverless Postgres**, **Cloudflare Workers AI**, and **Kaggle GPU pipelines**.
   - Automated self-healing for connection pool drops, hung Redis caches, and model fallbacks.

2. **GitHub GitOps & Auto-Resolver**:
   - Auto-resolves Dependabot PRs, Code Scanning Alerts (Semgrep, Trivy, Gitleaks, CodeQL), and CI failures.
   - Tests and verifies code modifications locally with `npm run typecheck`, then directly commits & pushes to target branches.

3. **Multi-Model Intelligence**:
   - Primary: **Nemotron 3 Ultra 550B** (via OpenRouter).
   - High-throughput fallback chain: **Nemotron 3.5 Lightning**, **Llama 3.3 70B**, **Groq OSS-120B / Qwen 27B**, and **Google AI Studio Gemini 34-Key Pool**.

4. **Zero-Cost GitHub Actions Automation**:
   - Scheduled 6-hour sentinel cron runs.
   - Remote Cloud Operations Dispatch via `workflow_dispatch` and issue labeling.

---

## 🧩 Project Structure

ShunopsAI is split into small, single-responsibility modules:

```
agent.ts                     # CLI entrypoint + stable public re-exports
server.ts                    # HTTP entrypoint (binds the app)
src/
  agent/                     # Autonomous agent core
    models.ts                #   provider/model failover chain + client factory
    prompts.ts               #   system-prompt engineering
    sandbox.ts               #   workspace path safety & secret protection
    tools.ts                 #   tool registry + JSON schemas
    loop.ts                  #   ReAct execution loop
    index.ts                 #   public barrel
  server/                    # Express application
    app.ts                   #   app factory + configuration
    middleware/              #   auth + rate limiting
    routes/                  #   dashboard, sentinel, task, chat, approvals, webhook, widget
  core/                      # Cross-cutting helpers (colors, github, llm)
  tools/                     # Cloud, media, GitHub & self-healing tools
  ai/                        # Dual-model consensus engine
  cron/                      # Scheduled autopilot & sentinel jobs
  dashboard/                 # Dashboard HTML, stylesheet and client script
```

All internal imports use NodeNext `.js` specifiers, and `agent.ts` re-exports
the public agent API so existing callers and CI workflows keep working.

---

## 🛠️ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/ShunyaPulse/ShunopsAI.git
cd ShunopsAI
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in your API keys:
```bash
cp .env.example .env
```

### 3. Run Autonomous Agent Task
```bash
npx tsx agent.ts "Perform full infrastructure health check on Neon, Redis, and Cloud Run"
```

### 4. Start Command Server & Web Dashboard
```bash
npm run server
```
Visit `http://localhost:4000` to access the ShunopsAI Command Center.

### 5. Run Standalone Sentinel Scan
```bash
npx tsx src/cron/sentinel-cron.ts
```

---

## 📄 License
MIT © [ShunyaPulse](https://github.com/ShunyaPulse)
