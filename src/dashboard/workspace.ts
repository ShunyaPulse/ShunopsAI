import { escapeHtml } from "./scripts.js";

/**
 * Multi-Tenant User Workspace Dashboard HTML.
 * Designed to be clean, simple, and friendly for non-technical users.
 * All deep technical jargon is moved to /privacy, /terms, and /about.
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
      max-width: 1060px;
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
      grid-template-columns: 1.4fr 1fr;
      gap: 20px;
    }
    @media (max-width: 840px) {
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
    }
    .box h2 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .box p {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 16px;
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
    .chat-reply-area {
      margin-top: 14px;
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px;
      font-size: 13px;
      line-height: 1.6;
      color: #e2e8f0;
      min-height: 50px;
      white-space: pre-wrap;
      display: none;
    }
    .quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      padding: 5px 10px;
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
    .footer {
      max-width: 1060px;
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
        <p class="welcome-desc">Your private personal assistant is ready to help you write, research, and get things done.</p>
      </div>
      <a href="/portal" class="btn-action">⚙️ Assistant Settings &rarr;</a>
    </div>

    <div class="grid">
      <!-- Left: Chat Assistant -->
      <div class="box">
        <h2>💬 Ask Your AI Assistant</h2>
        <p>
          Ask questions, get explanations, draft messages, or brainstorm ideas anytime.
        </p>

        <div class="chat-input-wrapper">
          <input type="text" id="user-chat-input" class="chat-input" placeholder="Ask anything (e.g. 'How can you help me today?')..." onkeydown="if(event.key==='Enter') sendUserChat()">
          <button class="chat-send-btn" id="send-btn" onclick="sendUserChat()">Send</button>
        </div>

        <div class="quick-chips">
          <div class="chip" onclick="askSuggestion('What can you help me do?')">💡 What can you do?</div>
          <div class="chip" onclick="askSuggestion('Help me write a friendly professional email')">✉️ Draft an email</div>
          <div class="chip" onclick="askSuggestion('Explain cloud hosting in simple terms')">☁️ Explain simply</div>
        </div>

        <div id="user-chat-reply" class="chat-reply-area"></div>
      </div>

      <!-- Right: Simple Overview & Tools -->
      <div class="box">
        <h2>🚀 What You Can Do</h2>
        <p>Everything is set up and ready. No technical configuration needed.</p>

        <div class="feature-item">
          <div class="feature-icon">✨</div>
          <div>
            <div class="feature-title">Free Built-in AI Included</div>
            <p class="feature-desc">Start chatting immediately. Fast and ready with no setup required.</p>
          </div>
        </div>

        <div class="feature-item">
          <div class="feature-icon">🔑</div>
          <div>
            <div class="feature-title">Add Your Own Keys (Optional)</div>
            <p class="feature-desc">Want unlimited questions? You can easily connect your own free Google Gemini or Groq key.</p>
          </div>
        </div>

        <div class="feature-item">
          <div class="feature-icon">🔒</div>
          <div>
            <div class="feature-title">Private &amp; Secure</div>
            <p class="feature-desc">Your conversations are private. We never sell your data or use it for training.</p>
          </div>
        </div>

        <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between;">
          <div style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--green);">
            <span style="width:8px; height:8px; border-radius:50%; background:var(--green); display:inline-block;"></span>
            Assistant Status: Ready
          </div>
          <a href="/portal" style="font-size:12px; color:#38bdf8; text-decoration:none;">Settings &rarr;</a>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>&copy; 2026 ShunopsAI. Designed for simplicity and privacy.</div>
    <div style="display:flex; gap:16px;">
      <a href="/portal">Settings</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/about">About &amp; Technical Details</a>
    </div>
  </div>

  <script>
    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    function askSuggestion(text) {
      document.getElementById('user-chat-input').value = text;
      sendUserChat();
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

    async function sendUserChat() {
      const input = document.getElementById('user-chat-input');
      const replyDiv = document.getElementById('user-chat-reply');
      const sendBtn = document.getElementById('send-btn');
      const msg = input.value.trim();
      if (!msg) return;

      replyDiv.style.display = 'block';
      replyDiv.textContent = 'Thinking...';
      sendBtn.disabled = true;
      sendBtn.textContent = '...';
      input.value = '';

      try {
        const headers = { 'Content-Type': 'application/json' };
        // Wire BYOK Keys if present in browser vault
        const vault = await loadVaultKeys();
        if (vault) {
          if (vault.groq) headers['x-groq-key'] = vault.groq;
          if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        replyDiv.textContent = data.reply || 'No response received. Please try again.';
      } catch (err) {
        replyDiv.textContent = 'Sorry, could not connect right now. Please check your connection and try again.';
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    }
  </script>
</body>
</html>`;
}
