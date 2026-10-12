import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Renders the User-Friendly Assistant & Integrations Settings Portal.
 * Simplified for normal users with zero technical knowledge.
 * Deep cryptographic and architectural specifications are located in /privacy, /terms, and /about.
 */
export function getShunopsPortalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Assistant &amp; Integrations Settings • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    ${DASHBOARD_STYLES}

    .portal-page-container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 20px 20px 50px;
      width: 100%;
    }

    .portal-hero {
      text-align: center;
      padding: 16px 16px 28px;
      max-width: 820px;
      margin: 0 auto;
    }
    .portal-hero h1 {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(90deg, #fff, #38bdf8, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    .portal-hero p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.6;
    }

    /* 2-column responsive layout */
    .portal-content-grid {
      display: grid;
      grid-template-columns: 420px 1fr;
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
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.12);
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
      padding: 24px;
    }

    .security-status-banner {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(14, 165, 233, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 20px;
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
      padding: 4px 10px;
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
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .eye-toggle-btn:hover {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
    }
    .eye-toggle-btn svg {
      width: 17px;
      height: 17px;
      pointer-events: none;
    }

    .verify-badge {
      font-size: 11px;
      padding: 3px 8px;
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
      max-width: 600px;
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
      <a href="/workspace" style="text-decoration:none; display:flex; align-items:center; gap:12px; color:inherit;">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-title">SHUNOPSAI</div>
          <div class="brand-subtitle">Assistant &amp; Tools Settings</div>
        </div>
      </a>
    </div>
    <div class="header-pills">
      <button type="button" class="btn btn-secondary" onclick="openSecurityModal()" style="font-size:12px; padding:6px 14px;">
        🛡️ How Privacy Works
      </button>
      <a href="/workspace" class="btn btn-secondary" style="text-decoration:none; font-size:12px; padding:6px 14px;">
        &larr; Workspace
      </a>
      <button type="button" class="btn btn-success" id="btn-save-test" onclick="saveAndTestKeys()">
        💾 Save &amp; Connect
      </button>
    </div>
  </header>

  <div class="portal-page-container">
    
    <!-- Hero -->
    <div class="portal-hero">
      <h1>Customize Your AI Assistant &amp; Tools</h1>
      <p>
        Select what you'd like your assistant to help with. You can use our <strong>free built-in AI</strong> with zero setup, or optionally connect your own free Google Gemini or Groq keys for unlimited chats.
      </p>
    </div>

    <!-- 2-Column Responsive Layout -->
    <div class="portal-content-grid">
      
      <!-- Left Column: Services -->
      <div class="panel" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #1e293b;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>1️⃣</span> Choose Your Tools
          </h2>
          <span style="font-size:11px; color:var(--text-muted);">Click to turn on or off</span>
        </div>

        <div class="service-selection-col">
          <!-- Service 1: Video -->
          <div class="service-choice-card selected" id="card-video" onclick="toggleService('video')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-video">✓</div>
              <strong style="font-size:14px; color:#fff;">🎬 Video Maker</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Creates narrated short documentary videos and presentations with voiceovers.
            </p>
          </div>

          <!-- Service 2: Sentinel -->
          <div class="service-choice-card selected" id="card-sentinel" onclick="toggleService('sentinel')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-sentinel">✓</div>
              <strong style="font-size:14px; color:#fff;">🛡️ 24/7 Website Monitor</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Checks your website health around the clock and alerts you if it ever goes down.
            </p>
          </div>

          <!-- Service 3: Security & GitHub -->
          <div class="service-choice-card" id="card-github" onclick="toggleService('github')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-github"></div>
              <strong style="font-size:14px; color:#fff;">🔍 Code &amp; Project Helper</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Reviews your code changes, spots bugs, and suggests quick fixes.
            </p>
          </div>

          <!-- Service 4: Web Widget -->
          <div class="service-choice-card selected" id="card-widget" onclick="toggleService('widget')">
            <div class="service-choice-header">
              <div class="custom-checkbox" id="chk-widget">✓</div>
              <strong style="font-size:14px; color:#fff;">🤖 Website Customer Chatbot</strong>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.4; margin-left:30px;">
              Add a friendly chat assistant to your website for 24/7 visitor questions.
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
              🔒
            </div>
            <div>
              <div style="font-size:13px; font-weight:700; color:#10b981;">
                Private &amp; Secure Storage
              </div>
              <div style="font-size:11px; color:#94a3b8;">
                Your keys stay encrypted in your own browser. Never stored in our database.
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" onclick="openSecurityModal()" style="font-size:11px; padding:4px 10px;">
            Learn More &rarr;
          </button>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="font-size:16px; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
            <span>2️⃣</span> Choose AI Mode
          </h2>
        </div>

        <!-- AI Engine Mode Selector -->
        <div style="background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:14px; margin-bottom:18px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div id="mode-shared" onclick="setAiMode('shared')" style="cursor:pointer; padding:12px; border-radius:8px; border:2px solid #1e293b; background:#0b1120; transition:all 0.2s;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <input type="radio" name="ai-mode" id="radio-shared" style="accent-color:#00f0ff;" checked />
                <strong style="font-size:13px; color:#fff;">✨ Free Built-in AI</strong>
              </div>
              <p style="font-size:11px; color:#94a3b8; margin:0; line-height:1.4;">
                Ready immediately. Uses our shared AI with zero setup.
              </p>
            </div>
            <div id="mode-byok" onclick="setAiMode('byok')" style="cursor:pointer; padding:12px; border-radius:8px; border:2px solid #1e293b; background:#0b1120; transition:all 0.2s;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <input type="radio" name="ai-mode" id="radio-byok" style="accent-color:#00f0ff;" />
                <strong style="font-size:13px; color:#fff;">🔑 Use My Own Free Keys</strong>
              </div>
              <p style="font-size:11px; color:#94a3b8; margin:0; line-height:1.4;">
                Add your free Google or Groq key for unlimited fast chats.
              </p>
            </div>
          </div>
        </div>

        <!-- AI Keys (Groq + Gemini) - Shown only when BYOK Mode is selected -->
        <div id="section-ai-keys" style="display:none;">
          <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
            <span>🔑</span> Add Your Free AI Keys (Fast &amp; Unlimited)
          </div>
          <!-- Groq Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">1. Groq API Key (Optional)</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Ultra-fast responses)</span>
              </div>
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Key (1 min) &rarr;
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="text" id="input-groq-key" class="chat-input" placeholder="gsk_..." autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-groq-key', this)" aria-label="Toggle key visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div id="status-badge-groq"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Easy step: Click the link &rarr; Log in &rarr; Click "Create API Key" &rarr; Paste it here.</em>
            </div>
          </div>

          <!-- Gemini Key -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">2. Google Gemini API Key (Optional)</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Google's AI model)</span>
              </div>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Gemini Key &rarr;
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="text" id="input-gemini-key" class="chat-input" placeholder="AIzaSy..." autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-gemini-key', this)" aria-label="Toggle key visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div id="status-badge-gemini"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Easy step: Click the link &rarr; Log in with Google &rarr; Click "Create API key" &rarr; Paste here.</em>
            </div>
          </div>
        </div>

        <!-- Video Keys (Kaggle + Hugging Face) -->
        <div id="section-video-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">3. Kaggle Account (For Video Rendering)</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Free)</span>
              </div>
              <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Kaggle Token &rarr;
              </a>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <input type="text" id="input-kaggle-user" class="chat-input" placeholder="Your Kaggle Username" autocomplete="off" />
              <div class="password-input-wrapper">
                <input type="text" id="input-kaggle-key" class="chat-input" placeholder="Kaggle API Token" autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
                <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-kaggle-key', this)" aria-label="Toggle key visibility" title="Show/Hide">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Hugging Face Token -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">4. Hugging Face Token</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Free)</span>
              </div>
              <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Get Free Token &rarr;
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="text" id="input-hf-token" class="chat-input" placeholder="hf_..." autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-hf-token', this)" aria-label="Toggle key visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div id="status-badge-hf"></div>
          </div>
        </div>

        <!-- GitHub Keys -->
        <div id="section-github-keys" style="display:none;">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">5. GitHub Token (Optional)</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(For checking your repositories)</span>
              </div>
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Create GitHub Token &rarr;
              </a>
            </div>
            <div class="password-input-wrapper">
              <input type="text" id="input-github-token" class="chat-input" placeholder="github_pat_..." autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-github-token', this)" aria-label="Toggle key visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div id="status-badge-github"></div>
          </div>
        </div>

        <!-- Sentinel Keys -->
        <div id="section-sentinel-keys">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">6. Your Website URL to Monitor</strong>
                <span style="font-size:11px; color:#64748b; margin-left:6px;">(Link)</span>
              </div>
            </div>
            <input type="text" id="input-monitor-url" class="chat-input" placeholder="https://mywebsite.com" autocomplete="off" style="width:100%;" />
          </div>
        </div>

        <!-- Website Chat Widget Integration Snippet -->
        <div id="section-widget-keys" style="margin-bottom:18px;">
          <div style="background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <strong style="color:#fff; font-size:13px; display:flex; align-items:center; gap:6px;">
                <span>🤖</span> Embed Chat Widget on Your Website
              </strong>
              <span style="font-size:11px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:2px 8px; border-radius:12px; font-weight:600;">
                Edge CDN Live
              </span>
            </div>
            <p style="font-size:12px; color:#94a3b8; line-height:1.5; margin-bottom:12px;">
              Copy this 1 line of HTML code and paste it right before the closing <code>&lt;/body&gt;</code> tag on any website to enable the 24/7 AI chat widget:
            </p>
            <div style="position:relative; background:#020617; border:1px solid #1e293b; border-radius:8px; padding:12px; font-family:'JetBrains Mono', monospace; font-size:12px; color:#38bdf8; overflow-x:auto;">
              <code id="portal-widget-snippet">&lt;script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" defer&gt;&lt;/script&gt;</code>
              <button type="button" onclick="copyWidgetSnippet(this)" style="position:absolute; top:8px; right:8px; background:#1e293b; hover:#334155; border:1px solid #38bdf8; color:#fff; font-size:11px; padding:4px 10px; border-radius:6px; cursor:pointer; font-weight:600; transition:all 0.15s;">
                📋 Copy Code
              </button>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; gap:10px; justify-content:space-between; align-items:center; margin-top:20px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" onclick="clearAllKeys()" style="color:#ef4444; border-color:#7f1d1d;" title="Remove saved keys from this browser">
            🗑️ Clear My Saved Keys
          </button>
          <div style="display:flex; gap:10px;">
            <button type="button" class="btn btn-success" id="btn-save-test-bottom" onclick="saveAndTestKeys()">
              💾 Save &amp; Connect
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
      <h3>🛡️ How Your Data is Protected</h3>
      <p style="font-size:13px; color:#cbd5e1; line-height:1.6; margin-bottom:18px;">
        ShunopsAI is designed from the ground up to protect your privacy:
      </p>

      <div class="audit-point">
        <div class="audit-point-icon">🔒</div>
        <div class="audit-point-text">
          <strong>1. Keys Stay in Your Browser</strong>
          <p>When you enter an API key, it is encrypted locally on your computer. We never store your keys in our database.</p>
        </div>
      </div>

      <div class="audit-point">
        <div class="audit-point-icon">⚡</div>
        <div class="audit-point-text">
          <strong>2. Used Only While You Chat</strong>
          <p>Keys are sent securely when you ask a question and are discarded immediately after the response is delivered.</p>
        </div>
      </div>

      <div class="audit-point">
        <div class="audit-point-icon">🗑️</div>
        <div class="audit-point-text">
          <strong>3. Full Control Anytime</strong>
          <p>You can remove or change your keys with one click using the "Clear My Saved Keys" button at any time.</p>
        </div>
      </div>

      <div style="text-align:right; margin-top:20px; display:flex; justify-content:space-between; align-items:center;">
        <a href="/privacy" style="font-size:12px; color:#38bdf8; text-decoration:none;">View Full Privacy Policy &rarr;</a>
        <button type="button" class="btn btn-secondary" onclick="closeSecurityModal()">Got it</button>
      </div>
    </div>
  </div>

  <footer style="text-align:center; padding:24px; color:#64748b; font-size:12px; border-top:1px solid #1e293b; margin-top:40px;">
    <div style="display:flex; justify-content:center; gap:20px; margin-bottom:8px;">
      <a href="/workspace" style="color:#94a3b8; text-decoration:none;">Workspace</a>
      <a href="/privacy" style="color:#94a3b8; text-decoration:none;">Privacy Policy</a>
      <a href="/terms" style="color:#94a3b8; text-decoration:none;">Terms of Service</a>
      <a href="/about" style="color:#94a3b8; text-decoration:none;">About &amp; Technical Details</a>
    </div>
    &copy; 2026 ShunopsAI. Clean, simple, and private by design.
  </footer>

  <script>
    // State
    let aiMode = "shared"; // "shared" | "byok"
    const activeServices = {
      video: true,
      sentinel: true,
      github: false,
      widget: true
    };

    function setAiMode(mode) {
      aiMode = mode;
      const radioShared = document.getElementById("radio-shared");
      const radioByok = document.getElementById("radio-byok");
      const modeShared = document.getElementById("mode-shared");
      const modeByok = document.getElementById("mode-byok");

      if (mode === "byok") {
        if (radioByok) radioByok.checked = true;
        if (radioShared) radioShared.checked = false;
        if (modeByok) {
          modeByok.style.borderColor = "#00f0ff";
          modeByok.style.boxShadow = "0 0 12px rgba(0, 240, 255, 0.2)";
        }
        if (modeShared) {
          modeShared.style.borderColor = "#1e293b";
          modeShared.style.boxShadow = "none";
        }
      } else {
        if (radioShared) radioShared.checked = true;
        if (radioByok) radioByok.checked = false;
        if (modeShared) {
          modeShared.style.borderColor = "#00f0ff";
          modeShared.style.boxShadow = "0 0 12px rgba(0, 240, 255, 0.2)";
        }
        if (modeByok) {
          modeByok.style.borderColor = "#1e293b";
          modeByok.style.boxShadow = "none";
        }
      }
      applySectionVisibility();
    }

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
            try {
              const newKey = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
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

    const SVG_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const SVG_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    function toggleMask(inputId, btn) {
      const el = document.getElementById(inputId);
      if (!el) return;
      if (el.type === "password") {
        el.type = "text";
        btn.innerHTML = SVG_EYE_OPEN;
        btn.title = "Hide";
      } else {
        el.type = "password";
        btn.innerHTML = SVG_EYE_OFF;
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

    
    function copyWidgetSnippet(btn) {
      const code = '<' + 'script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" defer><' + '/script>';
      navigator.clipboard.writeText(code).then(() => {
        const orig = btn.textContent;
        btn.textContent = "✅ Copied!";
        btn.style.borderColor = "#10b981";
        btn.style.color = "#10b981";
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.borderColor = "#38bdf8";
          btn.style.color = "#fff";
        }, 2000);
      }).catch(() => {
        prompt("Copy this embed code:", code);
      });
    }

    function applySectionVisibility() {
      document.getElementById("section-ai-keys").style.display =
        (aiMode === "byok") ? "block" : "none";
      document.getElementById("section-video-keys").style.display =
        activeServices.video ? "block" : "none";
      document.getElementById("section-github-keys").style.display =
        activeServices.github ? "block" : "none";
      document.getElementById("section-sentinel-keys").style.display =
        activeServices.sentinel ? "block" : "none";
      const widgetSection = document.getElementById("section-widget-keys");
      if (widgetSection) widgetSection.style.display = activeServices.widget ? "block" : "none";
    }

    function toggleService(key) {
      if (!(key in activeServices)) return;
      activeServices[key] = !activeServices[key];
      const card = document.getElementById("card-" + key);
      const chk = document.getElementById("chk-" + key);
      
      if (card && chk) {
        if (activeServices[key]) {
          card.classList.add("selected");
          chk.textContent = "✓";
        } else {
          card.classList.remove("selected");
          chk.textContent = "";
        }
      }

      applySectionVisibility();
    }

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
        aiMode,
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

          await storeEncryptedInIndexedDB(keys);
          localStorage.removeItem("shunops_byok_keys");
          localStorage.removeItem("shunops_secure_vault_v2");

          if (allPassed) {
            showStatusMessage("✅ Connected! All keys verified and saved privately.", false);
          } else {
            showStatusMessage("⚠️ Saved, but please check the badges above.", true);
          }
        } else {
          await storeEncryptedInIndexedDB(keys);
          showStatusMessage("✅ Saved privately in your browser.", false);
        }
      } catch (err) {
        await storeEncryptedInIndexedDB(keys).catch(() => {});
        showStatusMessage("✅ Saved privately in your browser.", false);
      } finally {
        if (btn1) btn1.textContent = "💾 Save & Connect";
        if (btn2) btn2.textContent = "💾 Save & Connect";
      }
    }

    async function loadSavedKeys() {
      try {
        let keys = await loadEncryptedFromIndexedDB();
        if (!keys) {
          const raw = localStorage.getItem("shunops_byok_keys");
          if (raw) {
            try {
              keys = JSON.parse(raw);
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
            if (s in activeServices && activeServices[s] !== keys.services[s]) {
              toggleService(s);
            }
          }
        }

        if (keys.aiMode) {
          setAiMode(keys.aiMode);
        } else if (keys.groq || keys.gemini) {
          setAiMode("byok");
        } else {
          setAiMode("shared");
        }
      } catch (e) {
        // Silently ignore load errors
      }
    }

    async function clearAllKeys() {
      if (!confirm("Are you sure you want to remove your saved keys from this browser?")) {
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
      showStatusMessage("🗑️ All saved keys cleared from your browser.", true);
    }

    window.addEventListener("DOMContentLoaded", () => {
      applySectionVisibility();
      loadSavedKeys();
    });
  </script>
</body>
</html>`;
}
