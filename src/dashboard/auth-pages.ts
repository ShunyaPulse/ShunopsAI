import { AUTH_PAGE_STYLES } from "./auth-styles.js";
import { authPageScripts } from "./auth-scripts.js";

/**
 * Authentication HTML pages (Login & Register).
 * Matches the Kanban-Cloud production UI and security features:
 * - Google Sign-In button
 * - Email + OTP registration / login
 * - Username + Password registration with required Email OTP verification
 * - Cloudflare Turnstile bot verification
 * - Client-side WebCrypto Proof-of-Work solver
 * - Honeypot traps
 *
 * The stylesheet and client script live in `auth-styles.ts` / `auth-scripts.ts`
 * so the markup here stays reviewable in isolation.
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
  ${!isLogin ? '<!-- Cloudflare Turnstile SDK -->\n  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ""}
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
      ${!isLogin ? '<div class="turnstile-box" id="turnstile-container"></div>' : ""}

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
