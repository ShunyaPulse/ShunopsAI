/**
 * Client-side JavaScript for the login / register pages (`auth-pages.ts`).
 *
 * Parameterized by the page mode and the Turnstile site key, because both are
 * interpolated into the script that runs in the browser.
 */
export function authPageScripts(isLogin: boolean, turnstileSiteKey: string): string {
  return `    let turnstileToken = "";
    let isOtpSent = false;
    let isResetPasswordMode = false;
    let isSolvingPow = false;
    const isLoginMode = ${isLogin};
    const turnstileSiteKey = "${turnstileSiteKey}";

    // 0. Interactive WebCrypto Bot-Shield Captcha Solver (Guarantees visible, working Captcha
    // even if Cloudflare Turnstile encounters a domain mismatch 110200 or network block)
    async function solveShieldPoW(challenge) {
      if (!challenge || !window.crypto || !window.crypto.subtle) return null;
      const enc = new TextEncoder();
      const targetDifficulty = challenge.targetDifficulty || 2;
      const targetPrefix = '0'.repeat(targetDifficulty);
      let nonce = 0;
      while (nonce < 200000) {
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
            solution: String(nonce)
          };
        }
        nonce++;
      }
      return null;
    }

    async function triggerInteractiveCaptchaSolve(silent) {
      if (isSolvingPow) return turnstileToken || window.turnstileToken || "";
      isSolvingPow = true;

      const box = document.getElementById('captcha-checkbox-box');
      const spinner = document.getElementById('captcha-spinner');
      const checkIcon = document.getElementById('captcha-check-icon');
      const label = document.getElementById('captcha-status-label');

      if (box) box.classList.remove('verified');
      if (checkIcon) checkIcon.style.display = 'none';
      if (spinner) spinner.style.display = 'block';
      if (label && !silent) label.textContent = 'Verifying browser security...';

      try {
        const res = await fetch('/api/shield/challenge');
        if (res.ok) {
          const challenge = await res.json();
          const solved = await solveShieldPoW(challenge);
          if (solved) {
            const powToken = 'pow:' + JSON.stringify(solved);
            // Only overwrite if native Cloudflare Turnstile hasn't set a token
            const hiddenInput = document.querySelector('input[name="cf-turnstile-response"]');
            if (!hiddenInput || !hiddenInput.value) {
              turnstileToken = powToken;
              window.turnstileToken = powToken;
            }
            if (spinner) spinner.style.display = 'none';
            if (checkIcon) checkIcon.style.display = 'block';
            if (box) box.classList.add('verified');
            if (label) label.textContent = 'Verified human';
            isSolvingPow = false;
            return powToken;
          }
        }
      } catch (e) {
        console.warn('Shield challenge error:', e);
      }

      if (spinner) spinner.style.display = 'none';
      if (label) label.textContent = 'Click to verify you are human';
      isSolvingPow = false;
      return "";
    }

    window.activateFallbackCaptcha = function() {
      const fb = document.getElementById('shunops-captcha-fallback');
      if (fb) fb.style.display = 'flex';
      triggerInteractiveCaptchaSolve(true);
    };

    // Initialize Cloudflare Turnstile callbacks
    window.onTurnstileSuccess = function(token) {
      turnstileToken = token;
      window.turnstileToken = token;
      window.turnstileLoaded = true;
      const fb = document.getElementById('shunops-captcha-fallback');
      if (fb) fb.style.display = 'none';
    };

    async function ensureCaptchaToken() {
      const hiddenInput = document.querySelector('input[name="cf-turnstile-response"]');
      const existing = (hiddenInput && hiddenInput.value) || turnstileToken || window.turnstileToken || "";
      if (existing) return existing;
      return await triggerInteractiveCaptchaSolve(false);
    }

    async function refreshCaptchaAfterStep() {
      turnstileToken = "";
      window.turnstileToken = "";
      if (typeof turnstile !== "undefined" && turnstile.reset) {
        try { turnstile.reset(); } catch (e) {}
      }
      // Immediately mint a fresh single-use PoW token in the background so multi-step
      // flows (Send OTP -> Create Account / Reset Password) never reuse a consumed token
      await triggerInteractiveCaptchaSolve(true);
    }

    window.addEventListener("DOMContentLoaded", async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlErr = urlParams.get('error');
      if (urlErr) {
        showMsg(decodeURIComponent(urlErr), 'error');
      }

      // Handle Google OAuth2 redirect hash (#access_token=...) when fallback redirect flow is used
      if (window.location.hash && window.location.hash.includes('access_token=')) {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hashParams.get('access_token');
        if (accessToken) {
          window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
          showMsg('Verifying Google credentials...', 'success');
          try {
            const res = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ access_token: accessToken })
            });
            const data = await res.json();
            if (res.ok) {
              showMsg('Login successful! Redirecting...', 'success');
              setTimeout(() => { window.location.href = '/workspace'; }, 500);
              return;
            } else {
              showMsg(data.error || 'Google login failed.', 'error');
            }
          } catch (e) {
            showMsg('Failed to connect to authentication server.', 'error');
          }
        }
      }

      // Pre-solve interactive captcha on load so the user sees the verified checkbox immediately
      triggerInteractiveCaptchaSolve(true);
    });

    // 1. Google OAuth Callback (One-Tap / GSI)
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

    // 1b. Interactive Google Sign-In (Token Client Popup + Standard OAuth2 Redirect Fallback)
    async function initiateGoogleLogin() {
      showMsg('Connecting to Google...', 'success');
      const gClientEl = document.getElementById('g_id_onload');
      const gClientId = (gClientEl && gClientEl.getAttribute('data-client_id')) || '685823552970-phqjqt3cc613h69kat0rljbaikf8k6kd.apps.googleusercontent.com';

      // Wait up to 1.2s if Google GSI script is still downloading
      for (let i = 0; i < 8; i++) {
        if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) {
        try {
          const client = google.accounts.oauth2.initTokenClient({
            client_id: gClientId,
            scope: 'email profile openid',
            callback: async (tokenResponse) => {
              if (tokenResponse && tokenResponse.access_token) {
                showMsg('Verifying Google credentials...', 'success');
                try {
                  const res = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_token: tokenResponse.access_token })
                  });
                  const data = await res.json();
                  if (res.ok) {
                    showMsg('Login successful! Redirecting...', 'success');
                    setTimeout(() => { window.location.href = '/workspace'; }, 600);
                  } else {
                    showMsg(data.error || 'Google login failed.', 'error');
                  }
                } catch (e) {
                  showMsg('Authentication server connection error.', 'error');
                }
              }
            }
          });
          client.requestAccessToken();
          return;
        } catch (e) {
          console.warn('OAuth2 client init exception, using redirect fallback:', e);
        }
      }

      // Standard Google OAuth 2.0 Web Redirect Fallback (works even when third-party scripts/popups are blocked)
      const redirectUri = window.location.origin + window.location.pathname;
      const oauthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(gClientId) +
        '&redirect_uri=' + encodeURIComponent(redirectUri) +
        '&response_type=token' +
        '&scope=' + encodeURIComponent('openid email profile') +
        '&prompt=select_account';
      window.location.href = oauthUrl;
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

      const token = await ensureCaptchaToken();

      try {
        const res = await fetch('/api/auth/email-otp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, purpose, turnstileToken: token, hp_website })
        });
        const data = await res.json();

        // Always refresh the single-use captcha token after an OTP request
        await refreshCaptchaAfterStep();

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
        await refreshCaptchaAfterStep();
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

    // 3b. Toggle Forgotten Password Reset Mode
    function toggleResetPasswordMode(e) {
      if (e) e.preventDefault();
      isResetPasswordMode = !isResetPasswordMode;

      const passGroup = document.getElementById('password-group');
      const otpGroup = document.getElementById('otp-group');
      const newPassGroup = document.getElementById('new-password-group');
      const sendOtpBtn = document.getElementById('btn-send-otp');
      const otpToggleRow = document.getElementById('otp-toggle-row');
      const idLabel = document.getElementById('identifier-label');
      const submitBtn = document.getElementById('btn-submit');
      const chkOtp = document.getElementById('chk-otp-mode');

      if (isResetPasswordMode) {
        if (chkOtp) chkOtp.checked = false;
        if (passGroup) passGroup.style.display = 'none';
        if (otpToggleRow) otpToggleRow.style.display = 'none';
        if (sendOtpBtn) sendOtpBtn.style.display = 'block';
        if (otpGroup) otpGroup.style.display = 'block';
        if (newPassGroup) newPassGroup.style.display = 'block';
        if (idLabel) idLabel.textContent = 'Account Email Address';
        if (submitBtn) submitBtn.textContent = 'Reset Password';
        document.getElementById('password').required = false;
        showMsg('Enter your email, click Send OTP, and choose a new password.', 'success');
      } else {
        if (passGroup) passGroup.style.display = 'block';
        if (otpToggleRow) otpToggleRow.style.display = 'flex';
        if (sendOtpBtn) sendOtpBtn.style.display = 'none';
        if (otpGroup) otpGroup.style.display = 'none';
        if (newPassGroup) newPassGroup.style.display = 'none';
        if (idLabel) idLabel.textContent = 'Email Address or Username';
        if (submitBtn) submitBtn.textContent = 'Sign In';
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

      const token = await ensureCaptchaToken();

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
            body: JSON.stringify({ username, email, password, emailOtp, turnstileToken: token, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Registration failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Account';
            await refreshCaptchaAfterStep();
            return;
          }

          showMsg('Account created & email verified! Redirecting...', 'success');
          setTimeout(() => { window.location.href = '/workspace'; }, 800);
        } catch (err) {
          showMsg('Network error.', 'error');
          btn.disabled = false;
          btn.textContent = 'Create Account';
          await refreshCaptchaAfterStep();
        }
      } else if (isResetPasswordMode) {
        // Forgotten Password Reset flow
        const email = document.getElementById('identifier').value.trim();
        const emailOtp = document.getElementById('otp').value.trim();
        const newPassword = document.getElementById('new-password').value;

        if (!email || !email.includes('@') || !emailOtp || !newPassword) {
          showMsg('Please enter your email, 6-digit OTP code, and a new password (min 8 chars).', 'error');
          btn.disabled = false;
          btn.textContent = 'Reset Password';
          return;
        }

        try {
          const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, emailOtp, newPassword, turnstileToken: token, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Password reset failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Reset Password';
            await refreshCaptchaAfterStep();
            return;
          }

          showMsg(data.message || 'Password reset successfully! You can now sign in.', 'success');
          document.getElementById('password').value = newPassword;
          toggleResetPasswordMode();
          btn.disabled = false;
          btn.textContent = 'Sign In';
          await refreshCaptchaAfterStep();
        } catch (err) {
          showMsg('Network error while resetting password.', 'error');
          btn.disabled = false;
          btn.textContent = 'Reset Password';
          await refreshCaptchaAfterStep();
        }
      } else {
        // Login flow
        const identifier = document.getElementById('identifier').value.trim();
        const isOtp = document.getElementById('chk-otp-mode').checked;
        const password = document.getElementById('password').value;
        const emailOtp = isOtp ? document.getElementById('otp').value.trim() : undefined;

        if (!token) {
          showMsg('Please click the security verification checkbox above before signing in.', 'error');
          btn.disabled = false;
          btn.textContent = 'Sign In';
          return;
        }

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password, emailOtp, turnstileToken: token, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Sign in failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Sign In';
            await refreshCaptchaAfterStep();
            return;
          }

          showMsg('Login successful! Redirecting...', 'success');
          setTimeout(() => { window.location.href = '/workspace'; }, 600);
        } catch (err) {
          showMsg('Network error.', 'error');
          btn.disabled = false;
          btn.textContent = 'Sign In';
          await refreshCaptchaAfterStep();
        }
      }
    }

    function showMsg(text, type) {
      const el = document.getElementById('msg');
      el.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
      el.textContent = text;
      el.style.display = 'block';
    }`;
}
