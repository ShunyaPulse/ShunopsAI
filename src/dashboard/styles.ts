/**
 * Static stylesheet for the ShunopsAI Command Center dashboard.
 */
export const DASHBOARD_STYLES = `
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --accent: #00f0ff;
      --accent-glow: rgba(0, 240, 255, 0.25);
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --code-font: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00f0ff, #3b82f6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #fff, #00f0ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-subtitle {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .header-pills {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .pill {
      background: #1e293b;
      border: 1px solid var(--card-border);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--code-font);
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 440px;
      gap: 24px;
      flex: 1;
    }
    @media (max-width: 1024px) {
      .container { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }
    .panel-title {
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      background: linear-gradient(135deg, #00f0ff, #2563eb);
      color: #000;
      font-weight: 700;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover {
      box-shadow: 0 0 15px var(--accent-glow);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: #334155;
      color: #fff;
    }
    .grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      padding: 20px;
    }
    .service-card {
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      transition: border-color 0.2s;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .service-card:hover {
      border-color: var(--accent);
    }
    .sc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .sc-title {
      font-size: 14px;
      font-weight: 600;
    }
    .sc-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      font-family: var(--code-font);
      font-weight: 600;
    }
    .badge-ok { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid var(--green); }
    .badge-down { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid var(--red); }
    .badge-deg { background: rgba(245, 158, 11, 0.15); color: var(--yellow); border: 1px solid var(--yellow); }
    .sc-body {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--code-font);
      line-height: 1.5;
    }
    .sc-metric {
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      margin: 6px 0;
    }
    /* Chat & Terminal */
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 650px;
    }
    .chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 13px;
    }
    .chat-bubble {
      padding: 12px 16px;
      border-radius: 10px;
      max-width: 88%;
      line-height: 1.5;
      word-break: break-word;
    }
    .chat-user {
      align-self: flex-end;
      background: #1e3a8a;
      color: #fff;
      border-bottom-right-radius: 2px;
    }
    .chat-agent {
      align-self: flex-start;
      background: #111c30;
      border: 1px solid var(--card-border);
      color: var(--text);
      border-bottom-left-radius: 2px;
    }
    .chat-agent pre {
      background: #090d16;
      padding: 10px;
      border-radius: 6px;
      margin-top: 8px;
      overflow-x: auto;
      font-family: var(--code-font);
      font-size: 12px;
      border: 1px solid #1e293b;
    }
    .chat-input-bar {
      padding: 14px;
      border-top: 1px solid var(--card-border);
      background: rgba(0, 0, 0, 0.2);
      display: flex;
      gap: 10px;
    }
    .chat-input {
      flex: 1;
      background: #090d16;
      border: 1px solid var(--card-border);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .chat-input:focus {
      border-color: var(--accent);
    }
    .quick-pills {
      display: flex;
      gap: 8px;
      padding: 10px 16px;
      background: #0a101d;
      border-top: 1px solid var(--card-border);
      overflow-x: auto;
      white-space: nowrap;
    }
    .qp-btn {
      background: #162032;
      border: 1px solid var(--card-border);
      color: #93c5fd;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .qp-btn:hover {
      background: #1e293b;
      border-color: var(--accent);
      color: #fff;
    }
  `;
