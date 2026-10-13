import { DASHBOARD_STYLES } from "./styles.js";

/**
 * Stylesheet for the Assistant & Integrations settings portal (`portal.ts`).
 *
 * Composes the shared dashboard base with the portal-specific rules, kept as a
 * plain string so the page stays a zero-build, single-response HTML document.
 */
export const PORTAL_STYLES = `    ${DASHBOARD_STYLES}

    .portal-page-container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 20px 20px 50px;
      width: 100%;
    }

    .portal-hero {
      text-align: center;
      padding: 16px 16px 28px;
      max-width: 820px;
      margin: 0 auto;
    }
    .portal-hero h1 {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(90deg, #fff, #38bdf8, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    .portal-hero p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.6;
    }

    /* 2-column responsive layout */
    .portal-content-grid {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: 24px;
      align-items: start;
    }

    @media (max-width: 980px) {
      .portal-content-grid {
        grid-template-columns: 1fr;
      }
    }

    .service-selection-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .service-choice-card {
      background: #0f172a;
      border: 2px solid #1e293b;
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .service-choice-card:hover {
      border-color: #38bdf8;
      background: #111e38;
      transform: translateY(-1px);
    }
    .service-choice-card.selected {
      border-color: #00f0ff;
      background: #101c38;
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.12);
    }
    .service-choice-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .custom-checkbox {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      border: 2px solid #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .service-choice-card.selected .custom-checkbox {
      background: #00f0ff;
      border-color: #00f0ff;
      color: #000;
    }

    .key-config-panel {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 24px;
    }

    .security-status-banner {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(14, 165, 233, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .key-input-group {
      margin-bottom: 16px;
      padding: 14px;
      background: #0f172a;
      border-radius: 10px;
      border: 1px solid #1e293b;
      position: relative;
    }
    .key-label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .direct-link-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 11px;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.2s;
    }
    .direct-link-badge:hover {
      background: #38bdf8;
      color: #000;
    }

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }
    .password-input-wrapper input {
      width: 100%;
      padding-right: 40px !important;
    }
    .eye-toggle-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .eye-toggle-btn:hover {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
    }
    .eye-toggle-btn svg {
      width: 17px;
      height: 17px;
      pointer-events: none;
    }

    .verify-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 10px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
    }
    .verify-badge.success {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .verify-badge.error {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Modal */
    .security-modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .security-modal-card {
      background: #0f172a;
      border: 1px solid #38bdf8;
      border-radius: 14px;
      max-width: 600px;
      width: 100%;
      padding: 26px;
      box-shadow: 0 16px 40px rgba(0, 240, 255, 0.15);
      max-height: 90vh;
      overflow-y: auto;
    }
    .security-modal-card h3 {
      font-size: 18px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .audit-point {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
    }
    .audit-point-icon {
      font-size: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .audit-point-text strong {
      display: block;
      color: #38bdf8;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .audit-point-text p {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
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
    }`;
