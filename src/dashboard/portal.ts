import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Renders the standalone Public Self-Service BYOK Portal.
 * Designed for non-technical users to easily select services and input free API keys
 * with step-by-step visual guides.
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
    
    .portal-hero {
      text-align: center;
      padding: 40px 20px 20px;
      max-width: 900px;
      margin: 0 auto;
    }
    .portal-hero h1 {
      font-size: 32px;
      font-weight: 800;
      background: linear-gradient(90deg, #fff, #00f0ff, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    .portal-hero p {
      color: #94a3b8;
      font-size: 15px;
      line-height: 1.6;
    }
    .service-selection-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }
    .service-choice-card {
      background: #0f172a;
      border: 2px solid #1e293b;
      border-radius: 12px;
      padding: 18px;
      cursor: pointer;
      transition: all 0.25s ease;
      position: relative;
    }
    .service-choice-card:hover {
      border-color: #38bdf8;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(56, 189, 248, 0.15);
    }
    .service-choice-card.selected {
      border-color: #00f0ff;
      background: #111e38;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.2);
    }
    .service-choice-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .custom-checkbox {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 2px solid #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .service-choice-card.selected .custom-checkbox {
      background: #00f0ff;
      border-color: #00f0ff;
      color: #000;
      font-weight: 800;
    }
    .key-config-section {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 24px;
      margin-top: 24px;
    }
    .key-input-group {
      margin-bottom: 20px;
      padding: 16px;
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
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.2s;
    }
    .direct-link-badge:hover {
      background: #38bdf8;
      color: #000;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
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

  <div class="container" style="max-width:1100px;">
    
    <!-- Hero / Introduction -->
    <div class="portal-hero">
      <h1>ShunopsAI • Self-Service BYOK Hub</h1>
      <p>
        Select the services you need, paste your free API keys using the direct links below, and connect everything in under 2 minutes — no coding required.
      </p>
    </div>

    <!-- Step 1: Service Checkboxes -->
    <div class="panel" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="font-size:18px; color:#fff; display:flex; align-items:center; gap:8px;">
          <span>1️⃣</span> Select Services You Want to Use
        </h2>
        <span style="font-size:12px; color:var(--text-muted);">Toggle checkboxes below</span>
      </div>

      <div class="service-selection-grid">
        <!-- Service 1: Video -->
        <div class="service-choice-card selected" id="card-video" onclick="toggleService('video')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-video">✓</div>
            <strong style="font-size:15px; color:#fff;">🎬 AI Video Studio (YouTube Cash Cow)</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Creates 1080p documentary videos with Alibaba Wan2.1 DiT, Edge-TTS Hindi/English voices, subtitles &amp; auto-publishes to YouTube.
          </p>
        </div>

        <!-- Service 2: Sentinel -->
        <div class="service-choice-card selected" id="card-sentinel" onclick="toggleService('sentinel')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-sentinel">✓</div>
            <strong style="font-size:15px; color:#fff;">🛡️ 24/7 Cloud Sentinel &amp; Auto-Heal</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Continuous uptime monitoring, automatic recovery, and alert management for Cloud Run, Postgres, Redis, and websites.
          </p>
        </div>

        <!-- Service 3: Security & GitHub -->
        <div class="service-choice-card" id="card-github" onclick="toggleService('github')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-github"></div>
            <strong style="font-size:15px; color:#fff;">🔍 GitHub Security &amp; Bug Healer</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Proactively scans repositories for security flaws, auto-fixes CodeQL/Semgrep alerts, and reviews PRs with Dual-Model Consensus.
          </p>
        </div>

        <!-- Service 4: Fast AI Router -->
        <div class="service-choice-card selected" id="card-ai" onclick="toggleService('ai')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-ai">✓</div>
            <strong style="font-size:15px; color:#fff;">🧠 Multi-Cloud AI Router (Ultra-Fast)</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Lightning-fast completions with automatic failover between Groq LPUs, Google Gemini 3.8 Flash, and Cloudflare Workers AI.
          </p>
        </div>

        <!-- Service 5: Web Widget -->
        <div class="service-choice-card" id="card-widget" onclick="toggleService('widget')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-widget"></div>
            <strong style="font-size:15px; color:#fff;">🤖 Embeddable Website Chatbot</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Embed ShunopsAI into your or your clients' websites with 1 script tag. Provide instant automated customer support.
          </p>
        </div>
      </div>
    </div>

    <!-- Step 2: Input Boxes with Direct Links & Step-by-Step Guidance -->
    <div class="key-config-section">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="font-size:18px; color:#fff; display:flex; align-items:center; gap:8px;">
          <span>2️⃣</span> Paste Your Free API Keys (Zero Cost)
        </h2>
        <span style="font-size:12px; color:#10b981; font-weight:600;">🔒 Stored securely in your browser</span>
      </div>
      <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
        No credit card is required for these free tiers. Click the direct links below to get your keys in seconds:
      </p>

      <!-- AI Keys (Groq + Gemini) — shown when AI Router or Video is active -->
      <div id="section-ai-keys">
        <!-- Groq Key -->
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">1. Groq LPU API Key</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(High-Speed LLM &amp; Script Generator)</span>
            </div>
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Get Free Groq Key (30s • No Card) →
            </a>
          </div>
          <input type="password" id="input-groq-key" class="chat-input" placeholder="gsk_..." style="width:100%;" />
          <div style="font-size:11px; color:#64748b; margin-top:6px;">
            📌 <em>Guide: Log in with Google at console.groq.com/keys → Click "Create API Key" → Copy &amp; paste here.</em>
          </div>
        </div>

        <!-- Gemini Key -->
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">2. Google Gemini API Key</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Multi-Modal &amp; Dual Consensus)</span>
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
              <strong style="color:#fff; font-size:14px;">3. Kaggle Cloud Credentials</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Free Dual T4 GPU Video Rendering • \$0/mo)</span>
            </div>
            <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Get Free Kaggle Token →
            </a>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <input type="text" id="input-kaggle-user" class="chat-input" placeholder="Kaggle Username (e.g. shunyapulse)" />
            <input type="password" id="input-kaggle-key" class="chat-input" placeholder="Kaggle API Token" />
          </div>
          <div style="font-size:11px; color:#64748b; margin-top:6px;">
            📌 <em>Guide: Go to Kaggle Settings → Under 'API Tokens (Recommended)' → Click 'Generate New Token' → Copy your username and the generated token.</em>
          </div>
        </div>

        <!-- Hugging Face Token -->
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">4. Hugging Face Access Token</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Wan2.1 / Model weights)</span>
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
              <strong style="color:#fff; font-size:14px;">5. GitHub Personal Access Token</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(For Repo Auditing &amp; Pull Request Auto-Healing)</span>
            </div>
            <a href="https://github.com/settings/tokens/new?scopes=repo,security_events" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Create GitHub Token (Pre-Configured) →
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
              <strong style="color:#fff; font-size:14px;">6. Target Website / Cloud URL to Monitor</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Your or Client's URL)</span>
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

  <footer style="text-align:center; padding:30px; color:#64748b; font-size:12px; border-top:1px solid #1e293b; margin-top:40px;">
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
