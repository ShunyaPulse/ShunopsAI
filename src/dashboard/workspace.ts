import { escapeHtml } from "./scripts.js";
import { WORKSPACE_STYLES } from "./workspace-styles.js";
import { workspaceScripts } from "./workspace-scripts.js";

/**
 * Multi-Tenant User Workspace Dashboard HTML.
 * Includes:
 * 1. Human-in-the-Loop Approvals Queue
 * 2. Persistent Conversation Thread & History
 * 3. Account Lifecycle (Password Change, Export Data, Delete Account)
 * 4. Personal API Key Management
 * 5. Plan & Usage Metering
 *
 * The stylesheet and client script live in `workspace-styles.ts` /
 * `workspace-scripts.ts` so the markup here stays reviewable in isolation.
 */
export function getUserWorkspaceHtml(username: string): string {
  const safeUsername = escapeHtml(username);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Workspace • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
${WORKSPACE_STYLES}
  </style>
</head>
<body>
  <header>
    <a href="/workspace" class="brand">
      <div class="brand-logo">⚡</div>
      <div class="brand-text">ShunopsAI Workspace</div>
    </a>
    <div class="user-pill">
      <div class="username-badge">👤 <span id="display-username">${safeUsername}</span></div>
      <button class="logout-btn" onclick="logout()">Sign Out</button>
    </div>
  </header>

  <div class="container">
    <div class="welcome-card">
      <div>
        <h1 class="welcome-title">Welcome, ${safeUsername}!</h1>
        <p class="welcome-desc">Your private multi-tenant workspace with persistent conversation history, task isolation, and approval controls.</p>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn-sub" onclick="toggleAccountModal()">⚙️ Account Settings</button>
        <a href="/portal" class="btn-action">🔑 BYOK Keys &rarr;</a>
      </div>
    </div>

    <!-- Approvals Queue Alert Bar (Shown when sensitive actions await human confirmation) -->
    <div id="workspace-approvals-box" style="display:none; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.4); border-radius:14px; padding:18px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">⚠️</span>
          <strong style="color:#f87171; font-size:15px;">Human Approval Required for Sensitive Autonomous Step</strong>
        </div>
        <button class="btn-sub" onclick="fetchWorkspaceApprovals()">🔄 Refresh</button>
      </div>
      <div id="workspace-approvals-list"></div>
    </div>

    <div class="grid">
      <!-- Left: Chat Assistant with Persistent Conversation History (Primary Daily Workspace) -->
      <div class="box box-hero">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <h2>💬 Ask Your AI Assistant</h2>
          <div style="display:flex; align-items:center; gap:8px;">
            <span id="context-badge" style="font-size:11px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              🧠 Persistent Memory Active
            </span>
            <button type="button" onclick="clearConversation()" style="background:transparent; border:1px solid rgba(255,255,255,0.12); color:#94a3b8; font-size:11px; padding:3px 9px; border-radius:8px; cursor:pointer; transition:all 0.15s;" title="Wipe chat history from database and start fresh">
              🧹 Clear History
            </button>
          </div>
        </div>
        <p>Your conversation history is securely saved in your database account and restored across reloads.</p>

        <!-- Model Selection Dropdown & Live Circuit Breaker Status -->
        <div style="display:flex; justify-content:space-between; align-items:center; background:#070a12; border:1px solid #1e293b; border-radius:10px; padding:8px 12px; margin:10px 0 10px; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <label for="chat-model-select" style="font-size:12px; font-weight:600; color:#94a3b8; cursor:pointer;">🎯 Model Backbone:</label>
            <select id="chat-model-select" onchange="onModelPreferenceChange()" style="background:#0f172a; color:#fff; border:1px solid #334155; border-radius:6px; padding:5px 10px; font-size:12px; font-weight:500; outline:none; cursor:pointer; transition:border 0.2s; max-width:100%;">
              <optgroup label="─── Smart Modes (Auto-Failover by Need) ───">
                <option value="auto">⚡ Auto: Smart Adaptive (Auto-Routes & Self-Heals)</option>
                <option value="gemini-flash">🚀 Fast & Responsive (Quick Q&A • Low Quota 🟢)</option>
                <option value="groq-120b">🧠 Deep Reasoning & Math (120B AST • Heavy Quota ⚠️)</option>
                <option value="code-dev">💻 Code Architect & Debugging (GPT-4o & AST • Balanced)</option>
                <option value="research-context">📚 Long Context & Research (1M Window • Balanced)</option>
                <option value="openrouter-heavy">👑 Frontier Flagship (550B & GPT-4o • Heavy Quota ⚠️)</option>
              </optgroup>
              <optgroup label="─── Google Gemini (Active Pool) ───">
                <option value="gemini:gemini-3.8-flash">Gemini 3.8 Flash (Active 1/5 • Economical 🟢)</option>
                <option value="gemini:gemini-3-flash-preview">Gemini 3 Flash Preview (Economical 🟢)</option>
              </optgroup>
              <optgroup label="─── Groq Ultra-Fast LPUs ───">
                <option value="groq:openai/gpt-oss-120b">Groq GPT-OSS 120B (High Reasoning • Heavy ⚠️)</option>
                <option value="groq:qwen/qwen3.8-27b">Groq Qwen 3.8 27B (Fast Tool Calling 🟢)</option>
              </optgroup>
              <optgroup label="─── GitHub Models (OpenAI Frontier via PAT) ───">
                <option value="github:gpt-4o">OpenAI GPT-4o (Frontier Omni • Heavy ⚠️)</option>
                <option value="github:gpt-4o-mini">OpenAI GPT-4o Mini (Fast Q&A 🟢)</option>
                <option value="github:o1-mini">OpenAI o1-mini Reasoning (High Quota ⚠️)</option>
                <option value="github:meta-llama-3.3-70b-instruct">Meta Llama 3.3 70B (GitHub)</option>
              </optgroup>
              <optgroup label="─── Cloudflare Workers AI (Serverless Edge) ───">
                <option value="cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B Fast (Edge)</option>
                <option value="cloudflare:@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B (Edge Low Quota 🟢)</option>
                <option value="cloudflare:@cf/qwen/qwen1.5-7b-chat-awq">Qwen 1.5 7B Chat (Edge)</option>
              </optgroup>
              <optgroup label="─── Open Models (OpenRouter Pool) ───">
                <option value="openrouter:nvidia/nemotron-3-ultra-550b-a55b:free">Nemotron 3 Ultra 550B (Giant • Heavy ⚠️)</option>
                <option value="openrouter:nvidia/nemotron-3.5-lightning:free">Nemotron 3.5 Lightning (1M Context)</option>
                <option value="openrouter:meta-llama/llama-3.3-70b-instruct:free">Meta Llama 3.3 70B Instruct</option>
                <option value="openrouter:google/gemma-4-31b-it:free">Google Gemma 4 31B IT</option>
                <option value="openrouter:cohere/north-mini-code:free">Cohere North Mini Code</option>
                <option value="openrouter:nvidia/nemotron-3-super-120b-a12b:free">Nemotron 3 Super 120B</option>
                <option value="openrouter:qwen/qwen3.8-27b:free">Qwen 3.8 27B (OpenRouter)</option>
                <option value="openrouter:openrouter/free">OpenRouter Free Router Fallback</option>
              </optgroup>
            </select>
          </div>
          <div id="model-status-badge" style="font-size:11px; color:#10b981; display:flex; align-items:center; gap:6px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block;"></span>
            <span>All Models Healthy</span>
          </div>
        </div>

        <!-- Zero-FOMO & Quota Advisory Banner -->
        <div id="model-advisory-banner" style="background:#090d16; border:1px solid #1e293b; border-radius:10px; padding:10px 14px; margin-bottom:14px; display:flex; align-items:flex-start; gap:10px; font-size:12px;">
          <span style="font-size:15px; line-height:1; margin-top:2px;">💡</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <span style="font-weight:600; color:#38bdf8;">Smart Multi-Model Governance</span>
              <span id="quota-warning-badge" style="font-size:10px; padding:2px 7px; border-radius:10px; font-weight:600; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25);">
                🟢 Low Quota Usage (Economical)
              </span>
            </div>
            <p style="margin:4px 0 0; color:#94a3b8; font-size:11.5px; line-height:1.45;">
              Access 19 top models across Google, Groq, GitHub Models, Cloudflare & OpenRouter without FOMO. Smart Modes auto-select the best model and <strong>auto-switch to fallback models if errors or rate limits occur</strong>.
              <span style="display:block; margin-top:4px; color:#f59e0b;">
                ⚠️ <strong>Quota Notice:</strong> Heavier reasoning models (550B, 120B, o1-mini, GPT-4o) consume provider rate-limits much faster. Use <strong>Auto</strong> or <strong>Fast</strong> for everyday questions to conserve limits.
              </span>
            </p>
          </div>
        </div>

        <!-- Message Thread -->
        <div id="chat-thread" class="chat-thread-container">
          <div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">
            👋 Loading your persistent workspace conversation...
          </div>
        </div>

        <!-- Optional Context / Notes Drawer -->
        <div style="margin-bottom:10px;">
          <button type="button" onclick="toggleContextDrawer()" style="background:transparent; border:none; color:#38bdf8; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:6px; padding:2px 0;">
            <span id="context-toggle-arrow">▸</span> 📎 <span>Add Custom Context or Notes (Optional)</span>
          </button>
          <div id="custom-context-drawer" style="display:none; margin-top:8px;">
            <textarea id="custom-context-input" placeholder="Paste background notes, document snippet, code, or special instructions here to give your assistant extra context for this chat session..." style="width:100%; height:64px; background:#070a12; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12px; font-family:inherit; resize:vertical; outline:none;"></textarea>
          </div>
        </div>

        <!-- Attached Image Preview Container -->
        <div id="attached-image-container" style="display:none; align-items:center; gap:8px; padding:6px 10px; background:#0c1220; border:1px solid #1e293b; border-radius:8px; margin-bottom:8px; width:fit-content;">
          <img id="attached-image-thumb" src="" alt="Attached preview" style="max-height:48px; max-width:64px; border-radius:4px; object-fit:cover; border:1px solid #334155;">
          <div style="font-size:11px; color:#cbd5e1;">
            <div id="attached-image-name" style="font-weight:600; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">image.png</div>
            <div id="attached-image-size" style="color:#64748b; font-size:10px;"></div>
          </div>
          <button type="button" onclick="clearAttachedImage()" style="background:transparent; border:none; color:#ef4444; font-size:14px; cursor:pointer; padding:2px 6px; border-radius:4px;" title="Remove image">&times;</button>
        </div>

        <!-- Input Row -->
        <div class="chat-input-wrapper">
          <input type="file" id="chat-image-input" accept="image/*" style="display:none;" onchange="handleImageAttach(this)">
          <button type="button" id="attach-image-btn" onclick="document.getElementById('chat-image-input').click()" style="background:transparent; border:none; color:#94a3b8; font-size:16px; cursor:pointer; padding:4px 6px; border-radius:6px; display:flex; align-items:center; justify-content:center; transition:all 0.15s;" title="Attach Image (PNG, JPG, WEBP)">
            📎
          </button>
          <input type="text" id="user-chat-input" class="chat-input" placeholder="Type your message or follow-up question..." onkeydown="if(event.key==='Enter') sendUserChat()">
          <button class="chat-send-btn" id="send-btn" onclick="sendUserChat()">Send</button>
        </div>

        <!-- Quick Suggestions -->
        <div class="quick-chips">
          <div class="chip" onclick="askSuggestion('What can you help me do?')">💡 What can you do?</div>
          <div class="chip" onclick="askSuggestion('Search knowledge base for Neon Postgres architecture')">📚 Search docs</div>
          <div class="chip" onclick="askSuggestion('Help me write a friendly professional email')">✉️ Draft an email</div>
          <div class="chip" onclick="askSuggestion('Explain cloud hosting and containers simply')">☁️ Explain simply</div>
        </div>
      </div>

      <!-- Right Column: Secondary Utilities (Quota Metering & Embed Snippet) -->
      <aside class="workspace-sidebar">
        <!-- Autonomous Task Dispatcher: runs ONLY with this user's connected accounts -->
        <div class="box box-sidebar">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h2>🚀 Run an Autonomous Task</h2>
            <span style="font-size:10px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              Your Accounts Only
            </span>
          </div>
          <p>Give the agent a goal. It acts only on the platforms <strong>you</strong> connected, and pauses for your approval before any sensitive step.</p>
          <textarea id="task-goal-input" rows="3" placeholder="e.g. List the 10 newest rows in my orders table" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12.5px; outline:none; resize:vertical;"></textarea>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <select id="task-max-steps" style="background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 8px; color:#fff; font-size:12px; outline:none;">
              <option value="3">3 steps</option>
              <option value="6" selected>6 steps</option>
              <option value="10">10 steps</option>
            </select>
            <button class="btn-action" style="flex:1;" onclick="runAutonomousTask()">▶ Run Task</button>
          </div>
          <div id="task-run-status" style="display:none; margin-top:10px; font-size:12px; line-height:1.5; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:10px; white-space:pre-wrap; word-break:break-word;"></div>
          <div style="font-size:10.5px; color:#64748b; margin-top:8px;">
            💡 Connect Neon, Redis, GitHub or Cloudflare under <strong>Account Settings → Platform Connections</strong>. Unconnected platforms are refused, never substituted with someone else's account.
          </div>
        </div>

        <!-- Plan & Token Usage Meter -->
        <div class="box box-sidebar">
          <h2>📊 My Plan & Token Usage</h2>
          <p>Real-time prompt and completion token tracking with monthly quota balance.</p>
          <div style="background:#090d16; border:1px solid #1e293b; border-radius:10px; padding:12px 14px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:12.5px;">
              <span>Plan: <strong id="user-plan-badge" style="color:#38bdf8;">Community</strong></span>
              <span>Tokens: <strong id="user-usage-count" style="color:#fff;">0</strong> / <span id="user-usage-limit">1.5M</span></span>
            </div>
            <div style="background:#1e293b; border-radius:6px; height:7px; overflow:hidden; margin-bottom:10px;">
              <div id="user-usage-bar" style="background:linear-gradient(90deg, #38bdf8, #2563eb); height:100%; width:0%; transition:width 0.4s;"></div>
            </div>
            <div id="token-breakdown-row" style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 8px; margin-bottom:8px;">
              <span>📥 In: <strong id="user-in-tokens" style="color:#cbd5e1;">0</strong></span>
              <span>📤 Out: <strong id="user-out-tokens" style="color:#cbd5e1;">0</strong></span>
              <span>⚡ <strong id="user-query-calls" style="color:#cbd5e1;">0</strong> Calls</span>
            </div>
            <div style="font-size:11px; color:#94a3b8;">
              Need unlimited tokens? Connect your free Groq or Gemini key in the <a href="/portal" style="color:#38bdf8;">BYOK Portal</a>.
            </div>
          </div>
        </div>

        <!-- Website Chatbot Widget Embed Snippet Box -->
        <div class="box box-sidebar">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h2>🤖 Website Chatbot</h2>
            <span style="font-size:10px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              Edge CDN
            </span>
          </div>
          <p>Embed customer agent widget on external sites (WordPress, Shopify, HTML).</p>
          <div class="code-snippet-box">
            <div class="code-snippet-header">
              <div class="code-snippet-lang">
                <span class="code-dot"></span>
                <span>HTML</span>
              </div>
              <button type="button" class="copy-code-btn" onclick="copyWorkspaceWidgetSnippet(this)">
                <svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="btn-label">Copy code</span>
              </button>
            </div>
            <pre class="code-snippet-content"><code>&lt;script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" data-api-url="https://edge-agent-widget.shunopsai.workers.dev" defer&gt;&lt;/script&gt;</code></pre>
          </div>
          <div style="font-size:10.5px; color:#64748b; margin-top:8px;">
            💡 Paste right before <code>&lt;/body&gt;</code> in your website template.
          </div>
        </div>
      </aside>
    </div>
  </div>

  <!-- Account Settings & Security Modal -->
  <div id="account-settings-modal" class="modal-overlay" onclick="if(event.target === this) toggleAccountModal(false)">
    <div class="modal-dialog">
      <div class="modal-header">
        <h2>⚙️ Account &amp; Security Settings</h2>
        <button class="modal-close-btn" onclick="toggleAccountModal(false)" title="Close">&times;</button>
      </div>
      <div class="modal-body">
        <!-- Personal API Keys Section -->
        <div class="modal-section-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
              🔑 Personal API Keys
            </h3>
            <span style="font-size:11px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              Active &amp; Functional
            </span>
          </div>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Generate isolated <code>shun_*</code> secret keys to invoke tasks from external scripts, webhooks, or n8n workflows.
          </p>
          <div style="display:flex; gap:8px; margin-bottom:12px;">
            <input type="text" id="api-key-name-input" placeholder="Key description (e.g. n8n runner)" style="flex:1; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 10px; color:#fff; font-size:12px; outline:none;" />
            <button class="btn-sub" onclick="generateApiKey()">+ Create Key</button>
          </div>
          <div id="new-key-display" style="display:none; background:rgba(16,185,129,0.12); border:1px solid #10b981; border-radius:8px; padding:12px; margin-bottom:12px; font-size:12px;">
            <div style="font-weight:600; color:#10b981; margin-bottom:6px;">New Key Generated (Save it now — cannot be displayed again):</div>
            <div style="display:flex; gap:8px; align-items:center; background:#050811; border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:6px 10px;">
              <code id="new-key-value" style="font-family:'JetBrains Mono', monospace; word-break:break-all; color:#fff; font-size:12px; flex:1;"></code>
              <button type="button" class="copy-code-btn" onclick="copyNewApiKey(this)">
                <svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="btn-label">Copy</span>
              </button>
            </div>
          </div>
          <div id="user-keys-list" style="font-size:12px; color:#94a3b8; font-family:'JetBrains Mono', monospace;">
            Loading active keys...
          </div>
        </div>

        <!-- Platform Connections (the user's OWN provider credentials) -->
        <div class="modal-section-card">
          <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            🔌 Platform Connections
          </h3>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Your agent tasks run with <strong>your own</strong> credentials. Connect a platform here and the assistant can act on it — your commands can only ever touch your account, never anyone else's.
          </p>
          <div id="platform-connected-list" style="font-size:12px; color:#94a3b8;">Loading connected platforms...</div>
          <div style="border-top:1px solid #1e293b; margin-top:14px; padding-top:14px;">
            <label style="font-size:11.5px; color:#94a3b8; display:block; margin-bottom:6px;">Connect a platform</label>
            <select id="platform-select" onchange="onPlatformSelectChange()" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 10px; color:#fff; font-size:12px; outline:none;"></select>
            <div id="platform-field-inputs" style="margin-top:8px; display:flex; flex-direction:column; gap:8px;"></div>
            <button class="btn-sub" style="background:#2563eb; color:#fff; border:none; width:100%; padding:8px; margin-top:10px;" onclick="connectPlatformCredential()">Connect Account</button>
            <div id="platform-connect-status" style="font-size:11.5px; margin-top:8px; line-height:1.5;"></div>
            <div style="font-size:10.5px; color:#64748b; margin-top:8px;">
              🔒 Secrets are encrypted at rest (AES-256-GCM) and only shown back to you as a 4-character hint.
            </div>
          </div>
        </div>

        <!-- Account Security & Lifecycle Section -->
        <div class="modal-section-card">
          <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            🔒 Account Privacy &amp; Security
          </h3>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Manage your password, export your complete workspace activity (GDPR), or permanently close your account.
          </p>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn-sub" onclick="togglePasswordChangeDrawer()">🔑 Change Password</button>
            <div id="password-change-drawer" style="display:none; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:12px;">
              <input type="password" id="pw-current" placeholder="Current Password" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; margin-bottom:8px; outline:none;" />
              <input type="password" id="pw-new" placeholder="New Password (min 8 chars)" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; margin-bottom:8px; outline:none;" />
              <button class="btn-sub" style="background:#2563eb; color:#fff; border:none; width:100%; padding:8px;" onclick="submitPasswordChange()">Update Password</button>
            </div>
            <button class="btn-sub" onclick="exportMyData()">📥 Export My Data (JSON)</button>
            <button class="btn-sub" style="border-color:rgba(239,68,68,0.4); color:#ef4444;" onclick="deleteMyAccount()">🗑️ Delete My Account Permanently</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>&copy; 2026 ShunopsAI. Designed for multi-tenant privacy and sovereign autonomy.</div>
    <div style="display:flex; gap:16px;">
      <a href="/portal">Settings</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/about">About &amp; Technical Details</a>
    </div>
  </div>

  <script>
${workspaceScripts(safeUsername)}
  </script>
</body>
</html>`;
}
