/**
 * Authentication HTML pages (Login & Register).
 * Clean, standard, modern UI without native browser popups.
 */
export function getAuthPageHtml(mode: "login" | "register"): string {
  const isLogin = mode === "login";
  const title = isLogin ? "Sign In" : "Create Account";
  const subtitle = isLogin
    ? "Welcome back. Access your personal workspace dashboard."
    : "Register your username and password to create your private workspace.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      max-width: 420px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(56, 189, 248, 0.1);
      color: #38bdf8;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #fff;
    }
    p.subtitle {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #020617;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 10px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus {
      border-color: #38bdf8;
    }
    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #38bdf8, #2563eb);
      border: none;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 11px;
      border-radius: 10px;
      cursor: pointer;
      margin-top: 10px;
      transition: opacity 0.15s, transform 0.15s;
    }
    .btn-submit:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }
    .footer-link {
      margin-top: 20px;
      text-align: center;
      font-size: 13px;
      color: var(--muted);
    }
    .footer-link a {
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
    }
    .footer-link a:hover {
      text-decoration: underline;
    }
    .msg-box {
      font-size: 12px;
      padding: 10px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: none;
    }
    .msg-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .msg-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="logo-badge">⚡ ShunopsAI Multi-Cloud</div>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>

    <div id="msg" class="msg-box"></div>

    <form id="auth-form" onsubmit="handleSubmit(event)">
      <!-- Honeypot trap for bots -->
      <input type="text" name="hp_website" id="hp_website" style="display:none;" tabindex="-1" autocomplete="off" />

      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" required autocomplete="username" placeholder="e.g. alex2026" />
      </div>

      ${
        !isLogin
          ? `<div class="form-group">
        <label for="email">Email (Optional)</label>
        <input type="email" id="email" autocomplete="email" placeholder="alex@example.com" />
      </div>`
          : ""
      }

      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" required autocomplete="${
          isLogin ? "current-password" : "new-password"
        }" placeholder="••••••••" />
      </div>

      <button type="submit" id="btn-submit" class="btn-submit">
        ${isLogin ? "Sign In →" : "Create My Account →"}
      </button>
    </form>

    <div class="footer-link">
      ${
        isLogin
          ? `Don't have an account? <a href="/register">Sign up here</a>`
          : `Already have an account? <a href="/login">Sign in here</a>`
      }
    </div>
  </div>

  <script>
    async function handleSubmit(e) {
      e.preventDefault();
      const msgBox = document.getElementById('msg');
      const btn = document.getElementById('btn-submit');
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const hp_website = document.getElementById('hp_website').value;
      const emailEl = document.getElementById('email');
      const email = emailEl ? emailEl.value.trim() : undefined;

      msgBox.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Processing...';

      const endpoint = '${isLogin ? "/api/auth/login" : "/api/auth/register"}';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, email, hp_website })
        });
        const data = await res.json();

        if (!res.ok) {
          msgBox.className = 'msg-box msg-error';
          msgBox.textContent = data.error || 'Operation failed. Please try again.';
          msgBox.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '${isLogin ? "Sign In →" : "Create My Account →"}';
          return;
        }

        msgBox.className = 'msg-box msg-success';
        msgBox.textContent = '${isLogin ? "Login successful! Redirecting..." : "Account created! Redirecting..."}';
        msgBox.style.display = 'block';

        setTimeout(() => {
          window.location.href = '/workspace';
        }, 800);
      } catch (err) {
        msgBox.className = 'msg-box msg-error';
        msgBox.textContent = 'Network error. Please try again.';
        msgBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '${isLogin ? "Sign In →" : "Create My Account →"}';
      }
    }
  </script>
</body>
</html>`;
}
