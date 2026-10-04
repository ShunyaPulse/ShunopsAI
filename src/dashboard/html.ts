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
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --accent: #00f0ff;
      --accent-glow: rgba(0, 240, 255, 0.25);
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --code-font: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00f0ff, #3b82f6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #fff, #00f0ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-subtitle {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .header-pills {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .pill {
      background: #1e293b;
      border: 1px solid var(--card-border);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--code-font);
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 440px;
      gap: 24px;
      flex: 1;
    }
    @media (max-width: 1024px) {
      .container { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }
    .panel-title {
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      background: linear-gradient(135deg, #00f0ff, #2563eb);
      color: #000;
      font-weight: 700;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover {
      box-shadow: 0 0 15px var(--accent-glow);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: #334155;
      color: #fff;
    }
    .grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      padding: 20px;
    }
    .service-card {
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      transition: border-color 0.2s;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .service-card:hover {
      border-color: var(--accent);
    }
    .sc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .sc-title {
      font-size: 14px;
      font-weight: 600;
    }
    .sc-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      font-family: var(--code-font);
      font-weight: 600;
    }
    .badge-ok { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid var(--green); }
    .badge-down { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid var(--red); }
    .badge-deg { background: rgba(245, 158, 11, 0.15); color: var(--yellow); border: 1px solid var(--yellow); }
    .sc-body {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--code-font);
      line-height: 1.5;
    }
    .sc-metric {
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      margin: 6px 0;
    }
    /* Chat & Terminal */
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 650px;
    }
    .chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 13px;
    }
    .chat-bubble {
      padding: 12px 16px;
      border-radius: 10px;
      max-width: 88%;
      line-height: 1.5;
      word-break: break-word;
    }
    .chat-user {
      align-self: flex-end;
      background: #1e3a8a;
      color: #fff;
      border-bottom-right-radius: 2px;
    }
    .chat-agent {
      align-self: flex-start;
      background: #111c30;
      border: 1px solid var(--card-border);
      color: var(--text);
      border-bottom-left-radius: 2px;
    }
    .chat-agent pre {
      background: #090d16;
      padding: 10px;
      border-radius: 6px;
      margin-top: 8px;
      overflow-x: auto;
      font-family: var(--code-font);
      font-size: 12px;
      border: 1px solid #1e293b;
    }
    .chat-input-bar {
      padding: 14px;
      border-top: 1px solid var(--card-border);
      background: rgba(0, 0, 0, 0.2);
      display: flex;
      gap: 10px;
    }
    .chat-input {
      flex: 1;
      background: #090d16;
      border: 1px solid var(--card-border);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .chat-input:focus {
      border-color: var(--accent);
    }
    .quick-pills {
      display: flex;
      gap: 8px;
      padding: 10px 16px;
      background: #0a101d;
      border-top: 1px solid var(--card-border);
      overflow-x: auto;
      white-space: nowrap;
    }
    .qp-btn {
      background: #162032;
      border: 1px solid var(--card-border);
      color: #93c5fd;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .qp-btn:hover {
      background: #1e293b;
      border-color: var(--accent);
      color: #fff;
    }
  </style>
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
    </div>
  </header>

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

  <script>
    async function refreshSentinel() {
      const grid = document.getElementById("services-grid");
      grid.innerHTML = '<div style="padding: 20px; color: #67e8f9; font-family: var(--code-font); grid-column: 1 / -1;">Running live Sentinel scan across all cloud providers...</div>';
      
      try {
        const res = await fetch("/api/sentinel/status");
        const data = await res.json();
        renderServices(data);
      } catch (e) {
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444; grid-column: 1 / -1;">Failed to fetch Sentinel report: ' + e.message + '</div>';
      }
    }

    function renderServices(summary) {
      const grid = document.getElementById("services-grid");
      if (!summary || !summary.services) return;

      const badgeMap = {
        healthy: '<span class="sc-badge badge-ok">HEALTHY</span>',
        degraded: '<span class="sc-badge badge-deg">DEGRADED</span>',
        down: '<span class="sc-badge badge-down">DOWN</span>',
        unconfigured: '<span class="sc-badge">UNCONFIGURED</span>'
      };

      grid.innerHTML = summary.services.map(s => \`
        <div class="service-card">
          <div>
            <div class="sc-header">
              <div class="sc-title">\${escapeHtml(String(s.service))}</div>
              \${badgeMap[s.status] || badgeMap.healthy}
            </div>
            <div class="sc-metric">\${s.latencyMs !== undefined ? s.latencyMs + 'ms' : 'Active'}</div>
          </div>
          <div class="sc-body">
            <div>Category: \${escapeHtml(String(s.category || '').toUpperCase())}</div>
            <div style="font-size: 11px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              \${s.error ? '<span style="color:#ef4444">' + escapeHtml(String(s.error)) + '</span>' : escapeHtml(JSON.stringify(s.details || {}))}
            </div>
          </div>
        </div>
      \`).join("");

      const statusEl = document.getElementById("overall-status");
      if (summary.overallStatus === "all_systems_operational") {
        statusEl.innerText = "ALL SYSTEMS NOMINAL (9/9)";
        statusEl.style.color = "var(--green)";
      } else {
        statusEl.innerText = summary.overallStatus.toUpperCase();
        statusEl.style.color = "var(--yellow)";
      }
    }

    async function runHeal() {
      appendMsg("Auto-Healing triggered across degraded cloud services...", "user");
      try {
        const res = await fetch("/api/sentinel/heal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceName: "all" }) });
        const data = await res.json();
        appendMsg("ShunopsAI Auto-Healing Result: " + JSON.stringify(data, null, 2), "agent");
        refreshSentinel();
      } catch (e) {
        appendMsg("Auto-healing error: " + e.message, "agent");
      }
    }

    function insertPrompt(p) {
      document.getElementById("prompt-input").value = p;
      document.getElementById("prompt-input").focus();
    }

    function appendMsg(text, sender) {
      const box = document.getElementById("chat-stream");
      const div = document.createElement("div");
      div.className = "chat-bubble " + (sender === "user" ? "chat-user" : "chat-agent");
      
      if (sender === "agent" && (text.includes("---") || text.includes("{") || text.includes("|"))) {
        div.innerHTML = "<strong>ShunopsAI:</strong><pre>" + escapeHtml(text) + "</pre>";
      } else {
        div.innerHTML = (sender === "user" ? "<strong>You: </strong>" : "<strong>ShunopsAI: </strong>") + escapeHtml(text);
      }
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    async function handleSend(e) {
      e.preventDefault();
      const input = document.getElementById("prompt-input");
      const btn = document.getElementById("send-btn");
      const task = input.value.trim();
      if (!task) return;

      appendMsg(task, "user");
      input.value = "";
      btn.disabled = true;
      btn.innerText = "Thinking...";

      try {
        const res = await fetch("/api/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: task, maxSteps: 8 })
        });
        const data = await res.json();
        if (data.finalAnswer) {
          appendMsg(data.finalAnswer, "agent");
        } else {
          appendMsg(JSON.stringify(data, null, 2), "agent");
        }
      } catch (err) {
        appendMsg("Execution error: " + err.message, "agent");
      } finally {
        btn.disabled = false;
        btn.innerText = "Dispatch";
      }
    }

    // Auto-load on startup
    window.addEventListener("DOMContentLoaded", () => {
      refreshSentinel();
    });
  </script>
</body>
</html>`;
}
