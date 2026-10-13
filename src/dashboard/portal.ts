import { PORTAL_STYLES } from "./portal-styles.js";
import { PORTAL_SCRIPTS } from "./portal-scripts.js";

/**
 * Renders the User-Friendly Assistant & Integrations Settings Portal.
 * Simplified for normal users with zero technical knowledge.
 * Deep cryptographic and architectural specifications are located in /privacy, /terms, and /about.
 *
 * The stylesheet and client script live in `portal-styles.ts` / `portal-scripts.ts`
 * so the markup here stays reviewable in isolation.
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
${PORTAL_STYLES}
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

          <!-- Google Cloud Text-to-Speech (Optional) -->
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">5. Google Cloud Text-to-Speech (Optional)</strong>
                <span style="font-size:11px; color:#10b981; margin-left:6px; font-weight:600;">(Studio Voices • Always Free)</span>
              </div>
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" class="direct-link-badge">
                🔗 Google Cloud Console &rarr;
              </a>
            </div>

            <!-- Benefits Box in Simple, Short Language -->
            <div style="background:rgba(56,189,248,0.06); border:1px solid rgba(56,189,248,0.2); border-radius:8px; padding:10px 12px; margin-bottom:10px; font-size:11px; color:#94a3b8; line-height:1.5;">
              <div style="color:#38bdf8; font-weight:700; margin-bottom:4px; font-size:12px;">
                ✨ Why Add This? (Benefits)
              </div>
              <ul style="margin:0; padding-left:16px; color:#cbd5e1;">
                <li><strong>Studio-Grade Voice:</strong> Unlocks DeepMind Neural2 (hi-IN-Neural2-B), an authentic documentary baritone with natural human breathing.</li>
                <li><strong>100% Always Free:</strong> Google gives 1,000,000 characters every month for free ($0.00).</li>
                <li><strong>Zero Risk if Skipped:</strong> If left empty, Video Maker automatically uses free Microsoft Edge-TTS without needing any Google Cloud account!</li>
              </ul>
            </div>

            <div class="password-input-wrapper">
              <input type="text" id="input-gcp-key" class="chat-input" placeholder='Paste GCP Service Account JSON or API Key (Optional)' autocomplete="off" data-lpignore="true" data-1p-ignore="true" />
              <button type="button" class="eye-toggle-btn" onclick="toggleMask('input-gcp-key', this)" aria-label="Toggle key visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div id="status-badge-gcp"></div>
            <div style="font-size:11px; color:#64748b; margin-top:6px;">
              📌 <em>Easy step: Paste your Google Service Account JSON or API Key. If left empty, standard free Edge-TTS is used automatically.</em>
            </div>
          </div>
        </div>

        <!-- GitHub Keys -->
        <div id="section-github-keys" style="display:none;">
          <div class="key-input-group">
            <div class="key-label-row">
              <div>
                <strong style="color:#fff; font-size:13px;">6. GitHub Token (Optional)</strong>
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
                <strong style="color:#fff; font-size:13px;">7. Your Website URL to Monitor</strong>
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
            <div class="code-snippet-box">
              <div class="code-snippet-header">
                <div class="code-snippet-lang">
                  <span class="code-dot"></span>
                  <span>HTML</span>
                </div>
                <button type="button" class="copy-code-btn" onclick="copyWidgetSnippet(this)">
                  <svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="btn-label">Copy code</span>
                </button>
              </div>
              <pre class="code-snippet-content"><code id="portal-widget-snippet">&lt;script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" data-api-url="https://edge-agent-widget.shunopsai.workers.dev" defer&gt;&lt;/script&gt;</code></pre>
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
${PORTAL_SCRIPTS}
  </script>
</body>
</html>`;
}
