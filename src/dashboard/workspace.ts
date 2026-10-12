import { escapeHtml } from "./scripts.js";

/**
 * Multi-Tenant User Workspace Dashboard HTML.
 * Includes:
 * 1. Human-in-the-Loop Approvals Queue
 * 2. Persistent Conversation Thread & History
 * 3. Account Lifecycle (Password Change, Export Data, Delete Account)
 * 4. Personal API Key Management
 * 5. Plan & Usage Metering
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
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --text: #f8fafc;
      --muted: #94a3b8;
      --green: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #090d16 65%);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: inherit;
    }
    .brand-logo {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .brand-text {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.3px;
    }
    .user-pill {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .username-badge {
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.25);
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .logout-btn {
      background: transparent;
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #ef4444;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s;
    }
    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.15);
    }
    .container {
      max-width: 1140px;
      width: 100%;
      margin: 28px auto;
      padding: 0 20px;
      flex: 1;
    }
    .welcome-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      flex-wrap: wrap;
      gap: 16px;
    }
    .welcome-title {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #fff;
    }
    .welcome-desc {
      font-size: 14px;
      color: var(--muted);
      line-height: 1.5;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #38bdf8, #2563eb);
      color: #fff;
      text-decoration: none;
      padding: 10px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn-action:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(56, 189, 248, 0.3);
    }
    .grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 20px;
    }
    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      margin-bottom: 20px;
    }
    .box:last-child {
      margin-bottom: 0;
    }
    .box h2 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .box p {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 14px;
    }

    /* Chat thread & message bubbles */
    .chat-thread-container {
      height: 380px;
      overflow-y: auto;
      padding: 14px;
      background: #060911;
      border: 1px solid #1e293b;
      border-radius: 12px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    .chat-thread-container::-webkit-scrollbar {
      width: 6px;
    }
    .chat-thread-container::-webkit-scrollbar-thumb {
      background: #1e293b;
      border-radius: 3px;
    }

    .msg-bubble {
      padding: 10px 14px;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
      animation: fadeIn 0.15s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .msg-user {
      align-self: flex-end;
      max-width: 82%;
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      color: #fff;
      border-radius: 14px 14px 4px 14px;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }
    .msg-assistant {
      align-self: flex-start;
      max-width: 88%;
      background: #0f172a;
      border: 1px solid #1e293b;
      color: #e2e8f0;
      border-radius: 14px 14px 14px 4px;
    }
    .msg-header {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .msg-user .msg-header {
      color: #bfdbfe;
      justify-content: flex-end;
    }
    .msg-assistant .msg-header {
      color: #38bdf8;
    }
    .msg-body {
      white-space: pre-wrap;
    }

    .thinking-bubble {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #94a3b8;
      font-size: 12px;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 14px 14px 14px 4px;
      align-self: flex-start;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      animation: pulse 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1.1); opacity: 1; }
    }

    .chat-input-wrapper {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 6px 6px 6px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: border-color 0.15s;
    }
    .chat-input-wrapper:focus-within {
      border-color: var(--accent);
    }
    .chat-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      outline: none;
      font-size: 14px;
      font-family: inherit;
    }
    .chat-send-btn {
      background: var(--accent);
      color: #000;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .chat-send-btn:hover {
      background: #7dd3fc;
    }
    .chat-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 14px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip:hover {
      background: rgba(56, 189, 248, 0.12);
      border-color: var(--accent);
      color: #fff;
    }

    .feature-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .feature-item:last-child {
      border-bottom: none;
    }
    .feature-icon {
      font-size: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .feature-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 2px;
    }
    .feature-desc {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
      margin: 0;
    }
    .btn-sub {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: #cbd5e1;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.15s;
    }
    .btn-sub:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    /* Modal styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(3, 7, 18, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
      padding: 16px;
    }
    .modal-overlay.active {
      opacity: 1;
      visibility: visible;
    }
    .modal-dialog {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 18px;
      max-width: 580px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(56, 189, 248, 0.1);
      transform: translateY(15px) scale(0.98);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-overlay.active .modal-dialog {
      transform: translateY(0) scale(1);
    }
    .modal-header {
      padding: 18px 22px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      background: #0b1120;
      z-index: 2;
    }
    .modal-header h2 {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .modal-close-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      transition: all 0.15s;
    }
    .modal-close-btn:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
      color: #f87171;
    }
    .modal-body {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .modal-section-card {
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 16px;
    }

    /* Standard Code Snippet Component */
    .code-snippet-box {
      background: #050811;
      border: 1px solid #1e293b;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .code-snippet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0b1120;
      padding: 7px 12px;
      border-bottom: 1px solid #1e293b;
    }
    .code-snippet-lang {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.5px;
      font-family: 'JetBrains Mono', monospace;
    }
    .code-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
    }
    .copy-code-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .copy-code-btn:hover {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }
    .copy-code-btn.copied {
      background: rgba(16, 185, 129, 0.15);
      border-color: #10b981;
      color: #10b981;
    }
    .code-snippet-content {
      margin: 0;
      padding: 12px 14px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      line-height: 1.6;
      color: #38bdf8;
      background: #030712;
      white-space: nowrap;
    }
    .code-snippet-content::-webkit-scrollbar {
      height: 5px;
    }
    .code-snippet-content::-webkit-scrollbar-thumb {
      background: #1e293b;
      border-radius: 3px;
    }
    .code-snippet-content code {
      font-family: inherit;
    }

    .footer {
      max-width: 1140px;
      margin: 0 auto;
      padding: 24px 20px 40px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 12px;
      color: var(--muted);
      width: 100%;
    }
    .footer a {
      color: #38bdf8;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
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
      <!-- Left: Chat Assistant with Persistent Conversation History -->
      <div class="box">
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

        <!-- Input Row -->
        <div class="chat-input-wrapper">
          <input type="text" id="user-chat-input" class="chat-input" placeholder="Type your message or follow-up question..." onkeydown="if(event.key==='Enter') sendUserChat()">
          <button class="chat-send-btn" id="send-btn" onclick="sendUserChat()">Send</button>
        </div>

        <!-- Quick Suggestions -->
        <div class="quick-chips">
          <div class="chip" onclick="askSuggestion('What can you help me do?')">💡 What can you do?</div>
          <div class="chip" onclick="askSuggestion('Help me write a friendly professional email')">✉️ Draft an email</div>
          <div class="chip" onclick="askSuggestion('Explain cloud hosting and containers simply')">☁️ Explain simply</div>
        </div>
      </div>

      <!-- Right Column: Quota & Metering + Account Lifecycle -->
      <div>
        <!-- Plan & Usage Meter -->
        <div class="box">
          <h2>📊 My Plan & Quota Usage</h2>
          <p>Multi-tenant resource metering and query limits.</p>
          <div style="background:#090d16; border:1px solid #1e293b; border-radius:10px; padding:14px; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
              <span>Plan: <strong id="user-plan-badge" style="color:#38bdf8;">Community</strong></span>
              <span>Used: <strong id="user-usage-count">0</strong> / <span id="user-usage-limit">100</span></span>
            </div>
            <div style="background:#1e293b; border-radius:6px; height:8px; overflow:hidden;">
              <div id="user-usage-bar" style="background:linear-gradient(90deg, #38bdf8, #2563eb); height:100%; width:0%; transition:width 0.4s;"></div>
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:8px;">
              Need unlimited queries? Connect your free Groq or Gemini key in the <a href="/portal" style="color:#38bdf8;">BYOK Portal</a>.
            </div>
          </div>
        </div>

        <!-- Website Chatbot Widget Embed Snippet Box -->
        <div class="box">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h2>🤖 Website Customer Chatbot</h2>
            <span style="font-size:11px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              Edge CDN
            </span>
          </div>
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
            <pre class="code-snippet-content"><code>&lt;script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" defer&gt;&lt;/script&gt;</code></pre>
          </div>
          <div style="font-size:11px; color:#64748b;">
            💡 Paste right before <code>&lt;/body&gt;</code> in your HTML or web builder (WordPress, Webflow, Shopify).
          </div>
        </div>
      </div>
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
    let conversationHistory = [];

    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    function toggleContextDrawer() {
      const drawer = document.getElementById('custom-context-drawer');
      const arrow = document.getElementById('context-toggle-arrow');
      if (drawer.style.display === 'none') {
        drawer.style.display = 'block';
        arrow.textContent = '▾';
      } else {
        drawer.style.display = 'none';
        arrow.textContent = '▸';
      }
    }

    function togglePasswordChangeDrawer() {
      const d = document.getElementById('password-change-drawer');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    }

    function updateContextBadge() {
      const badge = document.getElementById('context-badge');
      const count = conversationHistory.length;
      badge.textContent = '🧠 Persistent Memory (' + count + ' messages)';
    }

    // 1. Persistent Chat History: Load from DB on startup
    async function loadSavedChatHistory() {
      const thread = document.getElementById('chat-thread');
      try {
        const res = await fetch('/api/workspace/chat-history');
        const data = await res.json();
        const emptyState = document.getElementById('empty-state');

        if (data.success && data.messages && data.messages.length > 0) {
          if (emptyState) emptyState.remove();
          thread.innerHTML = '';
          conversationHistory = [];
          data.messages.forEach(m => {
            appendMessageBubble(m.role, m.message, false);
            conversationHistory.push({ role: m.role, content: m.message });
          });
          updateContextBadge();
        } else {
          if (emptyState) {
            emptyState.innerHTML = '👋 Hello <strong>${safeUsername}</strong>! Ask a question or pick a prompt below to begin.';
          }
        }
      } catch (e) {
        const emptyState = document.getElementById('empty-state');
        if (emptyState) emptyState.innerHTML = '👋 Welcome! Start a new conversation below.';
      }
    }

    // 2. Clear Chat History in DB & in Memory
    async function clearConversation() {
      if (!confirm('Are you sure you want to clear your conversation history?')) return;
      try {
        await fetch('/api/workspace/chat-history', { method: 'DELETE' });
        conversationHistory = [];
        const thread = document.getElementById('chat-thread');
        thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">👋 Fresh conversation started! Ask a question below.</div>';
        updateContextBadge();
      } catch (e) {
        alert('Could not clear history: ' + e.message);
      }
    }

    function askSuggestion(text) {
      document.getElementById('user-chat-input').value = text;
      sendUserChat();
    }

    function escapeHtmlText(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function appendMessageBubble(role, content, autoScroll = true) {
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.remove();

      const thread = document.getElementById('chat-thread');
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble ' + (role === 'user' ? 'msg-user' : 'msg-assistant');

      const header = document.createElement('div');
      header.className = 'msg-header';
      header.textContent = role === 'user' ? '👤 You' : '⚡ Assistant';

      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = content;

      bubble.appendChild(header);
      bubble.appendChild(body);
      thread.appendChild(bubble);
      if (autoScroll) thread.scrollTop = thread.scrollHeight;
    }

    function showThinkingIndicator() {
      const thread = document.getElementById('chat-thread');
      const thinking = document.createElement('div');
      thinking.id = 'thinking-indicator';
      thinking.className = 'thinking-bubble';
      thinking.innerHTML = '<span>Thinking</span><span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      thread.appendChild(thinking);
      thread.scrollTop = thread.scrollHeight;
    }

    function removeThinkingIndicator() {
      const thinking = document.getElementById('thinking-indicator');
      if (thinking) thinking.remove();
    }

    const DB_NAME = "shunops_secure_vault_v3";
    const STORE_NAME = "keys_store";

    async function loadVaultKeys() {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const record = await new Promise((resolve, reject) => {
          const req = store.get("encrypted_payload");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const cryptoKey = await new Promise((resolve, reject) => {
          const kTx = db.transaction(STORE_NAME, "readonly");
          const kStore = kTx.objectStore(STORE_NAME);
          const req = kStore.get("non_extractable_master_key");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!record || !record.iv || !record.ciphertext || !cryptoKey) return null;
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, cryptoKey, record.ciphertext);
        return JSON.parse(new TextDecoder().decode(decrypted));
      } catch (e) {
        return null;
      }
    }

    // Cryptographic Proof-of-Work Solver (Client Anti-Bot Shield)
    async function solveProofOfWork(challenge) {
      if (!challenge || !window.crypto || !window.crypto.subtle) return null;
      const enc = new TextEncoder();
      const targetDifficulty = challenge.targetDifficulty || 2;
      const targetPrefix = '0'.repeat(targetDifficulty);
      let nonce = 0;
      while (nonce < 100000) {
        const data = enc.encode(challenge.salt + ':' + nonce);
        const buf = await window.crypto.subtle.digest('SHA-256', data);
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (hex.startsWith(targetPrefix)) {
          return {
            salt: challenge.salt,
            timestamp: challenge.timestamp,
            targetDifficulty: challenge.targetDifficulty,
            signature: challenge.signature,
            solution: String(nonce),
          };
        }
        nonce++;
      }
      return null;
    }

    async function sendUserChat() {
      const input = document.getElementById('user-chat-input');
      const sendBtn = document.getElementById('send-btn');
      const msg = input.value.trim();
      if (!msg) return;

      input.value = '';
      sendBtn.disabled = true;
      sendBtn.textContent = '...';

      // 1. Render User Message
      appendMessageBubble('user', msg);
      showThinkingIndicator();

      // 2. Build multi-turn context
      const customContext = document.getElementById('custom-context-input')?.value.trim();
      const historyItems = [];
      if (customContext) {
        historyItems.push('Custom Workspace Notes/Instructions:\\n' + customContext);
      }
      if (conversationHistory.length > 0) {
        const recent = conversationHistory.slice(-8);
        const turnsText = recent.map(t => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.content).join('\\n');
        historyItems.push('Previous Conversation History:\\n' + turnsText);
      }
      const historyPayload = historyItems.length > 0 ? historyItems.join('\\n\\n') : undefined;

      try {
        const headers = { 'Content-Type': 'application/json' };
        const vault = await loadVaultKeys();
        if (vault) {
          if (vault.groq) headers['x-groq-key'] = vault.groq;
          if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
        }

        // Solve Proof-of-Work challenge in background (WebCrypto solves in ~20-30ms)
        let shieldSolution = null;
        try {
          const chRes = await fetch('/api/shield/challenge');
          if (chRes.ok) {
            const chData = await chRes.json();
            shieldSolution = await solveProofOfWork(chData);
          }
        } catch (e) {}

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            message: msg,
            history: historyPayload,
            shield: shieldSolution || undefined,
          })
        });

        const data = await res.json();
        removeThinkingIndicator();

        const reply = data.reply || 'No response received. Please try again.';
        appendMessageBubble('assistant', reply);

        conversationHistory.push({ role: 'user', content: msg });
        conversationHistory.push({ role: 'assistant', content: reply });
        updateContextBadge();
        fetchBillingUsage();

      } catch (err) {
        removeThinkingIndicator();
        appendMessageBubble('assistant', 'Sorry, could not connect right now. Please check your connection and try again.');
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    }

    // 3. Human Approvals Queue Polling & Execution
    async function fetchWorkspaceApprovals() {
      const box = document.getElementById('workspace-approvals-box');
      const list = document.getElementById('workspace-approvals-list');
      try {
        const res = await fetch('/api/pending-approvals');
        if (!res.ok) return;
        const data = await res.json();
        const pending = data.pending || [];

        if (pending.length === 0) {
          box.style.display = 'none';
          return;
        }

        box.style.display = 'block';
        list.innerHTML = pending.map(req => \`
          <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px; margin-top: 10px;">
            <div style="display:flex; justify-content:space-between;">
              <strong style="color:#f87171;">\${escapeHtmlText(req.action)}</strong>
              <span style="font-size:11px; color:#94a3b8; font-family:monospace;">\${escapeHtmlText(req.id)}</span>
            </div>
            <div style="font-size:12px; color:#cbd5e1; margin:4px 0;">\${escapeHtmlText(req.riskReason)}</div>
            <pre style="background:#000; padding:6px; border-radius:4px; font-size:11px; overflow-x:auto; margin:6px 0; color:#e2e8f0;">\${escapeHtmlText(req.commandOrPayload)}</pre>
            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
              <button class="btn-sub" style="border-color:#ef4444; color:#ef4444;" onclick="submitApproval('\${escapeHtmlText(req.id)}', false)">❌ Reject</button>
              <button class="btn-sub" style="background:#10b981; color:#fff; border:none;" onclick="submitApproval('\${escapeHtmlText(req.id)}', true)">✅ Approve</button>
            </div>
          </div>
        \`).join('');
      } catch (e) {}
    }

    async function submitApproval(id, approved) {
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, approved })
        });
        const data = await res.json();
        alert(data.message || (approved ? 'Approved' : 'Rejected'));
        fetchWorkspaceApprovals();
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    // 4. Billing Usage & Meter
    async function fetchBillingUsage() {
      try {
        const res = await fetch('/api/billing/usage');
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          document.getElementById('user-plan-badge').textContent = (data.plan || 'community').toUpperCase();
          document.getElementById('user-usage-count').textContent = data.queryCount || 0;
          document.getElementById('user-usage-limit').textContent = data.limit >= 999999 ? 'Unlimited' : data.limit;
          const pct = Math.min(100, Math.round(((data.queryCount || 0) / (data.limit || 100)) * 100));
          document.getElementById('user-usage-bar').style.width = pct + '%';
        }
      } catch (e) {}
    }

    // 5. Personal API Keys
    async function loadApiKeys() {
      const container = document.getElementById('user-keys-list');
      try {
        const res = await fetch('/api/user/api-keys');
        const data = await res.json();
        if (data.success && data.keys) {
          if (data.keys.length === 0) {
            container.innerHTML = '<div style="color:#64748b;">No active API keys yet.</div>';
            return;
          }
          container.innerHTML = data.keys.map(k => \`
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
              <div>
                <span style="color:#fff; font-weight:600;">\${escapeHtmlText(k.name)}</span>
                <span style="color:#64748b; margin-left:6px;">(\${escapeHtmlText(k.keyPrefix)}...)</span>
              </div>
              <button class="btn-sub" style="padding:2px 8px; font-size:10px; border-color:#ef4444; color:#ef4444;" onclick="revokeApiKey(\${k.id})">Revoke</button>
            </div>
          \`).join('');
        }
      } catch (e) {
        container.innerHTML = '<div style="color:#ef4444;">Failed to load keys.</div>';
      }
    }

    async function generateApiKey() {
      const input = document.getElementById('api-key-name-input');
      const name = input.value.trim() || 'API Key';
      try {
        const res = await fetch('/api/user/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
          input.value = '';
          document.getElementById('new-key-value').textContent = data.key;
          document.getElementById('new-key-display').style.display = 'block';
          loadApiKeys();
        } else {
          alert('Error: ' + (data.error || 'Failed to generate key'));
        }
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    async function revokeApiKey(id) {
      if (!confirm('Revoke this API key?')) return;
      try {
        const res = await fetch('/api/user/api-keys/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) loadApiKeys();
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    // 6. Account Lifecycle: Change Password, Export Data, Delete Account
    async function submitPasswordChange() {
      const currentPassword = document.getElementById('pw-current').value;
      const newPassword = document.getElementById('pw-new').value;
      if (!newPassword || newPassword.length < 8) {
        alert('New password must be at least 8 characters long.');
        return;
      }
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          alert('Password updated successfully!');
          document.getElementById('pw-current').value = '';
          document.getElementById('pw-new').value = '';
          togglePasswordChangeDrawer();
        } else {
          alert('Error: ' + (data.error || 'Failed to update password'));
        }
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    function exportMyData() {
      window.location.href = '/api/auth/account/export';
    }

    async function deleteMyAccount() {
      const conf = confirm('⚠️ ARE YOU ABSOLUTELY SURE?\\n\\nThis will permanently delete your account, workspace, conversation history, and API keys. This action CANNOT be undone.');
      if (!conf) return;
      const conf2 = prompt('Type DELETE to confirm permanent account removal:');
      if (conf2 !== 'DELETE') {
        alert('Account deletion aborted.');
        return;
      }
      try {
        const res = await fetch('/api/auth/account', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          alert('Your account has been deleted permanently.');
          window.location.href = '/register';
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    
    function toggleAccountModal(show) {
      const modal = document.getElementById('account-settings-modal');
      if (!modal) return;
      const shouldOpen = show !== undefined ? show : !modal.classList.contains('active');
      if (shouldOpen) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        loadApiKeys();
      } else {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleAccountModal(false);
      }
    });

    function copyToClipboardStandard(btn, textToCopy, copiedLabel) {
      if (!textToCopy) return;
      navigator.clipboard.writeText(textToCopy).then(() => {
        const label = btn.querySelector('.btn-label');
        const origHtml = btn.innerHTML;
        btn.classList.add('copied');
        if (label) {
          label.textContent = copiedLabel || 'Copied!';
          const svg = btn.querySelector('svg');
          if (svg) {
            svg.outerHTML = '<svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          }
        } else {
          btn.textContent = '✓ Copied!';
        }
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = origHtml;
        }, 2000);
      }).catch(() => {
        prompt('Copy:', textToCopy);
      });
    }

    function copyNewApiKey(btn) {
      const el = document.getElementById('new-key-value');
      const key = el ? el.textContent : '';
      copyToClipboardStandard(btn, key, 'Copied!');
    }

    function copyWorkspaceWidgetSnippet(btn) {
      const code = '<' + 'script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" defer><' + '/script>';
      copyToClipboardStandard(btn, code, 'Copied!');
    }

    window.addEventListener('DOMContentLoaded', () => {
      loadSavedChatHistory();
      fetchWorkspaceApprovals();
      fetchBillingUsage();
      loadApiKeys();
      setInterval(fetchWorkspaceApprovals, 4000); // Live approvals polling
    });
  </script>
</body>
</html>`;
}
