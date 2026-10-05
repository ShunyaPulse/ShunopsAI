(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__CF_AGENT_WIDGET_LOADED__) return;
  window.__CF_AGENT_WIDGET_LOADED__ = true;

  // Resolve configuration from script element attributes
  const currentScript =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"]');
  const apiUrl =
    currentScript?.getAttribute('data-api-url') ||
    window.location.origin;
  const widgetTitle =
    currentScript?.getAttribute('data-title') || 'Edge AI Command Engine';
  const welcomeMessage =
    currentScript?.getAttribute('data-welcome') ||
    'Hello! I am your Edge AI Assistant powered by Cloudflare Workers. I can answer inquiries or execute commands (booking, tracking, lead capture, and system actions). How can I assist you?';
  const siteKey = currentScript?.getAttribute('data-turnstile-sitekey') || '';

  // Local storage session key
  const STORAGE_KEY = 'cf_edge_agent_session_id';
  let sessionId = localStorage.getItem(STORAGE_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEY, sessionId);
  }

  // Inject Stylesheet
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :root {
      --cf-primary: #3b82f6;
      --cf-primary-hover: #2563eb;
      --cf-bg: #090d16;
      --cf-card-bg: rgba(15, 23, 42, 0.85);
      --cf-border: rgba(255, 255, 255, 0.1);
      --cf-text: #f8fafc;
      --cf-text-muted: #94a3b8;
      --cf-accent: #10b981;
      --cf-danger: #ef4444;
      --cf-radius: 16px;
    }

    #cf-widget-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--cf-text);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    /* Floating Launcher Button */
    #cf-launcher-btn {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      box-shadow: 0 8px 24px rgba(37, 99, 235, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease;
      color: #fff;
      outline: none;
      user-select: none;
    }
    #cf-launcher-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.55);
    }
    #cf-launcher-btn:active {
      transform: scale(0.95);
    }
    #cf-launcher-btn svg {
      width: 26px;
      height: 26px;
      transition: transform 0.2s ease;
    }

    /* Chat Modal Window */
    #cf-chat-window {
      width: 400px;
      max-width: calc(100vw - 32px);
      height: 600px;
      max-height: calc(100vh - 100px);
      background: var(--cf-card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--cf-border);
      border-radius: var(--cf-radius);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
      display: none;
      flex-direction: column;
      overflow: hidden;
      margin-bottom: 16px;
      animation: cfSlideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes cfSlideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Modal Header */
    .cf-header {
      padding: 16px;
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid var(--cf-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .cf-header-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .cf-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: cfPulse 2s infinite;
    }
    @keyframes cfPulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }
    .cf-header h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
    }
    .cf-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cf-icon-btn {
      background: transparent;
      border: none;
      color: var(--cf-text-muted);
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .cf-icon-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    /* Chat Messages Body */
    .cf-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }

    /* Message Bubbles */
    .cf-msg {
      display: flex;
      flex-direction: column;
      max-width: 86%;
      word-break: break-word;
    }
    .cf-msg-user {
      align-self: flex-end;
    }
    .cf-msg-user .cf-bubble {
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      color: #fff;
      border-radius: 16px 16px 4px 16px;
      padding: 10px 14px;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }
    .cf-msg-assistant {
      align-self: flex-start;
    }
    .cf-msg-assistant .cf-bubble {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid var(--cf-border);
      color: var(--cf-text);
      border-radius: 16px 16px 16px 4px;
      padding: 12px 14px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    /* Markdown Styling inside Bubbles */
    .cf-bubble p { margin: 0 0 8px 0; }
    .cf-bubble p:last-child { margin-bottom: 0; }
    .cf-bubble code {
      background: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #38bdf8;
    }
    .cf-bubble pre {
      background: #020617;
      padding: 10px;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid rgba(255, 255, 255, 0.1);
      margin: 8px 0;
    }
    .cf-bubble pre code {
      background: transparent;
      padding: 0;
      color: #cbd5e1;
    }
    .cf-bubble ul, .cf-bubble ol {
      margin: 6px 0;
      padding-left: 20px;
    }
    .cf-bubble li { margin-bottom: 4px; }
    .cf-bubble strong { color: #fff; font-weight: 600; }
    .cf-bubble blockquote {
      border-left: 3px solid #3b82f6;
      margin: 6px 0;
      padding-left: 8px;
      color: #94a3b8;
    }

    /* Live Tool / Status Pill */
    .cf-tool-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 4px 8px;
      border-radius: 20px;
      margin-bottom: 8px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .cf-tool-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid #60a5fa;
      border-top-color: transparent;
      border-radius: 50%;
      animation: cfSpin 0.7s linear infinite;
    }
    @keyframes cfSpin {
      to { transform: rotate(360deg); }
    }

    /* Action Confirmation Card */
    .cf-action-card {
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cf-action-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      color: #f59e0b;
    }
    .cf-action-desc {
      font-size: 13px;
      color: #cbd5e1;
    }
    .cf-action-buttons {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .cf-btn-approve {
      flex: 1;
      background: #10b981;
      color: #fff;
      border: none;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .cf-btn-approve:hover { background: #059669; }
    .cf-btn-reject {
      flex: 1;
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.4);
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .cf-btn-reject:hover { background: rgba(239, 68, 68, 0.35); }
    .cf-action-resolved {
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      text-align: center;
      font-weight: 600;
    }
    .cf-action-resolved.approved {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .cf-action-resolved.rejected {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Quick Suggestions */
    .cf-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(15, 23, 42, 0.4);
    }
    .cf-chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--cf-border);
      color: #cbd5e1;
      padding: 4px 10px;
      border-radius: 14px;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .cf-chip:hover {
      background: rgba(59, 130, 246, 0.25);
      color: #93c5fd;
      border-color: rgba(59, 130, 246, 0.4);
    }

    /* Footer & Input Bar */
    .cf-footer {
      padding: 12px 16px;
      background: rgba(15, 23, 42, 0.95);
      border-top: 1px solid var(--cf-border);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cf-input-wrapper {
      flex: 1;
      display: flex;
      align-items: center;
      background: rgba(2, 6, 23, 0.6);
      border: 1px solid var(--cf-border);
      border-radius: 20px;
      padding: 6px 14px;
      transition: border-color 0.15s;
    }
    .cf-input-wrapper:focus-within {
      border-color: #3b82f6;
    }
    .cf-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 13px;
      outline: none;
      resize: none;
      max-height: 80px;
      font-family: inherit;
    }
    .cf-input::placeholder {
      color: #64748b;
    }
    .cf-send-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #3b82f6;
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
      flex-shrink: 0;
    }
    .cf-send-btn:hover {
      background: #2563eb;
      transform: scale(1.05);
    }
    .cf-send-btn:disabled {
      background: #334155;
      color: #64748b;
      cursor: not-allowed;
      transform: none;
    }

    /* Typing Cursor */
    .cf-cursor {
      display: inline-block;
      width: 5px;
      height: 14px;
      background: #3b82f6;
      margin-left: 3px;
      vertical-align: middle;
      animation: cfBlink 1s infinite;
    }
    @keyframes cfBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `;
  document.head.appendChild(styleEl);

  // Markdown parser helper
  function renderMarkdown(md) {
    if (!md) return '';
    let html = md
      // Escape basic HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Code blocks
      .replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (_, lang, code) => {
        return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
      })
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Headers
      .replace(/^### (.*$)/gim, '<strong>$1</strong><br>')
      // Bold & Italic
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // Blockquotes
      .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
      // Unordered lists
      .replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>')
      // Ordered lists
      .replace(/^\s*\d+\.\s+(.*)$/gim, '<li>$1</li>')
      // Wrap consecutive li in ul
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:underline;">$1</a>')
      // Newlines
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    return html;
  }

  // Create UI Elements
  const container = document.createElement('div');
  container.id = 'cf-widget-container';

  container.innerHTML = `
    <div id="cf-chat-window">
      <div class="cf-header">
        <div class="cf-header-title">
          <div class="cf-status-dot"></div>
          <div>
            <h3>${widgetTitle}</h3>
            <small style="color:#94a3b8;font-size:11px;">Cloudflare Edge AI • <span id="cf-active-model">Online</span></small>
          </div>
        </div>
        <div class="cf-header-actions">
          <button class="cf-icon-btn" id="cf-clear-btn" title="Reset Conversation">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
          <button class="cf-icon-btn" id="cf-close-btn" title="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="cf-body" id="cf-messages">
        <div class="cf-msg cf-msg-assistant">
          <div class="cf-bubble">
            <p>${welcomeMessage}</p>
          </div>
        </div>
      </div>

      <div class="cf-chips">
        <div class="cf-chip" data-prompt="Book a consultation for tomorrow at 4 PM">📅 Book Consultation</div>
        <div class="cf-chip" data-prompt="Track order #1042">📦 Track #1042</div>
        <div class="cf-chip" data-prompt="Trigger system action restart_service">⚡ Restart Service</div>
        <div class="cf-chip" data-prompt="Submit lead for John Doe, john@example.com, interested in enterprise">💼 Submit Lead</div>
      </div>

      <div class="cf-footer">
        <div class="cf-input-wrapper">
          <textarea class="cf-input" id="cf-input" rows="1" placeholder="Ask a question or issue a command..."></textarea>
        </div>
        <button class="cf-send-btn" id="cf-send-btn" title="Send Message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>

    <button id="cf-launcher-btn" title="Open AI Assistant">
      <svg id="cf-icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg id="cf-icon-close" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  `;

  document.body.appendChild(container);

  // References
  const chatWindow = document.getElementById('cf-chat-window');
  const launcherBtn = document.getElementById('cf-launcher-btn');
  const iconOpen = document.getElementById('cf-icon-open');
  const iconClose = document.getElementById('cf-icon-close');
  const closeBtn = document.getElementById('cf-close-btn');
  const clearBtn = document.getElementById('cf-clear-btn');
  const messagesBox = document.getElementById('cf-messages');
  const inputEl = document.getElementById('cf-input');
  const sendBtn = document.getElementById('cf-send-btn');
  const activeModelLabel = document.getElementById('cf-active-model');

  let isChatOpen = false;
  let isStreaming = false;

  // Toggle Window
  function toggleChat(open) {
    isChatOpen = typeof open === 'boolean' ? open : !isChatOpen;
    chatWindow.style.display = isChatOpen ? 'flex' : 'none';
    iconOpen.style.display = isChatOpen ? 'none' : 'block';
    iconClose.style.display = isChatOpen ? 'block' : 'none';
    if (isChatOpen) {
      inputEl.focus();
      scrollToBottom();
    }
  }

  launcherBtn.addEventListener('click', () => toggleChat());
  closeBtn.addEventListener('click', () => toggleChat(false));

  clearBtn.addEventListener('click', () => {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEY, sessionId);
    messagesBox.innerHTML = `
      <div class="cf-msg cf-msg-assistant">
        <div class="cf-bubble">
          <p>Conversation reset. How can I help you today?</p>
        </div>
      </div>
    `;
  });

  // Chip quick prompts
  document.querySelectorAll('.cf-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt && !isStreaming) {
        inputEl.value = prompt;
        sendMessage();
      }
    });
  });

  function scrollToBottom() {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  // Append message element
  function appendMessage(role, initialText = '') {
    const msgEl = document.createElement('div');
    msgEl.className = `cf-msg cf-msg-${role}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'cf-bubble';
    bubbleEl.innerHTML = renderMarkdown(initialText);

    msgEl.appendChild(bubbleEl);
    messagesBox.appendChild(msgEl);
    scrollToBottom();
    return bubbleEl;
  }

  // Handle Action Approval / Rejection
  async function handleActionConfirm(actionData, approved, containerCard) {
    const statusDiv = document.createElement('div');
    statusDiv.className = `cf-action-resolved ${approved ? 'approved' : 'rejected'}`;
    statusDiv.textContent = approved ? '✓ Action Approved & Queued' : '✕ Action Cancelled by User';

    const buttonsDiv = containerCard.querySelector('.cf-action-buttons');
    if (buttonsDiv) buttonsDiv.replaceWith(statusDiv);

    try {
      const res = await fetch(`${apiUrl}/api/action/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          actionId: actionData.actionId,
          approved,
          actionType: actionData.actionType,
          payload: actionData.payload,
          token: actionData.token,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        statusDiv.textContent = `⚠️ Error: ${data.message || 'Verification failed'}`;
        statusDiv.className = 'cf-action-resolved rejected';
      }
    } catch {
      statusDiv.textContent = '⚠️ Network error during action execution.';
      statusDiv.className = 'cf-action-resolved rejected';
    }
  }

  // Render Action Card
  function renderActionCard(actionData, targetBubble) {
    const card = document.createElement('div');
    card.className = 'cf-action-card';
    card.innerHTML = `
      <div class="cf-action-header">
        <span>⚠️ SENSITIVE ACTION AUTHORIZATION</span>
        <span style="text-transform:uppercase;font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(245,158,11,0.2);">${actionData.riskLevel || 'medium'} risk</span>
      </div>
      <div class="cf-action-desc">${actionData.description}</div>
      <div class="cf-action-buttons">
        <button class="cf-btn-approve">Approve & Execute</button>
        <button class="cf-btn-reject">Cancel</button>
      </div>
    `;

    const approveBtn = card.querySelector('.cf-btn-approve');
    const rejectBtn = card.querySelector('.cf-btn-reject');

    approveBtn.addEventListener('click', () => handleActionConfirm(actionData, true, card));
    rejectBtn.addEventListener('click', () => handleActionConfirm(actionData, false, card));

    targetBubble.appendChild(card);
    scrollToBottom();
  }

  // Send message and stream SSE
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    inputEl.value = '';
    isStreaming = true;
    sendBtn.disabled = true;

    // Append User Message
    appendMessage('user', text);

    // Append Assistant Message placeholder
    const assistantBubble = appendMessage('assistant', '');
    const cursor = document.createElement('span');
    cursor.className = 'cf-cursor';
    assistantBubble.appendChild(cursor);

    let accumulatedText = '';
    let currentToolPill = null;

    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Edge returned HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No readable stream returned from edge.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = null;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = null;
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const rawData = trimmed.slice(5).trim();
            if (!rawData) continue;

            try {
              const data = JSON.parse(rawData);

              if (currentEvent === 'start') {
                if (data.model && activeModelLabel) {
                  activeModelLabel.textContent = `${data.model}`;
                }
              } else if (currentEvent === 'chunk') {
                if (data.text) {
                  accumulatedText += data.text;
                  cursor.remove();
                  assistantBubble.innerHTML = renderMarkdown(accumulatedText);
                  assistantBubble.appendChild(cursor);
                  scrollToBottom();
                }
              } else if (currentEvent === 'tool_call') {
                if (!currentToolPill) {
                  currentToolPill = document.createElement('div');
                  currentToolPill.className = 'cf-tool-pill';
                  currentToolPill.innerHTML = `
                    <div class="cf-tool-spinner"></div>
                    <span>Executing <strong>${data.name}</strong>...</span>
                  `;
                  cursor.remove();
                  assistantBubble.appendChild(currentToolPill);
                  assistantBubble.appendChild(cursor);
                  scrollToBottom();
                }
              } else if (currentEvent === 'tool_result') {
                if (currentToolPill) {
                  currentToolPill.innerHTML = `<span>✓ Tool <strong>${data.name}</strong> executed</span>`;
                  currentToolPill.style.color = '#34d399';
                  currentToolPill.style.borderColor = 'rgba(52, 211, 153, 0.4)';
                  currentToolPill = null;
                }
              } else if (currentEvent === 'action_required') {
                if (data.action) {
                  renderActionCard(data.action, assistantBubble);
                }
              } else if (currentEvent === 'done') {
                cursor.remove();
              }
            } catch {
              // Ignore non-json lines
            }
          }
        }
      }
    } catch (err) {
      cursor.remove();
      const errorMsg = document.createElement('p');
      errorMsg.style.color = '#f87171';
      errorMsg.style.fontSize = '12px';
      errorMsg.innerHTML = `⚠️ <em>Connection interrupted. Please verify edge connectivity and retry.</em>`;
      assistantBubble.appendChild(errorMsg);
    } finally {
      cursor.remove();
      isStreaming = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
