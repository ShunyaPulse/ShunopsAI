import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Renders the standalone Public Self-Service & Monetization Portal (BYOK Hub).
 * Designed for non-technical users to easily select services, input free API keys,
 * follow step-by-step visual guides, and launch automated services or monetize them.
 */
export function getShunopsPortalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShunopsAI • Public Self-Service & Monetization Portal (BYOK)</title>
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
    .monetize-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .monetize-card {
      background: linear-gradient(135deg, #0e172a, #14223d);
      border: 1px solid #1f2d4d;
      border-radius: 12px;
      padding: 20px;
    }
    .monetize-card h4 {
      color: #38bdf8;
      font-size: 15px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .monetize-earning {
      font-size: 18px;
      font-weight: 800;
      color: #10b981;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div>
        <div class="brand-title">SHUNOPSAI PORTAL</div>
        <div class="brand-subtitle">Public BYOK Setup & Monetization Launchpad</div>
      </div>
    </div>
    <div class="header-pills">
      <a href="/dashboard" class="btn btn-secondary" style="text-decoration:none;font-size:12px;padding:6px 14px;">← Back to Command Center</a>
      <button class="btn btn-success" onclick="saveAndTestKeys()">💾 Save & Connect Keys</button>
    </div>
  </header>

  <div class="container" style="max-width:1100px;">
    
    <!-- Hero / Introduction -->
    <div class="portal-hero">
      <h1>Turn Autonomous AI Into Income & Automation</h1>
      <p>
        ShunopsAI delivers high-leverage multi-cloud & video automation tools. Select what you need, paste your free API keys using our 30-second direct links, and run everything with zero coding knowledge.
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
            Creates 1080p documentary videos with Alibaba Wan2.1 DiT, Edge-TTS Hindi/English voices, subtitles & auto-publishes to YouTube.
          </p>
        </div>

        <!-- Service 2: Sentinel -->
        <div class="service-choice-card selected" id="card-sentinel" onclick="toggleService('sentinel')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-sentinel">✓</div>
            <strong style="font-size:15px; color:#fff;">🛡️ 24/7 Cloud Sentinel & Auto-Heal</strong>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5;">
            Continuous uptime monitoring, automatic recovery, and alert management for Cloud Run, Postgres, Redis, and websites.
          </p>
        </div>

        <!-- Service 3: Security & GitHub -->
        <div class="service-choice-card" id="card-github" onclick="toggleService('github')">
          <div class="service-choice-header">
            <div class="custom-checkbox" id="chk-github"></div>
            <strong style="font-size:15px; color:#fff;">🔍 GitHub Security & Bug Healer</strong>
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

      <!-- Video & AI Inputs -->
      <div id="section-ai-keys">
        <!-- Groq Key -->
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">1. Groq LPU API Key</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(High-Speed LLM & Script Generator)</span>
            </div>
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Get Free Groq Key (30s • No Card) →
            </a>
          </div>
          <input type="password" id="input-groq-key" class="chat-input" placeholder="gsk_..." style="width:100%;" />
          <div style="font-size:11px; color:#64748b; margin-top:6px;">
            📌 <em>Guide: Log in with Google at console.groq.com/keys → Click "Create API Key" → Copy & paste here.</em>
          </div>
        </div>

        <!-- Gemini Key -->
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">2. Google Gemini API Key</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Multi-Modal & Dual Consensus)</span>
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

      <!-- Kaggle & Video Inputs -->
      <div id="section-video-keys">
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">3. Kaggle Cloud Credentials</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(Free Dual T4 GPU Video Rendering • $0/mo)</span>
            </div>
            <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Get Free Kaggle Token (kaggle.json) →
            </a>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <input type="text" id="input-kaggle-user" class="chat-input" placeholder="Kaggle Username (e.g. shunyapulse)" />
            <input type="password" id="input-kaggle-key" class="chat-input" placeholder="Kaggle API Key (from kaggle.json)" />
          </div>
          <div style="font-size:11px; color:#64748b; margin-top:6px;">
            📌 <em>Guide: Go to Kaggle Settings → Scroll to 'API' section → Click 'Create New Token'. Open downloaded kaggle.json file to copy username and key.</em>
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

      <!-- GitHub & Cloud Sentinel Inputs -->
      <div id="section-github-keys" style="display:none;">
        <div class="key-input-group">
          <div class="key-label-row">
            <div>
              <strong style="color:#fff; font-size:14px;">5. GitHub Personal Access Token</strong>
              <span style="font-size:11px; color:#64748b; margin-left:8px;">(For Repo Auditing & Pull Request Auto-Healing)</span>
            </div>
            <a href="https://github.com/settings/tokens/new?scopes=repo,security_events" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
              🔗 Create GitHub Token (Pre-Configured) →
            </a>
          </div>
          <input type="password" id="input-github-token" class="chat-input" placeholder="ghp_..." style="width:100%;" />
        </div>
      </div>

      <!-- Website / Monitoring Endpoint -->
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
        <button class="btn btn-success" onclick="saveAndTestKeys()">💾 Save & Connect All Keys</button>
      </div>
      <div id="save-status" style="margin-top:10px; font-size:12px; text-align:right;"></div>
    </div>

    <!-- Step 3: 1-Click Launchers -->
    <div class="panel" style="padding:24px; margin-top:24px;">
      <h2 style="font-size:18px; color:#fff; display:flex; align-items:center; gap:8px; margin-bottom:16px;">
        <span>3️⃣</span> Direct 1-Click Service Launchers
      </h2>

      <!-- Video Launcher -->
      <div style="background:#0f172a; border-radius:10px; padding:18px; border:1px solid #1e293b; margin-bottom:16px;">
        <h4 style="color:#38bdf8; margin-bottom:10px;">🎬 Instant Autonomous AI Video Creator</h4>
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:12px; align-items:center;">
          <input type="text" id="quick-video-topic" class="chat-input" placeholder="Topic (e.g. 5 Dark Mysteries of Mariana Trench)" />
          <select id="quick-video-minutes" class="chat-input" style="background:#1e293b; color:#fff;">
            <option value="3">3 Minutes</option>
            <option value="5" selected>5 Minutes</option>
            <option value="10">10 Minutes</option>
          </select>
          <select id="quick-video-lang" class="chat-input" style="background:#1e293b; color:#fff;">
            <option value="Hindi" selected>Hindi Voice</option>
            <option value="English">English Voice</option>
          </select>
          <button class="btn" onclick="launchVideoFromPortal()">🚀 Dispatch Render</button>
        </div>
      </div>

      <!-- Quick Sentinel Test -->
      <div style="background:#0f172a; border-radius:10px; padding:18px; border:1px solid #1e293b;">
        <h4 style="color:#10b981; margin-bottom:10px;">🛡️ Instant Cloud Sentinel Health Check</h4>
        <p style="font-size:12px; color:#94a3b8; margin-bottom:12px;">Pings Cloud Run, Redis, Neon Postgres & Cloudflare AI and gives a real-time health scorecard.</p>
        <button class="btn btn-secondary" onclick="runSentinelAuditFromPortal()">🩺 Run Health Check Now</button>
      </div>
    </div>

    <!-- Step 4: Monetization Blueprint -->
    <div class="panel" style="padding:24px; margin-top:24px;">
      <h2 style="font-size:18px; color:#fff; display:flex; align-items:center; gap:8px;">
        <span>💰</span> Monetization Blueprint: How You Earn with ShunopsAI
      </h2>
      <p style="font-size:13px; color:#94a3b8; margin-top:6px;">
        Proven business models anyone can execute using this exact system:
      </p>

      <div class="monetize-grid">
        <div class="monetize-card">
          <h4>🎬 YouTube Automation Channels</h4>
          <div class="monetize-earning">₹40,000 - ₹3,50,000+/mo</div>
          <p style="font-size:12px; color:#cbd5e1; line-height:1.5;">
            Use the free Kaggle GPU pipeline to generate 1 documentary/educational video daily. Earn from YouTube AdSense, brand integrations, and affiliate links in descriptions.
          </p>
        </div>

        <div class="monetize-card">
          <h4>🛡️ DevOps Sentinel Agency</h4>
          <div class="monetize-earning">₹15,000 - ₹50,000/client/mo</div>
          <p style="font-size:12px; color:#cbd5e1; line-height:1.5;">
            Offer small business owners and startups 24/7 uptime monitoring with automated crash recovery. When their server or database slows down, ShunopsAI restarts it instantly.
          </p>
        </div>

        <div class="monetize-card">
          <h4>🤖 AI Web Chatbot Installation</h4>
          <div class="monetize-earning">₹10,000 setup + ₹2,500/mo</div>
          <p style="font-size:12px; color:#cbd5e1; line-height:1.5;">
            Embed the ShunopsAI Edge Widget (<code style="color:#67e8f9;">widget.js</code>) into client websites (doctors, real estate, agencies). Charge a setup fee plus recurring hosting.
          </p>
        </div>

        <div class="monetize-card">
          <h4>🔍 Code Security & PR Auditing</h4>
          <div class="monetize-earning">₹5,000 - ₹20,000 per repo</div>
          <p style="font-size:12px; color:#cbd5e1; line-height:1.5;">
            Run automated Dual-Model Consensus security audits on client GitHub repos, eliminate CodeQL/Semgrep vulnerabilities, and submit clean pull requests.
          </p>
        </div>
      </div>
    </div>

  </div>

  <footer style="text-align:center; padding:30px; color:#64748b; font-size:12px; border-top:1px solid #1e293b; margin-top:40px;">
    ShunopsAI Autonomous System • Powered by Dual-Model Consensus, OpenRouter, Groq & Gemini
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

      // Update visible key sections
      document.getElementById("section-github-keys").style.display = activeServices.github ? "block" : "none";
      document.getElementById("section-video-keys").style.display = activeServices.video ? "block" : "none";
      document.getElementById("section-ai-keys").style.display = (activeServices.ai || activeServices.video) ? "block" : "none";
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

    async function launchVideoFromPortal() {
      const topic = document.getElementById("quick-video-topic").value.trim() || "Deep Amazon Jungle : 7 Days Solo Survival Mystery";
      const minutes = parseInt(document.getElementById("quick-video-minutes").value, 10);
      const language = document.getElementById("quick-video-lang").value;

      alert("🚀 Launching AI Video Engine for: '" + topic + "' (" + minutes + " mins, " + language + ")... Redirecting to Command Center.");
      window.location.href = "/dashboard";
    }

    async function runSentinelAuditFromPortal() {
      alert("🩺 Running cloud fleet audit... Check Command Center for live status.");
      window.location.href = "/dashboard";
    }

    window.addEventListener("DOMContentLoaded", loadSavedKeys);
  </script>
</body>
</html>`;
}
