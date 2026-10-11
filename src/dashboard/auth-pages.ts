/**
 * Authentication HTML pages (Login & Register).
 * Matches the Kanban-Cloud production UI and security features:
 * - Google Sign-In button
 * - Email + OTP registration / login
 * - Username + Password registration with required Email OTP verification
 * - Cloudflare Turnstile bot verification
 * - Client-side WebCrypto Proof-of-Work solver
 * - Honeypot traps
 */
export function getAuthPageHtml(mode: "login" | "register"): string {
  const isLogin = mode === "login";
  const title = isLogin ? "Welcome back" : "Create verified private workspace";
  const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
  const turnstileSiteKey =
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isLogin ? "Sign In" : "Sign Up"} • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <!-- Google Sign-In SDK -->
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <!-- Cloudflare Turnstile SDK -->
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #10b981;
      --accent-blue: #38bdf8;
      --text: #f8fafc;
      --muted: #94a3b8;
      --input-bg: #020617;
      --input-border: #334155;
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
      padding: 24px;
    }
    .auth-container {
      background: #0d1527;
      border: 1px solid rgba(56, 189, 248, 0.15);
      border-radius: 20px;
      max-width: 440px;
      width: 100%;
      padding: 36px 32px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      position: relative;
    }
    .auth-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .brand-subtitle {
      font-size: 13px;
      color: var(--muted);
    }
    .google-btn-wrapper {
      margin-bottom: 12px;
      display: flex;
      justify-content: center;
    }
    .github-oauth-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #f8fafc;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      padding: 10px 16px;
      box-sizing: border-box;
      transition: background 0.15s, border-color 0.15s;
    }
    .github-oauth-btn:hover {
      background: #334155;
      border-color: rgba(255, 255, 255, 0.25);
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 20px 0;
      color: #64748b;
      font-size: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .divider span {
      padding: 0 12px;
    }
    .form-group {
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    input {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      padding: 11px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }
    .btn-secondary {
      background: #059669;
      color: #fff;
      border: none;
      padding: 0 16px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .btn-secondary:hover {
      background: #10b981;
    }
    .btn-secondary:disabled {
      background: #334155;
      cursor: not-allowed;
      color: #94a3b8;
    }
    .btn-primary {
      width: 100%;
      background: linear-gradient(135deg, #1d4ed8, #059669);
      border: none;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 12px;
      border-radius: 10px;
      cursor: pointer;
      margin-top: 14px;
      transition: opacity 0.15s, transform 0.15s;
    }
    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .toggle-row input {
      width: auto;
      margin: 0;
      cursor: pointer;
    }
    .footer-link {
      margin-top: 22px;
      text-align: center;
      font-size: 13px;
      color: var(--muted);
    }
    .footer-link a {
      color: var(--accent-blue);
      text-decoration: none;
      font-weight: 600;
    }
    .footer-link a:hover {
      text-decoration: underline;
    }
    .msg-box {
      font-size: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: none;
      line-height: 1.4;
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
    .turnstile-box {
      display: flex;
      justify-content: center;
      margin: 14px 0 6px;
    }
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-header">
      <div class="brand-title">ShunopsAI</div>
      <div class="brand-subtitle">${title}</div>
    </div>

    <div class="oauth-section">
      ${
        googleClientId
          ? `<div class="google-btn-wrapper">
        <div id="g_id_onload"
             data-client_id="${googleClientId}"
             data-callback="handleGoogleCallback"
             data-auto_prompt="false">
        </div>
        <div class="g_id_signin"
             data-type="standard"
             data-size="large"
             data-theme="outline"
             data-text="continue_with"
             data-shape="rectangular"
             data-logo_alignment="left"
             data-width="376">
        </div>
      </div>`
          : ""
      }
      <a href="/api/auth/github" class="github-oauth-btn">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
        </svg>
        <span>${isLogin ? "Sign in" : "Sign up"} with GitHub</span>
      </a>
    </div>

    <div class="divider">
      <span>Or continue with email</span>
    </div>

    <div id="msg" class="msg-box"></div>

    <form id="auth-form" onsubmit="handleFormSubmit(event)">
      <!-- Honeypot trap for bots -->
      <input type="text" name="hp_website" id="hp_website" style="display:none;" tabindex="-1" autocomplete="off" />

      ${
        !isLogin
          ? `
      <!-- Sign Up Form -->
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" required autocomplete="username" placeholder="e.g. alex2026" />
      </div>

      <div class="form-group">
        <label for="email">Email Address</label>
        <div class="input-row">
          <input type="email" id="email" required autocomplete="email" placeholder="you@example.com" />
          <button type="button" id="btn-send-otp" class="btn-secondary" onclick="sendVerificationOTP('signup')">Send OTP</button>
        </div>
      </div>

      <div class="form-group" id="otp-group" style="display:none;">
        <label for="otp">Email Verification Code (6-Digits)</label>
        <input type="text" id="otp" maxlength="6" placeholder="123456" autocomplete="one-time-code" style="font-family: monospace; letter-spacing: 4px; font-weight: 700;" />
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters" />
      </div>
      `
          : `
      <!-- Sign In Form -->
      <div class="form-group">
        <label for="identifier">Email Address or Username</label>
        <div class="input-row">
          <input type="text" id="identifier" required autocomplete="username" placeholder="you@example.com" />
          <button type="button" id="btn-send-otp" class="btn-secondary" style="display:none;" onclick="sendVerificationOTP('login')">Send OTP</button>
        </div>
      </div>

      <div class="form-group" id="password-group">
        <label for="password">Password</label>
        <input type="password" id="password" autocomplete="current-password" placeholder="••••••••" />
      </div>

      <div class="form-group" id="otp-group" style="display:none;">
        <label for="otp">Email OTP Code (6-Digits)</label>
        <input type="text" id="otp" maxlength="6" placeholder="123456" autocomplete="one-time-code" style="font-family: monospace; letter-spacing: 4px; font-weight: 700;" />
      </div>

      <div class="toggle-row">
        <input type="checkbox" id="chk-otp-mode" onchange="toggleOtpMode()" />
        <label for="chk-otp-mode" style="margin:0; cursor:pointer;">Sign in with Email OTP Code instead</label>
      </div>
      `
      }

      <!-- Cloudflare Turnstile Bot Shield -->
      <div class="turnstile-box" id="turnstile-container"></div>

      <button type="submit" id="btn-submit" class="btn-primary">
        ${isLogin ? "Sign In" : "Click 'Send OTP' above to verify"}
      </button>
    </form>

    <div class="footer-link">
      ${
        isLogin
          ? `Don't have an account? <a href="/register">Sign up</a>`
          : `Already have an account? <a href="/login">Sign in</a>`
      }
    </div>
  </div>

  <script>
    let turnstileToken = "";
    let isOtpSent = false;
    const isLoginMode = ${isLogin};
    const turnstileSiteKey = "${turnstileSiteKey}";

    // Initialize Cloudflare Turnstile
    window.addEventListener("DOMContentLoaded", () => {
      if (typeof turnstile !== "undefined" && turnstileSiteKey) {
        try {
          turnstile.render("#turnstile-container", {
            sitekey: turnstileSiteKey,
            theme: "dark",
            callback: function(token) {
              turnstileToken = token;
            }
          });
        } catch (e) {}
      }

      const urlParams = new URLSearchParams(window.location.search);
      const urlErr = urlParams.get('error');
      if (urlErr) {
        showMsg(decodeURIComponent(urlErr), 'error');
      }
    });

    // 1. Google OAuth Callback
    async function handleGoogleCallback(response) {
      if (!response.credential) return;
      showMsg('Authenticating with Google...', 'success');

      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'Google login failed.', 'error');
          return;
        }
        showMsg('Login successful! Redirecting...', 'success');
        setTimeout(() => { window.location.href = '/workspace'; }, 600);
      } catch (err) {
        showMsg('Failed to connect to authentication server.', 'error');
      }
    }

    // 2. Send Verification OTP
    async function sendVerificationOTP(purpose) {
      const emailInput = isLoginMode ? document.getElementById('identifier') : document.getElementById('email');
      const email = emailInput ? emailInput.value.trim() : '';
      const btn = document.getElementById('btn-send-otp');
      const otpGroup = document.getElementById('otp-group');
      const hp_website = document.getElementById('hp_website').value;

      if (!email || !email.includes('@')) {
        showMsg('Please enter a valid email address first.', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const res = await fetch('/api/auth/email-otp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, purpose, turnstileToken, hp_website })
        });
        const data = await res.json();

        if (!res.ok) {
          showMsg(data.error || 'Failed to send OTP.', 'error');
          btn.disabled = false;
          btn.textContent = 'Send OTP';
          return;
        }

        isOtpSent = true;
        otpGroup.style.display = 'block';
        showMsg('✅ Verification code sent to ' + email + '. Check inbox and spam.', 'success');
        
        // Update submit button text in signup
        if (!isLoginMode) {
          document.getElementById('btn-submit').textContent = 'Create Account';
        }

        // Countdown timer for 30s
        let count = 30;
        const interval = setInterval(() => {
          btn.textContent = count + 's';
          count--;
          if (count < 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.textContent = 'Resend OTP';
          }
        }, 1000);

      } catch (err) {
        showMsg('Network error while requesting code.', 'error');
        btn.disabled = false;
        btn.textContent = 'Send OTP';
      }
    }

    // 3. Toggle OTP Login Mode
    function toggleOtpMode() {
      const isOtp = document.getElementById('chk-otp-mode').checked;
      const passGroup = document.getElementById('password-group');
      const otpGroup = document.getElementById('otp-group');
      const sendOtpBtn = document.getElementById('btn-send-otp');

      if (isOtp) {
        passGroup.style.display = 'none';
        sendOtpBtn.style.display = 'block';
        document.getElementById('password').required = false;
      } else {
        passGroup.style.display = 'block';
        sendOtpBtn.style.display = 'none';
        otpGroup.style.display = 'none';
        document.getElementById('password').required = true;
      }
    }

    // 4. Form Submission
    async function handleFormSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-submit');
      const hp_website = document.getElementById('hp_website').value;

      btn.disabled = true;
      btn.textContent = 'Verifying...';

      if (!isLoginMode) {
        // Register flow
        const username = document.getElementById('username').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const emailOtp = document.getElementById('otp').value.trim();

        if (!isOtpSent || !emailOtp) {
          showMsg('Please click Send OTP and enter the code sent to your email.', 'error');
          btn.disabled = false;
          btn.textContent = 'Create Account';
          return;
        }

        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, emailOtp, turnstileToken, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Registration failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Account';
            return;
          }

          showMsg('Account created & email verified! Redirecting...', 'success');
          setTimeout(() => { window.location.href = '/workspace'; }, 800);
        } catch (err) {
          showMsg('Network error.', 'error');
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      } else {
        // Login flow
        const identifier = document.getElementById('identifier').value.trim();
        const isOtp = document.getElementById('chk-otp-mode').checked;
        const password = document.getElementById('password').value;
        const emailOtp = isOtp ? document.getElementById('otp').value.trim() : undefined;

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password, emailOtp, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Sign in failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Sign In';
            return;
          }

          showMsg('Login successful! Redirecting...', 'success');
          setTimeout(() => { window.location.href = '/workspace'; }, 600);
        } catch (err) {
          showMsg('Network error.', 'error');
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
      }
    }

    function showMsg(text, type) {
      const el = document.getElementById('msg');
      el.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
      el.textContent = text;
      el.style.display = 'block';
    }
  </script>
</body>
</html>`;
}
