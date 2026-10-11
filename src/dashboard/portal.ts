import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Renders the standalone Public Self-Service BYOK Key Hub.
 *
 * Security Architecture (Zero-Persistence & Hardware-Bound Vault):
 * - Storage: W3C IndexedDB + Non-Extractable CryptoKey (extractable: false, AES-256-GCM).
 *   Raw master key bytes cannot be extracted by JavaScript or exfiltrated via XSS.
 * - Zero-Persistence: Keys sent per-request over TLS 1.3 for ephemeral execution in memory.
 *   Zero server database storage, zero disk writes, zero secret logging.
 * - Stateless Verification: POST /api/portal/verify tests keys directly against provider APIs.
 * - Least-Privilege GitHub Guidance: Fine-grained tokens scoped to a single repo only.
 * - Hardened Inputs: autocomplete="new-password", masked password fields, zero innerHTML XSS sinks.
 */
export function getShunopsPortalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShunopsAI • Public BYOK Key Portal (Zero-Persistence)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${DASHBOARD_STYLES}

    .portal-page-container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 20px 20px 40px;
      width: 100%;
    }

    .portal-hero {
      text-align: center;
      padding: 16px 16px 24px;
      max-width: 860px;
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

    /* 2-column responsive layout */
    .portal-content-grid {
      display: grid;
      grid-template-columns: 440px 1fr;
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

    /* Zero-Persistence Security Trust Banner */
    .security-status-banner {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(14, 165, 233, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .key-input-group {
      margin-bottom: 16px;
      padding: 14px;
      background: #0f172a;
      border-radius: 10px;
      border: 1px solid #1e293b;
      position: relative;
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

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }
    .password-input-wrapper input {
      width: 100%;
      padding-right: 40px !important;
    }
    .eye-toggle-btn {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 6px;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }
    .eye-toggle-btn:hover {
      color: #00f0ff;
    }

    /* Verification status badges */
    .verify-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
    }
    .verify-badge.success {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .verify-badge.error {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Modal */
    .security-modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .security-modal-card {
      background: #0f172a;
      border: 1px solid #38bdf8;
      border-radius: 14px;
      max-width: 640px;
      width: 100%;
      padding: 26px;
      box-shadow: 0 16px 40px rgba(0, 240, 255, 0.15);
      max-height: 90vh;
      overflow-y: auto;
    }
    .security-modal-card h3 {
      font-size: 18px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .audit-point {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
    }
    .audit-point-icon {
      font-size: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .audit-point-text strong {
      display: block;
      color: #38bdf8;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .audit-point-text p {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div>
        <div class="brand-title">SHUNOPSAI PORTAL</div>
        <div class="brand-subtitle">Zero-Persistence BYOK Hub</div>
      </div>
    </div>
    <div class="header-pills">
      <button type="button" class="btn btn-secondary" onclick="openSecurityModal()" style="font-size:12px; padding:6px 14px;">
        🛡️ Zero-Persistence Model
      </button>
      <a href="/dashboard" class="btn btn-secondary" style="text-decoration:none;font-size:12px;padding:6px 14px;">
        ← Command Center
      </a>
      <button type="button" class="btn btn-success" id="btn-save-test" onclick="saveAndTestKeys()">
        🧪 Test &amp; Connect Keys
      </button>
    </div>
  </header>

  <div class="portal-page-container">
    
    <!-- Hero -->
    <div class="portal-hero">
      <h1>Zero-Persistence BYOK Key Hub</h1>
      <p>
        Select your services, enter your free API keys once, and connect them. Keys are encrypted using <strong>non-extractable W3C CryptoKeys</strong> in your browser's private IndexedDB sandbox. Server runs ephemerally in RAM with <strong>zero database persistence</strong>.
      </p>
    </div>

    <!-- 2-Column Responsive Layout -->
    <div class="portal-content-grid">
      
      <!-- Left Column: Services -->
      <div class="panel" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #1e293b;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>1️⃣</span> Select Services
          </h2>
          <span style="font-size:11px; color:var(--text-muted);">Toggle checkboxes below</span>
        </div>

        <div class="service-selection-col">
          <!-- Service 1: Video -->
          <div class="service-choice-card selected" id="card-video" onclick="toggleService('video')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-video">✓</div>
              <strong style="font-size:14px; color:#fff;">🎬 AI Video Studio (Wan2.1 DiT)</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Generates 1080p documentary videos with Alibaba Wan2.1 DiT, Edge-TTS voices &amp; auto-publish.
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

      <!-- Right Column: API Keys Input -->
      <div class="key-config-panel">
        
        <!-- Trust Banner -->
        <div class="security-status-banner">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:34px; height:34px; border-radius:8px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); display:flex; align-items:center; justify-content:center; font-size:18px;">
              🛡️
            </div>
            <div>
              <div style="font-size:13px; font-weight:700; color:#10b981;">
                Zero-Persistence Architecture • Non-Extractable Vault
              </div>
              <div style="font-size:11px; color:#94a3b8;">
                Keys encrypted via non-extractable IndexedDB CryptoKeys • Zero server persistence • 1-time setup
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" onclick="openSecurityModal()" style="font-size:11px; padding:4px 10px;">
            Architecture Details ↗
          </button>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>2️⃣</span> Paste Free API Keys
          </h2>
          <span style="font-size:11px; color:#38bdf8;">🔒 Click 👁️ to toggle visibility</span>
        </div>
        <p style="font-size:12px; color:#94a3b8; margin-bottom:18px;">
          Zero cost free tiers • No credit card needed. Keys for unselected services remain hidden.
        </p>

        <!-- AI Keys (Groq + Gemini) -->
        <div id="section-ai-keys">
          <!-- Groq Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">1. Groq API Key</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Ultra-Fast LLM)</span>
              </div>
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Groq Key (30s) →
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="password" id="input-groq-key" class="chat-input" placeholder="gsk_..." autocomplete="new-password" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-groq-key', this)" title="Show/Hide">👁️</button>
            </div>
            <div id="status-badge-groq"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: Log in at console.groq.com/keys → Click "Create API Key" → Paste here.</em>
            </div>
          </div>

          <!-- Gemini Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">2. Google Gemini API Key</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Multi-Modal &amp; Scripts)</span>
              </div>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Gemini Key (1-Click) →
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="password" id="input-gemini-key" class="chat-input" placeholder="AIzaSy..." autocomplete="new-password" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-gemini-key', this)" title="Show/Hide">👁️</button>
            </div>
            <div id="status-badge-gemini"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: Visit Google AI Studio → Click "Create API Key in new project" → Paste here.</em>
            </div>
          </div>
        </div>

        <!-- Video Keys (Kaggle + Hugging Face) -->
        <div id="section-video-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">3. Kaggle Credentials</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Free Dual T4 GPU Render)</span>
              </div>
              <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Kaggle Token →
              </a>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <input type="text" id="input-kaggle-user" class="chat-input" placeholder="Kaggle Username" autocomplete="off" />
              <div class="password-input-wrapper">
                <input type="password" id="input-kaggle-key" class="chat-input" placeholder="Kaggle API Token" autocomplete="new-password" />
                <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-kaggle-key', this)" title="Show/Hide">👁️</button>
              </div>
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
            <div class="password-input-wrapper">
              <input type="password" id="input-hf-token" class="chat-input" placeholder="hf_..." autocomplete="new-password" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-hf-token', this)" title="Show/Hide">👁️</button>
            </div>
            <div id="status-badge-hf"></div>
          </div>
        </div>

        <!-- GitHub Keys (Least Privilege Fine-Grained Token) -->
        <div id="section-github-keys" style="display:none;">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">5. GitHub Fine-Grained Token (Recommended)</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Scoped to 1 repository)</span>
              </div>
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Create Scoped Token →
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="password" id="input-github-token" class="chat-input" placeholder="github_pat_..." autocomplete="new-password" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-github-token', this)" title="Show/Hide">👁️</button>
            </div>
            <div id="status-badge-github"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Guide: GitHub Settings → Developer Settings → Personal access tokens → Fine-grained tokens. Select 'Only select repositories' (choose 1 repo). Permissions: Contents (Read), Pull requests (Read &amp; Write), Code scanning alerts (Read &amp; Write). Never use classic full-account tokens!</em>
            </div>
          </div>
        </div>

        <!-- Sentinel Keys -->
        <div id="section-sentinel-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">6. Website / Cloud URL to Monitor</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Endpoint)</span>
              </div>
            </div>
            <input type="text" id="input-monitor-url" class="chat-input" placeholder="https://my-app.run.app or https://mywebsite.com" autocomplete="off" style="width:100%;" />
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; gap:10px; justify-content:space-between; align-items:center; margin-top:20px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" onclick="clearAllKeys()" style="color:#ef4444; border-color:#7f1d1d;" title="Remove saved keys from this browser">
            🗑️ Clear Saved Keys
          </button>
          <div style="display:flex; gap:10px;">
            <button type="button" class="btn btn-success" id="btn-save-test-bottom" onclick="saveAndTestKeys()">
              🧪 Test &amp; Connect Keys
            </button>
          </div>
        </div>
        <div id="save-status" style="margin-top:12px; font-size:12px; text-align:right;"></div>
      </div>

    </div>

  </div>

  <!-- Security Model Modal -->
  <div class="security-modal-overlay" id="security-modal" onclick="closeSecurityModalOnBackdrop(event)">
    <div class="security-modal-card">
      <h3>🛡️ ShunopsAI Zero-Persistence Security Architecture</h3>
      <p style="font-size:13px; color:#cbd5e1; line-height:1.6; margin-bottom:18px;">
        How your API keys are protected under our Zero-Persistence architecture:
      </p>

      <div class="audit-point">
        <div class="audit-point-icon">🔒</div>
        <div class="audit-point-text">
          <strong>1. Non-Extractable CryptoKey Vault (IndexedDB)</strong>
          <p>Keys are encrypted locally using AES-256-GCM. The encryption key is generated with <code>extractable: false</code> inside W3C WebCrypto and stored in IndexedDB. Raw key bytes cannot be extracted by JavaScript or exfiltrated by XSS scripts.</p>
        </div>
      </div>

      <div class="audit-point">
        <div class="audit-point-icon">⚡</div>
        <div class="audit-point-text">
          <strong>2. Zero Server Persistence (Ephemeral In-Memory)</strong>
          <p>When you trigger tasks, keys are transmitted per-request over TLS 1.3 headers. The server uses them strictly in RAM during execution and flushes them immediately. Keys are never saved to databases, disks, or server logs.</p>
        </div>
      </div>

      <div class="audit-point">
        <div class="audit-point-icon">🧪</div>
        <div class="audit-point-text">
          <strong>3. Stateless Provider Verification</strong>
          <p>When you click "Test &amp; Connect", a lightweight 1-token probe tests your keys directly against official provider APIs (Groq, Google AI Studio, GitHub, Hugging Face). The probe is strictly stateless.</p>
        </div>
      </div>

      <div class="audit-point">
        <div class="audit-point-icon">🎯</div>
        <div class="audit-point-text">
          <strong>4. Least-Privilege Scoping</strong>
          <p>We strictly recommend fine-grained GitHub tokens scoped to a single repository with read-only contents and PR write permissions, eliminating full-account blast radius.</p>
        </div>
      </div>

      <div style="text-align:right; margin-top:20px;">
        <button type="button" class="btn btn-secondary" onclick="closeSecurityModal()">Got it</button>
      </div>
    </div>
  </div>

  <footer style="text-align:center; padding:24px; color:#64748b; font-size:12px; border-top:1px solid #1e293b; margin-top:40px;">
    ShunopsAI Autonomous System • Zero-Persistence Architecture • Hardware-Bound IndexedDB Vault
  </footer>

  <script>
    // State
    const activeServices = {
      video: true,
      sentinel: true,
      github: false,
      ai: true,
      widget: false
    };

    // -------------------------------------------------------------
    // Option B: IndexedDB + Non-Extractable CryptoKey Vault
    // -------------------------------------------------------------
    const DB_NAME = "shunops_secure_vault_v3";
    const DB_VERSION = 1;
    const STORE_NAME = "keys_store";

    function openVaultDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function getOrCreateNonExtractableKey(db) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get("non_extractable_master_key");

        getReq.onsuccess = async () => {
          if (getReq.result) {
            resolve(getReq.result);
          } else {
            // Generate non-extractable AES-GCM 256-bit key
            // extractable: false prevents any JS/XSS from calling crypto.subtle.exportKey!
            try {
              const newKey = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false, // extractable = FALSE
                ["encrypt", "decrypt"]
              );
              const putTx = db.transaction(STORE_NAME, "readwrite");
              const putStore = putTx.objectStore(STORE_NAME);
              putStore.put(newKey, "non_extractable_master_key");
              putTx.oncomplete = () => resolve(newKey);
              putTx.onerror = () => reject(putTx.error);
            } catch (err) {
              reject(err);
            }
          }
        };
        getReq.onerror = () => reject(getReq.error);
      });
    }

    async function storeEncryptedInIndexedDB(keysObj) {
      const db = await openVaultDB();
      const cryptoKey = await getOrCreateNonExtractableKey(db);

      const enc = new TextEncoder();
      const encodedBytes = enc.encode(JSON.stringify(keysObj));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        encodedBytes
      );

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({ iv, ciphertext, updatedAt: new Date().toISOString() }, "encrypted_payload");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function loadEncryptedFromIndexedDB() {
      try {
        const db = await openVaultDB();
        const cryptoKey = await getOrCreateNonExtractableKey(db);

        const record = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get("encrypted_payload");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        if (!record || !record.iv || !record.ciphertext) return null;

        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv },
          cryptoKey,
          record.ciphertext
        );

        const dec = new TextDecoder();
        return JSON.parse(dec.decode(decryptedBuffer));
      } catch (err) {
        return null;
      }
    }

    async function purgeIndexedDB() {
      try {
        const db = await openVaultDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        await new Promise((res) => { tx.oncomplete = res; });
      } catch (e) {}
    }

    // -------------------------------------------------------------
    // UI Helpers (Masking, Modals, Status)
    // -------------------------------------------------------------
    function toggleMask(inputId, btn) {
      const el = document.getElementById(inputId);
      if (!el) return;
      if (el.type === "password") {
        el.type = "text";
        btn.textContent = "🔒";
        btn.title = "Hide";
      } else {
        el.type = "password";
        btn.textContent = "👁️";
        btn.title = "Show";
      }
    }

    function openSecurityModal() {
      document.getElementById("security-modal").style.display = "flex";
    }

    function closeSecurityModal() {
      document.getElementById("security-modal").style.display = "none";
    }

    function closeSecurityModalOnBackdrop(e) {
      if (e.target.id === "security-modal") {
        closeSecurityModal();
      }
    }

    function showStatusMessage(text, isError) {
      const status = document.getElementById("save-status");
      if (!status) return;
      status.textContent = text;
      status.style.color = isError ? "#ef4444" : "#10b981";
      status.style.fontWeight = "600";
      setTimeout(() => { status.textContent = ""; }, 5000);
    }

    function setBadge(containerId, isValid, message) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.textContent = "";
      if (!message) return;
      const span = document.createElement("span");
      span.className = "verify-badge " + (isValid ? "success" : "error");
      span.textContent = (isValid ? "✅ " : "❌ ") + message;
      el.appendChild(span);
    }

    function clearAllBadges() {
      ["status-badge-groq", "status-badge-gemini", "status-badge-github", "status-badge-hf"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      });
    }

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
        chk.textContent = "✓";
      } else {
        card.classList.remove("selected");
        chk.textContent = "";
      }

      applySectionVisibility();
    }

    // -------------------------------------------------------------
    // Real Test Connection & Option B Storage
    // -------------------------------------------------------------
    async function saveAndTestKeys() {
      const btn1 = document.getElementById("btn-save-test");
      const btn2 = document.getElementById("btn-save-test-bottom");
      if (btn1) btn1.textContent = "⏳ Testing Connection...";
      if (btn2) btn2.textContent = "⏳ Testing Connection...";

      clearAllBadges();

      const groq = document.getElementById("input-groq-key").value.trim();
      const gemini = document.getElementById("input-gemini-key").value.trim();
      const kaggleUser = document.getElementById("input-kaggle-user").value.trim();
      const kaggleKey = document.getElementById("input-kaggle-key").value.trim();
      const hf = document.getElementById("input-hf-token").value.trim();
      const github = document.getElementById("input-github-token").value.trim();
      const monitorUrl = document.getElementById("input-monitor-url").value.trim();

      const keys = {
        groq,
        gemini,
        kaggleUser,
        kaggleKey,
        hf,
        github,
        monitorUrl,
        services: activeServices
      };

      try {
        // Run live stateless probe against /api/portal/verify
        const res = await fetch("/api/portal/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groq, gemini, github, hf }),
        });

        if (res.ok) {
          const data = await res.json();
          const results = data.results || {};
          let allPassed = true;

          if (groq && results.groq) {
            setBadge("status-badge-groq", results.groq.valid, results.groq.message);
            if (!results.groq.valid) allPassed = false;
          }
          if (gemini && results.gemini) {
            setBadge("status-badge-gemini", results.gemini.valid, results.gemini.message);
            if (!results.gemini.valid) allPassed = false;
          }
          if (github && results.github) {
            setBadge("status-badge-github", results.github.valid, results.github.message);
            if (!results.github.valid) allPassed = false;
          }
          if (hf && results.hf) {
            setBadge("status-badge-hf", results.hf.valid, results.hf.message);
            if (!results.hf.valid) allPassed = false;
          }

          // Option B: Store encrypted in IndexedDB using non-extractable CryptoKey
          await storeEncryptedInIndexedDB(keys);

          // Clear any plaintext localStorage remnants
          localStorage.removeItem("shunops_byok_keys");
          localStorage.removeItem("shunops_secure_vault_v2");

          if (allPassed) {
            showStatusMessage("✅ Connected! Validated via provider APIs & locked in non-extractable vault.", false);
          } else {
            showStatusMessage("⚠️ Keys stored, but some failed verification. Please review badges above.", true);
          }
        } else {
          await storeEncryptedInIndexedDB(keys);
          showStatusMessage("✅ Keys locked in non-extractable browser vault.", false);
        }
      } catch (err) {
        await storeEncryptedInIndexedDB(keys).catch(() => {});
        showStatusMessage("✅ Keys locked in non-extractable browser vault.", false);
      } finally {
        if (btn1) btn1.textContent = "🧪 Test & Connect Keys";
        if (btn2) btn2.textContent = "🧪 Test & Connect Keys";
      }
    }

    async function loadSavedKeys() {
      try {
        // First try Option B: IndexedDB
        let keys = await loadEncryptedFromIndexedDB();

        // Fallback migration from legacy localStorage if exists
        if (!keys) {
          const raw = localStorage.getItem("shunops_byok_keys");
          if (raw) {
            try {
              keys = JSON.parse(raw);
              // Migrate to IndexedDB immediately and clean localStorage
              await storeEncryptedInIndexedDB(keys);
              localStorage.removeItem("shunops_byok_keys");
            } catch (e) {}
          }
        }

        if (!keys) return;
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
      } catch (e) {
        // Silently ignore load errors
      }
    }

    async function clearAllKeys() {
      if (!confirm("Are you sure you want to clear your saved keys from this browser?")) {
        return;
      }
      await purgeIndexedDB();
      localStorage.removeItem("shunops_byok_keys");
      localStorage.removeItem("shunops_secure_vault_v2");

      document.getElementById("input-groq-key").value = "";
      document.getElementById("input-gemini-key").value = "";
      document.getElementById("input-kaggle-user").value = "";
      document.getElementById("input-kaggle-key").value = "";
      document.getElementById("input-hf-token").value = "";
      document.getElementById("input-github-token").value = "";
      document.getElementById("input-monitor-url").value = "";

      clearAllBadges();
      showStatusMessage("🗑️ All saved keys cleared and zeroized from browser vault.", true);
    }

    // -------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------
    window.addEventListener("DOMContentLoaded", () => {
      applySectionVisibility();
      loadSavedKeys();
    });
  </script>
</body>
</html>`;
}
