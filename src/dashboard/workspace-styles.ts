/**
 * Stylesheet for the multi-tenant user workspace page (`workspace.ts`).
 *
 * Kept as a plain string so the page stays a zero-build, single-response HTML
 * document, mirroring the `styles.ts` / `scripts.ts` split used by the dashboard.
 */
export const WORKSPACE_STYLES = `    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --text: #f8fafc;
      --muted: #94a3b8;
      --green: #10b981;
      --danger: #ef4444;
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
      max-width: 1440px;
      width: 100%;
      margin: 20px auto;
      padding: 0 20px;
      flex: 1;
    }
    .welcome-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px 24px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      flex-wrap: wrap;
      gap: 14px;
    }
    .welcome-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 2px;
      color: #fff;
    }
    .welcome-desc {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
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
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 1080px) {
      .grid {
        grid-template-columns: 1fr;
        gap: 20px;
      }
    }
    .box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      margin-bottom: 20px;
    }
    .box:last-child {
      margin-bottom: 0;
    }
    .box-hero {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 24px 28px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      min-height: 720px;
      margin-bottom: 0;
    }
    .workspace-sidebar {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .box-sidebar {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 16px 18px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      margin-bottom: 0;
    }
    .box-sidebar h2 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .box-sidebar p {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.45;
      margin-bottom: 12px;
    }
    .box h2 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .box p {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 14px;
    }

    /* Chat thread & message bubbles */
    .chat-thread-container {
      flex: 1;
      min-height: 520px;
      height: calc(100vh - 440px);
      max-height: 720px;
      overflow-y: auto;
      padding: 20px 22px;
      background: #060911;
      border: 1px solid #1e293b;
      border-radius: 14px;
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }
    .chat-thread-container::-webkit-scrollbar {
      width: 6px;
    }
    .chat-thread-container::-webkit-scrollbar-thumb {
      background: #1e293b;
      border-radius: 3px;
    }

    .msg-bubble {
      padding: 12px 18px;
      font-size: 13.5px;
      line-height: 1.6;
      word-break: break-word;
      animation: fadeIn 0.15s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .msg-user {
      align-self: flex-end;
      max-width: 78%;
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      color: #fff;
      border-radius: 16px 16px 4px 16px;
      box-shadow: 0 2px 10px rgba(37, 99, 235, 0.25);
    }
    .msg-assistant {
      align-self: flex-start;
      max-width: 90%;
      background: #0d1322;
      border: 1px solid #1e293b;
      color: #e2e8f0;
      border-radius: 16px 16px 16px 4px;
    }
    .msg-header {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .msg-user .msg-header {
      color: #bfdbfe;
      justify-content: flex-end;
    }
    .msg-assistant .msg-header {
      color: #38bdf8;
    }
    .msg-body {
      white-space: pre-wrap;
    }

    .thinking-bubble {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #94a3b8;
      font-size: 12px;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 14px 14px 14px 4px;
      align-self: flex-start;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      animation: pulse 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1.1); opacity: 1; }
    }

    .chat-input-wrapper {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 6px 8px 6px 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .chat-input-wrapper:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
    }
    .attach-plus-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      padding: 0;
    }
    .attach-plus-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      transform: scale(1.05);
    }
    .attach-plus-btn:active {
      transform: scale(0.95);
    }
    .chat-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      outline: none;
      font-size: 14.5px;
      font-family: inherit;
    }
    .chat-send-btn {
      background: var(--accent);
      color: #000;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .chat-send-btn:hover {
      background: #7dd3fc;
      transform: translateY(-1px);
    }
    .chat-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .chat-send-btn.generating {
      background: #ef4444;
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      opacity: 1;
      padding: 9px 15px;
    }
    .chat-send-btn.generating:hover {
      background: #dc2626;
      transform: translateY(-1px);
    }
    .stop-square {
      width: 9px;
      height: 9px;
      background: #ffffff;
      border-radius: 2px;
      display: inline-block;
      flex-shrink: 0;
    }

    .quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      padding: 4px 10px;
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
    .btn-sub {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: #cbd5e1;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.15s;
    }
    .btn-sub:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    /* Modal styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(3, 7, 18, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
      padding: 16px;
    }
    .modal-overlay.active {
      opacity: 1;
      visibility: visible;
    }
    .modal-dialog {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 18px;
      max-width: 580px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(56, 189, 248, 0.1);
      transform: translateY(15px) scale(0.98);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-dialog.mcp-modal-dialog {
      max-width: 1100px !important;
      width: 95vw !important;
      max-height: 88vh !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
    }
    .mcp-modal-body {
      padding: 18px 22px !important;
      overflow-y: auto !important;
      flex: 1 !important;
    }
    .mcp-card {
      background: #060a12;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
      transition: all 0.2s ease;
    }
    .mcp-card:hover {
      border-color: #38bdf8;
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    }
    .modal-overlay.active .modal-dialog {
      transform: translateY(0) scale(1);
    }
    .modal-header {
      padding: 18px 22px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      background: #0b1120;
      z-index: 2;
    }
    .modal-header h2 {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .modal-close-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      transition: all 0.15s;
    }
    .modal-close-btn:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
      color: #f87171;
    }
    .modal-body {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .modal-section-card {
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 16px;
    }

    /* Standard Code Snippet Component */
    .code-snippet-box {
      background: #050811;
      border: 1px solid #1e293b;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .code-snippet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0b1120;
      padding: 7px 12px;
      border-bottom: 1px solid #1e293b;
    }
    .code-snippet-lang {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.5px;
      font-family: 'JetBrains Mono', monospace;
    }
    .code-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
    }
    .copy-code-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .copy-code-btn:hover {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }
    .copy-code-btn.copied {
      background: rgba(16, 185, 129, 0.15);
      border-color: #10b981;
      color: #10b981;
    }
    .code-snippet-content {
      margin: 0;
      padding: 12px 14px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      line-height: 1.6;
      color: #38bdf8;
      background: #030712;
      white-space: nowrap;
    }
    .code-snippet-content::-webkit-scrollbar {
      height: 5px;
    }
    .code-snippet-content::-webkit-scrollbar-thumb {
      background: #1e293b;
      border-radius: 3px;
    }
    .code-snippet-content code {
      font-family: inherit;
    }

    .footer {
      max-width: 1440px;
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
    }`;
