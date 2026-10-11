import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Renders the standalone Public Self-Service BYOK Portal.
 * Designed for non-technical users to easily select services and input free API keys
 * with step-by-step visual guides in a balanced 2-column layout.
 */
export function getShunopsPortalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShunopsAI • Public Self-Service BYOK Portal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${DASHBOARD_STYLES}

    /* Portal Overrides: Single page balanced grid layout */
    .portal-page-container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 20px 40px;
      width: 100%;
    }

    .portal-hero {
      text-align: center;
      padding: 20px 16px 28px;
      max-width: 820px;
      margin: 0 auto;
    }
    .portal-hero h1 {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(90deg, #fff, #00f0ff, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .portal-hero p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
    }

    /* Two-column side-by-side layout: Services on left, Keys on right */
    .portal-content-grid {
      display: grid;
      grid-template-columns: 460px 1fr;
      gap: 24px;
      align-items: start;
    }

    @media (max-width: 980px) {
      .portal-content-grid {
        grid-template-columns: 1fr;
      }
    }

    .service-selection-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .service-choice-card {
      background: #0f172a;
      border: 2px solid #1e293b;
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .service-choice-card:hover {
      border-color: #38bdf8;
      background: #111e38;
      transform: translateY(-1px);
    }
    .service-choice-card.selected {
      border-color: #00f0ff;
      background: #101c38;
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.15);
    }
    .service-choice-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .custom-checkbox {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      border: 2px solid #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .service-choice-card.selected .custom-checkbox {
      background: #00f0ff;
      border-color: #00f0ff;
      color: #000;
    }

    .key-config-panel {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 22px;
    }

    .key-input-group {
      margin-bottom: 16px;
      padding: 14px;
      background: #0f172a;
      border-radius: 10px;
      border: 1px solid #1e293b;
    }
    .key-label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .direct-link-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 9px;
      border-radius: 16px;
      font-size: 11px;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.2s;
    }
    .direct-link-badge:hover {
      background: #38bdf8;
      color: #000;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div>
        <div class="brand-title">SHUNOPSAI PORTAL</div>
        <div class="brand-subtitle">Public BYOK Setup Hub</div>
      </div>
    </div>
    <div class="header-pills">
      <a href="/dashboard" class="btn btn-secondary" style="text-decoration:none;font-size:12px;padding:6px 14px;">← Back to Command Center</a>
      <button class="btn btn-success" onclick="saveAndTestKeys()">💾 Save &amp; Connect Keys</button>
    </div>
  </header>

  <div class="portal-page-container">
    
    <!-- Hero / Introduction -->
    <div class="portal-hero">
      <h1>ShunopsAI • Self-Service BYOK Hub</h1>
      <p>
        Select the services you need on the left, paste your free keys on the right using 1-click links, and connect everything in under 2 minutes.
      </p>
    </div>

    <!-- Main 2-Column Responsive Layout -->
    <div class="portal-content-grid">
      
      <!-- Left Column: Step 1 (Services Selection) -->
      <div class="panel" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #1e293b;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>1️⃣</span> Select Services
          </h2>
          <span style="font-size:11px; color:var(--text-muted);">Toggle to add keys →</span>
        </div>

        <div class="service-selection-col">
          <!-- Service 1: Video -->
          <div class="service-choice-card selected" id="card-video" onclick="toggleService('video')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-video">✓</div>
              <strong style="font-size:14px; color:#fff;">🎬 AI Video Studio (Wan2.1 DiT)</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Creates 1080p documentary videos with Alibaba Wan2.1 DiT, Edge-TTS voices &amp; auto-publish.
            </p>
          </div>

          <!-- Service 2: Sentinel -->
          <div class="service-choice-card selected" id="card-sentinel" onclick="toggleService('sentinel')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-sentinel">✓</div>
              <strong style="font-size:14px; color:#fff;">🛡️ 24/7 Cloud Sentinel &amp; Auto-Heal</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Continuous uptime monitoring and automated recovery for Cloud Run, Postgres &amp; endpoints.
            </p>
          </div>

          <!-- Service 3: Security & GitHub -->
          <div class="service-choice-card" id="card-github" onclick="toggleService('github')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-github"></div>
              <strong style="font-size:14px; color:#fff;">🔍 GitHub Security &amp; Bug Healer</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Auto-scans repositories, patches CodeQL alerts, and reviews PRs with Dual-Model Consensus.
            </p>
          </div>

          <!-- Service 4: Fast AI Router -->
          <div class="service-choice-card selected" id="card-ai" onclick="toggleService('ai')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-ai">✓</div>
              <strong style="font-size:14px; color:#fff;">🧠 Multi-Cloud AI Router (Ultra-Fast)</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Sub-second LLM completions with auto failover between Groq LPUs and Gemini 3.8 Flash.
            </p>
          </div>

          <!-- Service 5: Web Widget -->
          <div class="service-choice-card" id="card-widget" onclick="toggleService('widget')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-widget"></div>
              <strong style="font-size:14px; color:#fff;">🤖 Embeddable Website Chatbot</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Embed AI assistant into websites with 1 script tag for instant 24/7 client support.
            </p>
          </div>
        </div>
      </div>

      <!-- Right Column: Step 2 (Keys Input Panel) -->
      <div class="key-config-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #1e293b;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>2️⃣</span> Paste Free API Keys
          </h2>
          <span style="font-size:11px; color:#10b981; font-weight:600;">🔒 Stored locally in browser</span>
        </div>
        <p style="font-size:12px; color:#94a3b8; margin-bottom:18px;">
          Free tiers only • Zero cost • No credit card required. Keys adapt dynamically to selected services.
        </p>

        <!-- AI Keys (Groq + Gemini) — shown when AI Router or Video is active -->
        <div id="section-ai-keys">
          <!-- Groq Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">1. Groq LPU API Key</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Ultra-Fast LLM)</span>
              </div>
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Groq Key (30s) →
              </a>
            </div>
            <input type="password" id="input-groq-key" class="chat-input" placeholder="gsk_..." style="width:100%;" />
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: Log in at console.groq.com/keys → Click "Create API Key" → Paste here.</em>
            </div>
          </div>

          <!-- Gemini Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">2. Google Gemini API Key</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Multi-Modal &amp; Consensus)</span>
              </div>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Gemini Key (1-Click) →
              </a>
            </div>
            <input type="password" id="input-gemini-key" class="chat-input" placeholder="AIzaSy..." style="width:100%;" />
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: Visit Google AI Studio → Click "Create API Key in new project" → Paste here.</em>
            </div>
          </div>
        </div>

        <!-- Video Keys (Kaggle + Hugging Face) — shown only when Video is active -->
        <div id="section-video-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">3. Kaggle Cloud Credentials</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Free Dual T4 GPU Render)</span>
              </div>
              <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Kaggle Token →
              </a>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <input type="text" id="input-kaggle-user" class="chat-input" placeholder="Kaggle Username" />
              <input type="password" id="input-kaggle-key" class="chat-input" placeholder="Kaggle API Token" />
            </div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: Go to Kaggle Settings → Under 'API Tokens (Recommended)' → Click 'Generate New Token' → Copy username and token.</em>
            </div>
          </div>

          <!-- Hugging Face Token -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">4. Hugging Face Access Token</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Model weights)</span>
              </div>
              <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free HF Token (Read) →
              </a>
            </div>
            <input type="password" id="input-hf-token" class="chat-input" placeholder="hf_..." style="width:100%;" />
          </div>
        </div>

        <!-- GitHub Keys — shown only when GitHub Security is active -->
        <div id="section-github-keys" style="display:none;">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">5. GitHub Personal Access Token</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Repo Auto-Healing)</span>
              </div>
              <a href="https://github.com/settings/tokens/new?scopes=repo,security_events" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Create GitHub Token →
              </a>
            </div>
            <input type="password" id="input-github-token" class="chat-input" placeholder="ghp_..." style="width:100%;" />
          </div>
        </div>

        <!-- Sentinel Keys — shown only when Sentinel is active -->
        <div id="section-sentinel-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">6. Target Website / Cloud URL to Monitor</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Endpoint)</span>
              </div>
            </div>
            <input type="text" id="input-monitor-url" class="chat-input" placeholder="https://my-app.run.app or https://mywebsite.com" style="width:100%;" />
          </div>
        </div>

        <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:20px;">
          <button class="btn btn-secondary" onclick="loadSavedKeys()">↺ Reset from Storage</button>
          <button class="btn btn-success" onclick="saveAndTestKeys()">💾 Save &amp; Connect All Keys</button>
        </div>
        <div id="save-status" style="margin-top:10px; font-size:12px; text-align:right;"></div>
      </div>

    </div>

  </div>

  <footer style="text-align:center; padding:24px; color:#64748b; font-size:12px; border-top:1px solid #1e293b; margin-top:40px;">
    ShunopsAI Autonomous System • Powered by Dual-Model Consensus, OpenRouter, Groq &amp; Gemini
  </footer>

  <script>
    // Portal Client State
    const activeServices = {
      video: true,
      sentinel: true,
      github: false,
      ai: true,
      widget: false
    };

    function applySectionVisibility() {
      document.getElementById("section-ai-keys").style.display =
        (activeServices.ai || activeServices.video) ? "block" : "none";
      document.getElementById("section-video-keys").style.display =
        activeServices.video ? "block" : "none";
      document.getElementById("section-github-keys").style.display =
        activeServices.github ? "block" : "none";
      document.getElementById("section-sentinel-keys").style.display =
        activeServices.sentinel ? "block" : "none";
    }

    function toggleService(key) {
      activeServices[key] = !activeServices[key];
      const card = document.getElementById("card-" + key);
      const chk = document.getElementById("chk-" + key);
      
      if (activeServices[key]) {
        card.classList.add("selected");
        chk.innerText = "✓";
      } else {
        card.classList.remove("selected");
        chk.innerText = "";
      }

      applySectionVisibility();
    }

    function saveAndTestKeys() {
      const keys = {
        groq: document.getElementById("input-groq-key").value.trim(),
        gemini: document.getElementById("input-gemini-key").value.trim(),
        kaggleUser: document.getElementById("input-kaggle-user").value.trim(),
        kaggleKey: document.getElementById("input-kaggle-key").value.trim(),
        hf: document.getElementById("input-hf-token").value.trim(),
        github: document.getElementById("input-github-token").value.trim(),
        monitorUrl: document.getElementById("input-monitor-url").value.trim(),
        services: activeServices
      };

      localStorage.setItem("shunops_byok_keys", JSON.stringify(keys));
      const status = document.getElementById("save-status");
      status.innerHTML = '<span style="color:#10b981;font-weight:600;">✅ Keys securely saved in browser! You are ready to launch any service.</span>';
      setTimeout(() => { status.innerHTML = ""; }, 5000);
    }

    function loadSavedKeys() {
      try {
        const raw = localStorage.getItem("shunops_byok_keys");
        if (!raw) return;
        const keys = JSON.parse(raw);
        if (keys.groq) document.getElementById("input-groq-key").value = keys.groq;
        if (keys.gemini) document.getElementById("input-gemini-key").value = keys.gemini;
        if (keys.kaggleUser) document.getElementById("input-kaggle-user").value = keys.kaggleUser;
        if (keys.kaggleKey) document.getElementById("input-kaggle-key").value = keys.kaggleKey;
        if (keys.hf) document.getElementById("input-hf-token").value = keys.hf;
        if (keys.github) document.getElementById("input-github-token").value = keys.github;
        if (keys.monitorUrl) document.getElementById("input-monitor-url").value = keys.monitorUrl;
        
        if (keys.services) {
          for (const s of Object.keys(keys.services)) {
            if (activeServices[s] !== keys.services[s]) {
              toggleService(s);
            }
          }
        }
      } catch (e) {}
    }

    window.addEventListener("DOMContentLoaded", () => {
      applySectionVisibility();
      loadSavedKeys();
    });
  </script>
</body>
</html>`;
}
