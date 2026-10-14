/**
 * Stylesheet for the login / register pages (`auth-pages.ts`).
 *
 * Kept as a plain string so the page stays a zero-build, single-response HTML
 * document, mirroring the `styles.ts` / `scripts.ts` split used by the dashboard.
 */
export const AUTH_PAGE_STYLES = `    :root {
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
    .models-highlight {
      margin-top: 14px;
      padding: 10px 14px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.07) 0%, rgba(139, 92, 246, 0.07) 100%);
      border: 1px solid rgba(56, 189, 248, 0.22);
      border-radius: 12px;
      text-align: center;
    }
    .models-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      padding: 2px 8px;
      border-radius: 12px;
      margin-bottom: 6px;
    }
    .models-text {
      font-size: 12.5px;
      line-height: 1.5;
      color: #cbd5e1;
      margin: 0;
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
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #f8fafc;
      font-size: 14px;
      font-weight: 500;
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
      min-height: 65px;
    }`;
