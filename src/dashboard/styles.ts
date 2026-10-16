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
      .container {
        grid-template-columns: 1fr;
        padding: 18px;
        gap: 20px;
      }
    }

    /* Mobile & Tablet Responsiveness */
    @media (max-width: 768px) {
      header {
        padding: 12px 16px;
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      .brand {
        justify-content: flex-start;
      }
      .brand-title {
        font-size: 17px;
      }
      .brand-subtitle {
        font-size: 10px;
      }
      .header-pills {
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-start;
      }
      .pill {
        padding: 5px 10px;
        font-size: 11px;
      }
      .container {
        padding: 12px;
        gap: 14px;
      }
      .panel {
        border-radius: 12px;
      }
      .panel-header {
        padding: 12px 14px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .panel-title {
        font-size: 14px;
      }
      .grid-cards {
        grid-template-columns: 1fr;
        padding: 12px;
        gap: 12px;
      }
      .banner-paused {
        flex-direction: column;
        text-align: center;
        gap: 8px;
        padding: 10px 14px;
        font-size: 12px;
      }
      .banner-paused button {
        margin-left: 0 !important;
      }
      .chat-container {
        height: clamp(480px, 70vh, 650px);
      }
      .chat-messages {
        padding: 12px 10px;
        font-size: 13px;
        gap: 10px;
      }
      .chat-bubble {
        max-width: 94%;
        padding: 10px 12px;
      }
      .chat-agent pre {
        -webkit-overflow-scrolling: touch;
        max-width: 100%;
      }
      .chat-input-bar {
        padding: 10px;
        gap: 8px;
      }
      .chat-input {
        font-size: 16px; /* Prevents auto-zoom on iOS */
        padding: 10px 12px;
      }
      .quick-pills {
        padding: 8px 12px;
        gap: 6px;
        -webkit-overflow-scrolling: touch;
      }
      #telemetry-stats-bar, #admin-stats-bar {
        gap: 10px 14px !important;
        padding: 10px 12px !important;
        font-size: 11px !important;
      }
      #telemetry-traces-container table, #users-table-container table {
        min-width: 520px;
      }
      #telemetry-traces-container, #users-table-container {
        -webkit-overflow-scrolling: touch;
      }
    }

    @media (max-width: 480px) {
      header {
        padding: 10px 12px;
        gap: 10px;
      }
      .brand-icon {
        width: 32px;
        height: 32px;
        font-size: 16px;
      }
      .brand-title {
        font-size: 15px;
      }
      .brand-subtitle {
        font-size: 9.5px;
      }
      .header-pills {
        gap: 6px;
      }
      .pill {
        padding: 4px 8px;
        font-size: 10.5px;
      }
      .btn {
        padding: 7px 12px;
        font-size: 11.5px;
      }
      .container {
        padding: 8px;
        gap: 12px;
      }
      .panel-header {
        padding: 10px 12px;
      }
      .service-card {
        padding: 12px;
      }
      .sc-metric {
        font-size: 16px;
      }
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
    .btn-danger {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #fff;
      border: 1px solid #f87171;
    }
    .btn-danger:hover {
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.5);
      background: linear-gradient(135deg, #dc2626, #b91c1c);
    }
    .btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      border: 1px solid #34d399;
    }
    .btn-success:hover {
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, #059669, #047857);
    }
    .banner-paused {
      background: linear-gradient(90deg, #7f1d1d, #991b1b, #7f1d1d);
      color: #fecaca;
      padding: 10px 24px;
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 4px 20px rgba(220, 38, 38, 0.35);
      animation: pulseAlert 2s infinite ease-in-out;
    }
    @keyframes pulseAlert {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.88; }
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
