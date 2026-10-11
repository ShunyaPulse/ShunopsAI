import { escapeHtml } from "./scripts.js";

/**
 * Multi-Tenant User Workspace Dashboard HTML.
 * Renders user's isolated workspace, connected BYOK services, and personal tasks.
 */
export function getUserWorkspaceHtml(username: string): string {
  // Trust the DB no further than the browser: a username is attacker-influenced
  // at registration, so it must be escaped before it is interpolated into HTML.
  const safeUsername = escapeHtml(username);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Workspace • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --text: #f8fafc;
      --muted: #94a3b8;
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
    }
    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .brand-text {
      font-weight: 700;
      font-size: 15px;
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
      padding: 4px 12px;
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
      max-width: 1100px;
      width: 100%;
      margin: 30px auto;
      padding: 0 20px;
      flex: 1;
    }
    .welcome-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
    }
    .box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    .box h3 {
      font-size: 15px;
      margin-bottom: 12px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #38bdf8, #2563eb);
      color: #fff;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      transition: transform 0.15s;
    }
    .btn-action:hover {
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">⚡</div>
      <div class="brand-text">ShunopsAI Workspace</div>
    </div>
    <div class="user-pill">
      <div class="username-badge">👤 <span id="display-username">${safeUsername}</span></div>
      <button class="logout-btn" onclick="logout()">Sign Out</button>
    </div>
  </header>

  <div class="container">
    <div class="welcome-card">
      <div>
        <h1 style="font-size: 20px; font-weight: 700; margin-bottom: 4px;">Welcome to your Private Dashboard, ${safeUsername}!</h1>
        <p style="font-size: 13px; color: var(--muted);">Your isolated workspace is connected to dedicated serverless compute and zero-persistence BYOK vaults.</p>
      </div>
      <a href="/portal" class="btn-action">🔑 Manage My Keys →</a>
    </div>

    <div class="grid">
      <div class="box">
        <h3>⚡ My AI Assistant & Chat</h3>
        <p style="font-size: 13px; color: var(--muted); line-height: 1.5; margin-bottom: 16px;">
          Ask coding queries, cloud diagnostics, or trigger automated workflows using your personal connected Groq & Gemini quota.
        </p>
        <div style="background: rgba(0,0,0,0.3); border-radius: 10px; padding: 12px; margin-bottom: 14px;">
          <input type="text" id="user-chat-input" placeholder="Ask your agent anything..." style="width: 100%; background: transparent; border: none; color: #fff; outline: none; font-size: 13px;" onkeydown="if(event.key==='Enter') sendUserChat()">
        </div>
        <div id="user-chat-reply" style="font-size: 12px; color: #38bdf8; min-height: 20px;"></div>
      </div>

      <div class="box">
        <h3>🛡️ Workspace Security & Quota</h3>
        <p style="font-size: 13px; color: var(--muted); line-height: 1.5; margin-bottom: 12px;">
          Your requests are protected with 5-layer bank-grade security (Subnet Rate Limits, Turnstile, and Cryptographic PoW).
        </p>
        <div style="font-size: 12px; color: #10b981; display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
          Neon Serverless Database: Active &amp; Isolated
        </div>
      </div>
    </div>
  </div>

  <script>
    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    async function sendUserChat() {
      const input = document.getElementById('user-chat-input');
      const replyDiv = document.getElementById('user-chat-reply');
      const msg = input.value.trim();
      if (!msg) return;

      replyDiv.textContent = 'Thinking...';
      input.value = '';

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        replyDiv.textContent = data.reply || 'No response received.';
      } catch (err) {
        replyDiv.textContent = 'Failed to connect to agent.';
      }
    }
  </script>
</body>
</html>`;
}
