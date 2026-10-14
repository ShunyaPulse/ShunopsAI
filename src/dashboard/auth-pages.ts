import { AUTH_PAGE_STYLES } from "./auth-styles.js";
import { authPageScripts } from "./auth-scripts.js";

import * as dotenv from "dotenv";
dotenv.config();

/**
 * Authentication HTML pages (Login & Register).
 * Matches the Kanban-Cloud production UI and security features:
 * - Google Sign-In button (GSI + OAuth2 Redirect fallback)
 * - Email + OTP registration / login / password reset
 * - Username + Password registration with required Email OTP verification
 * - Cloudflare Turnstile bot verification with interactive WebCrypto Bot-Shield fallback
 * - Honeypot traps
 *
 * The stylesheet and client script live in `auth-styles.ts` / `auth-scripts.ts`
 * so the markup here stays reviewable in isolation.
 */
export function getAuthPageHtml(mode: "login" | "register"): string {
  const isLogin = mode === "login";
  const title = isLogin ? "Welcome back" : "Create verified private workspace";
  const googleClientId =
    process.env.GOOGLE_CLIENT_ID ||
    "685823552970-phqjqt3cc613h69kat0rljbaikf8k6kd.apps.googleusercontent.com";
  const turnstileSiteKey =
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    "0x4AAAAAAFVaFzGbMCgv2_Kr";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isLogin ? "Sign In" : "Sign Up"} • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    window.turnstileToken = "";
    window.turnstileLoaded = false;
    function onTurnstileSuccess(token) {
      window.turnstileToken = token;
      window.turnstileLoaded = true;
      var fb = document.getElementById("shunops-captcha-fallback");
      if (fb) fb.style.display = "none";
    }
    function onTurnstileExpired() {
      window.turnstileToken = "";
    }
    function onTurnstileError(errCode) {
      console.warn("Cloudflare Turnstile notice (activating interactive Bot-Shield):", errCode);
      if (typeof window.activateFallbackCaptcha === "function") {
        window.activateFallbackCaptcha();
      }
    }
  </script>
  <!-- Google Sign-In SDK -->
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <!-- Cloudflare Turnstile SDK (Required for Login, Signup, OTP, and Password Reset) -->
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
${AUTH_PAGE_STYLES}
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-header">
      <div class="brand-title">ShunopsAI</div>
      <div class="brand-subtitle">${title}</div>
      ${
        !isLogin
          ? `
      <div class="models-highlight">
        <div class="models-badge">⚡ Multi-Model Intelligence</div>
        <p class="models-text">
          Chat with <strong>Gemini 3.8 Flash</strong>, <strong>GPT-4o</strong>, <strong>Groq 120B</strong>, <strong>Nemotron 550B</strong>, and <strong>14 other frontier models</strong> &mdash; unified in one workspace.
        </p>
      </div>`
          : ""
      }
    </div>

    <div class="oauth-section">
      <div id="g_id_onload"
           data-client_id="${googleClientId}"
           data-callback="handleGoogleCallback"
           data-auto_prompt="false">
      </div>
      <button type="button" id="btn-google-login" class="oauth-btn google-oauth-btn" onclick="initiateGoogleLogin()">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <span>${isLogin ? "Sign in" : "Sign up"} with Google</span>
      </button>

      <a href="/api/auth/github" class="oauth-btn github-oauth-btn">
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
      <!-- Sign In / Password Reset Form -->
      <div class="form-group">
        <label for="identifier" id="identifier-label">Email Address or Username</label>
        <div class="input-row">
          <input type="text" id="identifier" required autocomplete="username" placeholder="you@example.com" />
          <button type="button" id="btn-send-otp" class="btn-secondary" style="display:none;" onclick="sendVerificationOTP(isResetPasswordMode ? 'reset' : 'login')">Send OTP</button>
        </div>
      </div>

      <div class="form-group" id="password-group">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label for="password" id="password-label">Password</label>
          <a href="#" id="forgot-password-link" onclick="toggleResetPasswordMode(event)" style="font-size:11.5px; color:#38bdf8; text-decoration:none;">Forgot password?</a>
        </div>
        <input type="password" id="password" autocomplete="current-password" placeholder="••••••••" />
      </div>

      <div class="form-group" id="otp-group" style="display:none;">
        <label for="otp">Email OTP Code (6-Digits)</label>
        <input type="text" id="otp" maxlength="6" placeholder="123456" autocomplete="one-time-code" style="font-family: monospace; letter-spacing: 4px; font-weight: 700;" />
      </div>

      <div class="form-group" id="new-password-group" style="display:none;">
        <label for="new-password">New Password (min 8 chars)</label>
        <input type="password" id="new-password" minlength="8" autocomplete="new-password" placeholder="Enter your new password" />
      </div>

      <div class="toggle-row" id="otp-toggle-row">
        <input type="checkbox" id="chk-otp-mode" onchange="toggleOtpMode()" />
        <label for="chk-otp-mode" style="margin:0; cursor:pointer;">Sign in with Email OTP Code instead</label>
      </div>
      `
      }

      <!-- Cloudflare Turnstile & Interactive Bot-Shield Captcha -->
      <div class="turnstile-box">
        <div class="cf-turnstile" id="turnstile-widget" data-sitekey="${turnstileSiteKey}" data-theme="dark" data-callback="onTurnstileSuccess" data-expired-callback="onTurnstileExpired" data-error-callback="onTurnstileError"></div>
        <!-- Always-visible interactive Captcha card (auto-hides if Cloudflare Turnstile iframe mounts & succeeds) -->
        <div id="shunops-captcha-fallback" class="captcha-fallback-card" onclick="triggerInteractiveCaptchaSolve()">
          <div class="captcha-fallback-left">
            <div id="captcha-checkbox-box" class="captcha-checkbox">
              <div id="captcha-spinner" class="captcha-spinner" style="display:none;"></div>
              <svg id="captcha-check-icon" viewBox="0 0 24 24" width="18" height="18" style="display:none; color:#10b981;">
                <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
            <span id="captcha-status-label" class="captcha-label">Verify you are human</span>
          </div>
          <div class="captcha-fallback-right">
            <div class="captcha-brand">🛡️ Bot Shield</div>
            <div class="captcha-sub">Cloudflare • WebCrypto</div>
          </div>
        </div>
      </div>

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
    <div style="margin-top:18px; font-size:11px; text-align:center; color:#64748b;">
      <a href="/privacy" style="color:#64748b; text-decoration:none;">Privacy Policy</a> &bull;
      <a href="/terms" style="color:#64748b; text-decoration:none;">Terms of Service</a> &bull;
      <a href="/about" style="color:#64748b; text-decoration:none;">About</a>
    </div>
  </div>

  <script>
${authPageScripts(isLogin, turnstileSiteKey)}
  </script>
</body>
</html>`;
}
