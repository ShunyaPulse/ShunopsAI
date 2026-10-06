import { DASHBOARD_STYLES } from "./styles.js";
import { DASHBOARD_SCRIPTS } from "./scripts.js";

/**
 * Render the ShunopsAI Command Center dashboard as a single self-contained
 * HTML document.
 *
 * The stylesheet and client script live in sibling modules to keep each
 * concern reviewable in isolation.
 */
export function getShunopsDashboardHtml(initialData: {
  models: string[];
  tools: string[];
  uptimeSeconds: number;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShunopsAI • Multi-Agent Autonomous Command Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${DASHBOARD_STYLES}</style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div>
        <div class="brand-title">SHUNOPSAI COMMAND</div>
        <div class="brand-subtitle">Autonomous Multi-Cloud & DevOps Sentinel System</div>
      </div>
    </div>
    <div class="header-pills">
      <div class="pill">
        <div class="pulse-dot"></div>
        <span id="overall-status">SENTINEL ACTIVE</span>
      </div>
      <div class="pill">
        <span>Model: <strong>${initialData.models[0]?.split("/").pop() || "Nemotron-3-Ultra"}</strong></span>
      </div>
      <div class="pill">
        <span>Uptime: <strong id="uptime">${Math.floor(initialData.uptimeSeconds / 60)}m</strong></span>
      </div>
      <button id="btn-toggle-autonomy" class="btn btn-danger" style="border-radius:20px;font-size:11px;padding:6px 14px;" onclick="toggleAutonomyPause()">
        <span id="autonomy-btn-icon">⏸️</span>
        <span id="autonomy-btn-text">Pause Autonomy</span>
      </button>
    </div>
  </header>

  <div id="autonomy-paused-banner" class="banner-paused" style="display: none;">
    <span>⚠️ <strong>EMERGENCY KILLSWITCH ACTIVE:</strong> All background automations, scheduled crons, and autonomous AI inference are currently PAUSED.</span>
    <button class="btn btn-success" style="padding: 4px 12px; font-size: 11px; border-radius: 12px; margin-left: 12px;" onclick="toggleAutonomyPause()">▶️ Resume Now</button>
  </div>

  <div class="container">
    <!-- Left Column: Infrastructure Sentinel & Cloud Fleet -->
    <div style="display: flex; flex-direction: column; gap: 24px;">

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span>🛡️</span> Cloud Infrastructure Fleet & Sentinel Matrix
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="runHeal()">🛠️ Auto-Heal</button>
            <button class="btn" onclick="refreshSentinel()">⚡ Scan Now</button>
          </div>
        </div>

        <div class="grid-cards" id="services-grid">
          <div style="padding: 20px; color: var(--text-muted); font-family: var(--code-font); grid-column: 1 / -1;">
            Fetching live telemetry from Neon, OCI Redis, Cloudflare AI, Cloud Run, and Kaggle...
          </div>
        </div>
      </div>

      <!-- Out-of-the-Box Capabilities Banner -->
      <div class="panel" style="padding: 20px; background: linear-gradient(135deg, #0e172a, #132240);">
        <h3 style="font-size: 15px; margin-bottom: 8px; color: #67e8f9;">🤖 ShunopsAI Multi-Agent Architecture</h3>
        <p style="font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          Equipped with <strong>${initialData.tools.length} real tools</strong> across <strong>DevOps Sentinel</strong>, <strong>Neon SQL</strong>, <strong>OCI Redis</strong>, <strong>Cloudflare Workers AI</strong>, <strong>Video Automation Engine</strong>, <strong>GitHub Actions GitOps</strong>, and <strong>Interactive Web Bot</strong>. Ready to achieve any out-of-the-box goal.
        </p>
        <div style="display: flex; gap: 12px; margin-top: 14px; flex-wrap: wrap;">
          <a href="/widget.js" target="_blank" class="btn btn-secondary" style="text-decoration: none;">📦 Embed Web Widget</a>
          <button class="btn btn-secondary" onclick="insertPrompt('Generate a complete 5-minute autonomous trending video script and launch Kaggle GPU kernel')">🎬 Launch Video Agent</button>
          <button class="btn btn-secondary" onclick="insertPrompt('Inspect Neon SQL, count tables, and check OCI Redis memory usage')">🔍 Full Stack Audit</button>
        </div>
      </div>

    </div>

    <!-- Right Column: Interactive ShunopsAI Terminal & Bot -->
    <div class="panel chat-container">
      <div class="panel-header">
        <div class="panel-title">
          <span>💬</span> ShunopsAI Command Terminal
        </div>
        <div style="font-size: 11px; color: var(--text-muted); font-family: var(--code-font);">
          Autonomous Execution
        </div>
      </div>

      <div class="chat-messages" id="chat-stream">
        <div class="chat-bubble chat-agent">
          <strong>ShunopsAI:</strong> Greetings. All systems are synchronized. You can ask me to perform ANY out-of-the-box task, manage Cloud Run, monitor OCI Redis, run SQL queries on Neon, generate AI videos, or run tests. How may I assist you today?
        </div>
      </div>

      <!-- Quick Task Pills -->
      <div class="quick-pills">
        <button class="qp-btn" onclick="insertPrompt('Run comprehensive sentinel scan on all services and show status')">🩺 Sentinel Scan</button>
        <button class="qp-btn" onclick="insertPrompt('Ping OCI Redis and get memory stats')">⚡ Test Redis</button>
        <button class="qp-btn" onclick="insertPrompt('Query Neon Postgres for current database and latency')">🐘 Query Neon</button>
        <button class="qp-btn" onclick="insertPrompt('Send test prompt to Cloudflare Workers AI with Llama 3.1')">🧠 Test CF AI</button>
      </div>

      <form class="chat-input-bar" id="chat-form" onsubmit="handleSend(event)">
        <input type="text" class="chat-input" id="prompt-input" placeholder="Give ShunopsAI any out-of-the-box task..." autocomplete="off" />
        <button type="submit" class="btn" id="send-btn">Dispatch</button>
      </form>
    </div>
  </div>

  <script>${DASHBOARD_SCRIPTS}</script>
</body>
</html>`;
}
