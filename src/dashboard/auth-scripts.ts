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
    const isLoginMode = ${isLogin};
    const turnstileSiteKey = "${turnstileSiteKey}";

    // Initialize Cloudflare Turnstile
    window.onTurnstileSuccess = function(token) {
      turnstileToken = token;
    };

    window.onloadTurnstileCallback = function() {
      const container = document.getElementById("turnstile-container");
      if (container && typeof turnstile !== "undefined" && turnstileSiteKey) {
        if (!container.hasChildNodes()) {
          try {
            turnstile.render("#turnstile-container", {
              sitekey: turnstileSiteKey,
              theme: "dark",
              callback: function(token) {
                turnstileToken = token;
              },
              "error-callback": function(code) {
                console.warn("Turnstile notice:", code);
              }
            });
          } catch (e) {
            console.warn("Turnstile initialization notice:", e);
          }
        }
      }
    };

    if (typeof turnstile !== "undefined") {
      window.onloadTurnstileCallback();
    }

    window.addEventListener("DOMContentLoaded", () => {
      if (typeof turnstile !== "undefined") {
        window.onloadTurnstileCallback();
      }
      const urlParams = new URLSearchParams(window.location.search);
      const urlErr = urlParams.get('error');
      if (urlErr) {
        showMsg(decodeURIComponent(urlErr), 'error');
      }
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

    // 1b. Interactive Google Sign-In (Token Client / Prompt)
    function initiateGoogleLogin() {
      showMsg('Connecting to Google...', 'success');
      const gClientEl = document.getElementById('g_id_onload');
      const gClientId = (gClientEl && gClientEl.getAttribute('data-client_id')) || '685823552970-phqjqt3cc613h69kat0rljbaikf8k6kd.apps.googleusercontent.com';

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
          console.warn('OAuth2 client init exception:', e);
        }
      }

      if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
        google.accounts.id.prompt();
      } else {
        showMsg('Google Sign-In is blocked by browser shields or extensions. Please allow accounts.google.com or use Email OTP / GitHub login.', 'error');
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
            body: JSON.stringify({ email, emailOtp, newPassword, turnstileToken, hp_website })
          });
          const data = await res.json();

          if (!res.ok) {
            showMsg(data.error || 'Password reset failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Reset Password';
            return;
          }

          showMsg(data.message || 'Password reset successfully! You can now sign in.', 'success');
          document.getElementById('password').value = newPassword;
          toggleResetPasswordMode();
          btn.disabled = false;
          btn.textContent = 'Sign In';
        } catch (err) {
          showMsg('Network error while resetting password.', 'error');
          btn.disabled = false;
          btn.textContent = 'Reset Password';
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
    }`;
}
