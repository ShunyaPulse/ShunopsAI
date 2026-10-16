export const AUTH_PAGE_STYLES = `    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: rgba(255, 255, 255, 0.1);
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent-blue: #38bdf8;
      --accent-green: #10b981;
      --danger: #ef4444;
    }
    body {
      margin: 0;
      padding: 20px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e293b 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .auth-container {
      width: 100%;
      max-width: 430px;
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .auth-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 6px;
    }
    .brand-subtitle {
      font-size: 13px;
      color: var(--muted);
    }
    .models-highlight {
      margin-top: 14px;
      padding: 12px 14px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(16, 185, 129, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 12px;
      text-align: center;
    }
    .models-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      padding: 3px 8px;
      border-radius: 999px;
      margin-bottom: 6px;
    }
    .models-text {
      margin: 0;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .models-text strong {
      color: #ffffff;
      font-weight: 600;
    }
    .oauth-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 600;
      text-decoration: none;
      padding: 10px 16px;
      box-sizing: border-box;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, border-color 0.15s;
    }
    .oauth-btn:hover {
      background: #334155;
      border-color: rgba(255, 255, 255, 0.25);
    }
    .google-oauth-btn {
      margin-bottom: 10px;
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 20px 0;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--border);
    }
    .divider:not(:empty)::before { margin-right: 12px; }
    .divider:not(:empty)::after { margin-left: 12px; }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #cbd5e1;
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    input[type="text"], input[type="email"], input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      background: rgba(2, 6, 23, 0.7);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: var(--accent-blue);
    }
    .btn-secondary {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent-blue);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 8px;
      padding: 0 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-secondary:hover:not(:disabled) {
      background: rgba(56, 189, 248, 0.25);
    }
    .btn-secondary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-primary {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #022c22;
      font-weight: 700;
      font-size: 14px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.2s, transform 0.1s;
    }
    .btn-primary:hover:not(:disabled) {
      opacity: 0.95;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin: 14px 0 10px;
      min-height: 65px;
      width: 100%;
    }
    .captcha-fallback-card {
      width: 100%;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      padding: 12px 16px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      transition: border-color 0.2s, background 0.2s;
    }
    .captcha-fallback-card:hover {
      border-color: rgba(56, 189, 248, 0.45);
      background: #243247;
    }
    .captcha-fallback-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .captcha-checkbox {
      width: 24px;
      height: 24px;
      border: 2px solid #64748b;
      border-radius: 5px;
      background: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s, background 0.2s;
    }
    .captcha-checkbox.verified {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.15);
    }
    .captcha-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #38bdf8;
      border-top-color: transparent;
      border-radius: 50%;
      animation: captchaSpin 0.7s linear infinite;
    }
    @keyframes captchaSpin {
      to { transform: rotate(360deg); }
    }
    .captcha-label {
      font-size: 13px;
      font-weight: 500;
      color: #f8fafc;
    }
    .captcha-fallback-right {
      text-align: right;
    }
    .captcha-brand {
      font-size: 11px;
      font-weight: 700;
      color: #cbd5e1;
    }
    .captcha-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-top: 2px;
    }
    /* Mobile Responsiveness */
    @media (max-width: 480px) {
      body {
        padding: 12px 8px;
      }
      .auth-container {
        padding: 22px 16px;
        border-radius: 14px;
        box-shadow: 0 15px 35px -8px rgba(0, 0, 0, 0.7);
      }
      .brand-title {
        font-size: 22px;
      }
      .brand-subtitle {
        font-size: 12px;
      }
      input[type="text"], input[type="email"], input[type="password"] {
        font-size: 16px !important; /* Prevents auto-zoom on iOS Safari */
        padding: 11px 12px;
      }
      .input-row {
        gap: 6px;
      }
      .btn-secondary {
        padding: 0 10px;
        font-size: 11.5px;
      }
      .oauth-btn {
        font-size: 13px;
        padding: 10px 12px;
      }
      .btn-primary {
        font-size: 14px;
        padding: 12px;
        min-height: 44px;
      }
    }
`;
