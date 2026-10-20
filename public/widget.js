(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__CF_AGENT_WIDGET_LOADED__) return;
  window.__CF_AGENT_WIDGET_LOADED__ = true;

  // Resolve configuration from script element attributes
  const currentScript =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"]');
  // The widget must call the server that served it, not the page it happens to
  // be embedded on. Without this, the embed on a customer's site would POST to
  // that site's own /api/chat and fail. An explicit data-api-url always wins.
  let scriptOrigin = '';
  try {
    scriptOrigin = new URL(currentScript?.src || '', window.location.href).origin;
  } catch {
    scriptOrigin = '';
  }
  const apiUrl =
    currentScript?.getAttribute('data-api-url') ||
    scriptOrigin ||
    window.location.origin;
  const siteKey = currentScript?.getAttribute('data-turnstile-sitekey') || '';
  const rawTitle = currentScript?.getAttribute('data-title');
  const rawWelcome = currentScript?.getAttribute('data-welcome');
  const rawChips = currentScript?.getAttribute('data-chips');

  // ===========================================================================
  // Intelligent On-Site Context & Auto-Chip Synthesizer (with Persistence)
  // When embedded on any new website for the first time, analyzes page metadata,
  // headings, brand name, and domain semantics to synthesize custom action chips
  // and caches them in localStorage so subsequent visits show the exact same
  // site-tailored chips without latency or falling back to generic prompts.
  // ===========================================================================
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
  const docTitle = (typeof document !== 'undefined' && document.title) ? document.title : '';
  const CHIPS_STORAGE_KEY = 'cf_widget_chips_' + (host || 'default');
  const TITLE_STORAGE_KEY = 'cf_widget_title_' + (host || 'default');
  const WELCOME_STORAGE_KEY = 'cf_widget_welcome_' + (host || 'default');

  function getMetaContent(nameOrProp) {
    if (typeof document === 'undefined') return '';
    const el = document.querySelector(`meta[name="${nameOrProp}"], meta[property="${nameOrProp}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function resolveBrandName() {
    if (currentScript && currentScript.getAttribute('data-site-name')) {
      return currentScript.getAttribute('data-site-name');
    }
    const ogSite = getMetaContent('og:site_name');
    if (ogSite && ogSite.length >= 2 && ogSite.length <= 30) return ogSite;
    if (docTitle) {
      const parts = docTitle.split(/[-|•–:]/);
      if (parts[0] && parts[0].trim().length >= 2 && parts[0].trim().length <= 35) {
        return parts[0].trim();
      }
    }
    if (host) {
      const clean = host.replace(/^(www\.|app\.|staging\.|dev\.)/, '').split('.')[0];
      if (clean && clean !== 'localhost') {
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      }
    }
    return '';
  }

  function synthesizeIntelligentSiteContext() {
    const brand = resolveBrandName();
    const metaDesc = getMetaContent('description') || getMetaContent('og:description');
    const ogTitle = getMetaContent('og:title');
    const headings = typeof document !== 'undefined'
      ? Array.from(document.querySelectorAll('h1, h2')).map((e) => (e.innerText || e.textContent || '').trim()).filter(Boolean).slice(0, 5).join(' ')
      : '';
    const corpus = `${host} ${docTitle} ${ogTitle} ${metaDesc} ${headings}`.toLowerCase();

    // 1. ShunopsAI / YouTube Video Studio / Autonomous Engine
    if (corpus.includes('shunops') || corpus.includes('youtube') || corpus.includes('video render') || corpus.includes('tts') || corpus.includes('run.app')) {
      const siteTitle = brand ? `${brand} Studio AI` : 'ShunopsAI Studio';
      return {
        title: siteTitle,
        welcome: `Namaste! Main ${siteTitle} hoon. Main YouTube video script, multi-track rendering, audio TTS aur autonomous publishing status me aapki madad kar sakta hoon. Kaise help karoon?`,
        chips: [
          { label: '🎬 Video Script & Render', prompt: 'Generate an autonomous video script and start scene rendering' },
          { label: '📺 YouTube Upload Status', prompt: 'Check recent YouTube video upload status and publishing queue' },
          { label: '⚡ Run Code / Sandbox', prompt: 'Run code in the secure WebAssembly sandbox' },
          { label: '📋 Autonomous Task Plan', prompt: 'Create a multi-step execution plan for my project' },
        ],
      };
    }

    // 2. SaralGati / Elder & Caregiver Support
    if (corpus.includes('saralgati') || corpus.includes('elder') || corpus.includes('caregiver') || corpus.includes('dawai') || corpus.includes('sage-webbing')) {
      return {
        title: 'SaralGati Care AI',
        welcome: 'Namaste! Main SaralGati Elder & Caregiver AI Assistant hoon. Main emergency alert check karne, smartphone screen guidance dene, dawai schedule ya suspicious call scam verify karne me aapki madad kar sakta hoon. Kaise madad karoon?',
        chips: [
          { label: '🚨 SOS & Health Check', prompt: 'Check active elder emergency alerts and health vitals status' },
          { label: '📱 Phone Guide (सरल)', prompt: 'Mujhe smartphone screen aur buttons chalana simple Hindi me samjhao' },
          { label: '💊 Dawai Reminder', prompt: 'Elder daily medicine reminder aur care routine schedule dikhao' },
          { label: '🛡️ Scam & Fraud Shield', prompt: 'Check if a suspicious phone call, SMS, or banking alert is a fraud or scam' },
        ],
      };
    }

    // 3. Kanban / Agile / Task Management
    if (corpus.includes('kanban') || corpus.includes('sprint') || corpus.includes('scrum') || corpus.includes('wip limit') || corpus.includes('backlog')) {
      return {
        title: 'Kanban Cloud AI',
        welcome: 'Hi! I am your Kanban Cloud AI Assistant. I can help create tasks, summarize sprint WIP limits, highlight blockers, and configure board automation. How can I assist you?',
        chips: [
          { label: '➕ Create Task', prompt: 'Create a new task card on the board' },
          { label: '📊 Sprint WIP Status', prompt: 'Summarize active board columns and WIP limits' },
          { label: '🔍 Find Blockers', prompt: 'Show blocked cards and urgent priority tasks' },
          { label: '⚡ Board Automations', prompt: 'How do I configure automation rules or export board data?' },
        ],
      };
    }

    // 4. E-Commerce / Store / Shopping / Products
    if (corpus.includes('shop') || corpus.includes('store') || corpus.includes('cart') || corpus.includes('checkout') || corpus.includes('product') || corpus.includes('buy') || corpus.includes('price') || corpus.includes('discount') || corpus.includes('sale') || corpus.includes('apparel') || corpus.includes('clothing')) {
      const siteTitle = brand ? `${brand} Shopping AI` : 'Store Shopping Assistant';
      return {
        title: siteTitle,
        welcome: `Welcome to ${brand || 'our store'}! I am your AI shopping assistant. How can I help you discover products, check special offers, or track your orders today?`,
        chips: [
          { label: '🛍️ Featured Products', prompt: 'What are the top trending products and popular recommendations today?' },
          { label: '📦 Track My Order', prompt: 'How do I check the delivery status and tracking for my order?' },
          { label: '🏷️ Deals & Discounts', prompt: 'What active discount coupons and promotional offers are available?' },
          { label: '🔄 Returns & Shipping', prompt: 'What is the return policy, warranty, and estimated shipping time?' },
        ],
      };
    }

    // 5. Developer / SaaS / API / Tech Platform
    if (corpus.includes('api') || corpus.includes('developer') || corpus.includes('sdk') || corpus.includes('docs') || corpus.includes('cloud') || corpus.includes('deploy') || corpus.includes('saas') || corpus.includes('database') || corpus.includes('software')) {
      const siteTitle = brand ? `${brand} Copilot` : 'Developer Copilot';
      return {
        title: siteTitle,
        welcome: `Hello! I am your AI assistant for ${brand || 'this platform'}. How can I assist with your setup, integration, API docs, or workflows today?`,
        chips: [
          { label: '🚀 Getting Started', prompt: `How do I quickly get started with ${brand || 'this platform'}?` },
          { label: '💻 API & SDK Guide', prompt: 'Show me code examples, authentication, and API integration steps' },
          { label: '⚙️ Configuration', prompt: 'What are the recommended deployment settings and best practices?' },
          { label: '🛠️ Troubleshoot', prompt: 'Help me debug an error code or configure platform permissions' },
        ],
      };
    }

    // 6. Education / Courses / Academy
    if (corpus.includes('course') || corpus.includes('learn') || corpus.includes('academy') || corpus.includes('student') || corpus.includes('syllabus') || corpus.includes('tutorial') || corpus.includes('study') || corpus.includes('training')) {
      const siteTitle = brand ? `${brand} Learning AI` : 'Study Guide AI';
      return {
        title: siteTitle,
        welcome: `Welcome to ${brand || 'our academy'}! I can guide you through courses, curriculum details, practice questions, and study roadmap.`,
        chips: [
          { label: '📚 Explore Courses', prompt: 'What courses, certifications, and learning tracks are available?' },
          { label: '🎓 Curriculum Details', prompt: 'Can you explain the syllabus, prerequisites, and learning outcomes?' },
          { label: '📝 Practice & Quiz', prompt: 'Give me a quick practice exercise or quiz on the key concepts' },
          { label: '💡 Study Roadmap', prompt: 'What is the recommended step-by-step study roadmap for beginners?' },
        ],
      };
    }

    // 7. Healthcare / Clinic / Medical
    if (corpus.includes('clinic') || corpus.includes('doctor') || corpus.includes('hospital') || corpus.includes('medical') || corpus.includes('dental') || corpus.includes('health') || corpus.includes('patient') || corpus.includes('treatment')) {
      const siteTitle = brand ? `${brand} Health AI` : 'Care & Wellness AI';
      return {
        title: siteTitle,
        welcome: `Welcome to ${brand || 'our clinic'}! How can I assist you with appointments, clinic timings, treatments, or consultation queries today?`,
        chips: [
          { label: '📅 Book Appointment', prompt: 'How can I schedule a consultation or doctor appointment?' },
          { label: '🩺 Services & Treatments', prompt: 'What medical treatments and specialized services are offered here?' },
          { label: '⏰ Timings & Location', prompt: 'What are the operating hours, emergency contact, and clinic location?' },
          { label: '🛡️ Patient Guide', prompt: 'What documents or medical history should I bring to my visit?' },
        ],
      };
    }

    // 8. Real Estate / Housing / Properties
    if (corpus.includes('realty') || corpus.includes('property') || corpus.includes('real estate') || corpus.includes('apartment') || corpus.includes('villa') || corpus.includes('housing') || corpus.includes('rent') || corpus.includes('broker')) {
      const siteTitle = brand ? `${brand} Property AI` : 'Real Estate Guide';
      return {
        title: siteTitle,
        welcome: `Welcome to ${brand || 'our property portal'}! I can help you search properties, arrange site visits, and explore pricing details.`,
        chips: [
          { label: '🏡 Browse Listings', prompt: 'Show available properties, apartments, and featured listings' },
          { label: '📍 Locality & Pricing', prompt: 'What are the price ranges, neighborhood amenities, and connectivity?' },
          { label: '📅 Schedule Site Visit', prompt: 'How can I book an in-person property inspection or virtual tour?' },
          { label: '📄 Paperwork & Financing', prompt: 'What documentation, registry process, and loan options are supported?' },
        ],
      };
    }

    // 9. Finance / Fintech / Banking / Investments
    if (corpus.includes('finance') || corpus.includes('fintech') || corpus.includes('bank') || corpus.includes('loan') || corpus.includes('crypto') || corpus.includes('invest') || corpus.includes('insurance') || corpus.includes('wallet')) {
      const siteTitle = brand ? `${brand} Financial AI` : 'Finance Advisor AI';
      return {
        title: siteTitle,
        welcome: `Welcome to ${brand || 'our financial portal'}! How can I assist you with plans, account queries, rates, or verification today?`,
        chips: [
          { label: '📊 Compare Plans', prompt: 'What financial plans, investment tiers, or accounts are available?' },
          { label: '💳 Rates & Fees', prompt: 'What are the interest rates, processing fees, and minimum requirements?' },
          { label: '🛡️ Security & KYC', prompt: 'How does account verification, KYC, and transaction security work?' },
          { label: '📞 Advisor Assistance', prompt: 'How can I connect with a dedicated advisor or customer support?' },
        ],
      };
    }

    // 10. Universal Dynamic Smart Fallback (Any General Website / Blog / Portfolio / Agency)
    const siteTitle = brand ? `${brand} Assistant` : 'Website Assistant';
    const firstH1 = typeof document !== 'undefined'
      ? (document.querySelector('h1')?.innerText || document.querySelector('h1')?.textContent || '').trim().replace(/\s+/g, ' ')
      : '';
    const featurePrompt = firstH1 && firstH1.length <= 50 ? `Tell me more about "${firstH1}" and what you offer` : `Explain the key services, features, and purpose of ${siteTitle}`;

    return {
      title: siteTitle,
      welcome: `Welcome to ${brand || 'our website'}! I am your interactive AI assistant. How can I help you explore our features, answer questions, or guide you today?`,
      chips: [
        { label: `🌟 About ${brand || 'Us'}`, prompt: `What is ${brand || 'this platform'} and how does it help users?` },
        { label: '🔍 Key Features', prompt: featurePrompt },
        { label: '❓ FAQ & Answers', prompt: `What are the most common questions and helpful tips for ${brand || 'this website'}?` },
        { label: '💬 Contact & Help', prompt: 'How can I reach the support team or get further assistance?' },
      ],
    };
  }

  // 1. Explicit data-chips attribute wins
  let activeChips = null;
  let defaultTitle = '';
  let defaultWelcome = '';

  if (rawChips) {
    try {
      const parsed = JSON.parse(rawChips);
      if (Array.isArray(parsed) && parsed.length > 0) {
        activeChips = parsed.map((item) => {
          if (typeof item === 'string') return { label: item, prompt: item };
          return { label: item.label || item.title || 'Action', prompt: item.prompt || item.label || '' };
        });
      }
    } catch {
      activeChips = rawChips.split(',').map((c) => {
        const trimmed = c.trim();
        return { label: trimmed, prompt: trimmed };
      }).filter((c) => c.label);
    }
  }

  // 2. Read from persistent localStorage cache for this website
  if (!activeChips) {
    try {
      const cachedChipsJson = localStorage.getItem(CHIPS_STORAGE_KEY);
      if (cachedChipsJson) {
        const parsed = JSON.parse(cachedChipsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          activeChips = parsed;
        }
      }
      defaultTitle = localStorage.getItem(TITLE_STORAGE_KEY) || '';
      defaultWelcome = localStorage.getItem(WELCOME_STORAGE_KEY) || '';
    } catch {}
  }

  // 3. First time on this website ("jab pehli baar kisi nayi website pe lge")
  // Intelligently synthesize and persist immediately!
  if (!activeChips || activeChips.length === 0 || !defaultTitle || !defaultWelcome) {
    const synthesized = synthesizeIntelligentSiteContext();
    if (!activeChips || activeChips.length === 0) activeChips = synthesized.chips;
    if (!defaultTitle) defaultTitle = synthesized.title;
    if (!defaultWelcome) defaultWelcome = synthesized.welcome;

    try {
      localStorage.setItem(CHIPS_STORAGE_KEY, JSON.stringify(activeChips));
      localStorage.setItem(TITLE_STORAGE_KEY, defaultTitle);
      localStorage.setItem(WELCOME_STORAGE_KEY, defaultWelcome);
    } catch {}
  }

  const widgetTitle = rawTitle || defaultTitle || 'Website Assistant';
  const welcomeMessage = rawWelcome || defaultWelcome || 'Hello! How can I assist you today?';

  // Safe session ID generator
  function generateSessionId() {
    if (window.crypto && window.crypto.randomUUID) {
      return 'sess_' + window.crypto.randomUUID().replace(/-/g, '').slice(0, 12) + Date.now().toString(36);
    }
    const arr = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
      return 'sess_' + Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('') + Date.now().toString(36);
    }
    return 'sess_' + Date.now().toString(36);
  }

  // Local storage session key
  const STORAGE_KEY = 'cf_edge_agent_session_id';
  let sessionId = localStorage.getItem(STORAGE_KEY);
  if (!sessionId) {
    sessionId = generateSessionId();
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

    /* Smart Mode Selector Pill */
    .cf-mode-pill {
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.28);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 6px;
      border-radius: 12px;
      cursor: pointer;
      outline: none;
      transition: all 0.2s;
    }
    .cf-mode-pill:hover {
      background: rgba(56, 189, 248, 0.22);
      border-color: #38bdf8;
    }
    .cf-mode-pill option {
      background: #0f172a;
      color: #f8fafc;
    }

    /* Quoted Selection Reference Bar */
    .cf-quoted-bar {
      display: none;
      align-items: center;
      justify-content: space-between;
      background: rgba(37, 99, 235, 0.15);
      border-top: 1px solid rgba(59, 130, 246, 0.3);
      padding: 6px 12px;
      font-size: 11px;
      color: #93c5fd;
      gap: 8px;
    }
    .cf-quoted-content {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .cf-quoted-content svg {
      flex-shrink: 0;
    }
    .cf-quoted-text {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-style: italic;
    }
    .cf-quoted-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 12px;
      padding: 0 4px;
      line-height: 1;
      transition: color 0.15s;
      flex-shrink: 0;
    }
    .cf-quoted-close:hover {
      color: #ef4444;
    }

    /* Model Attribution Tag & Copy Button */
    .cf-model-tag {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 10px;
      color: #94a3b8;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      width: 100%;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .cf-copy-msg-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
      font-family: inherit;
      margin-left: auto;
    }
    .cf-copy-msg-btn:hover {
      background: rgba(59, 130, 246, 0.25);
      border-color: rgba(59, 130, 246, 0.4);
      color: #fff;
    }
    .cf-copy-msg-btn svg {
      flex-shrink: 0;
    }

    /* Code Block with Copy Button */
    .cf-code-wrap {
      background: #020617;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      margin: 8px 0;
      overflow: hidden;
    }
    .cf-code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .cf-copy-code-btn {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #cbd5e1;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .cf-copy-code-btn:hover {
      background: rgba(59, 130, 246, 0.3);
      color: #fff;
    }
    .cf-code-wrap pre {
      margin: 0 !important;
      border: none !important;
      border-radius: 0 !important;
      background: transparent !important;
    }

    /* Dynamic Smart Chips */
    .cf-chip-dynamic {
      border-color: rgba(56, 189, 248, 0.35);
      background: rgba(56, 189, 248, 0.1);
      color: #7dd3fc;
    }
    .cf-chip-dynamic:hover {
      background: rgba(56, 189, 248, 0.25);
      color: #fff;
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

    /* Mobile Responsiveness */
    @media (max-width: 480px) {
      #cf-widget-container {
        bottom: 12px;
        right: 12px;
      }
      #cf-launcher-btn {
        width: 50px;
        height: 50px;
      }
      #cf-launcher-btn svg {
        width: 22px;
        height: 22px;
      }
      #cf-chat-window {
        width: calc(100vw - 24px);
        max-width: calc(100vw - 24px);
        height: calc(100vh - 84px);
        max-height: calc(100vh - 84px);
        border-radius: 14px;
        margin-bottom: 10px;
      }
      .cf-header {
        padding: 12px 14px;
      }
      .cf-header h3 {
        font-size: 14px;
      }
      .cf-body {
        padding: 12px;
        gap: 10px;
      }
      .cf-msg {
        max-width: 90%;
      }
      .cf-footer {
        padding: 10px 12px;
      }
      .cf-input {
        font-size: 16px;
      }
      .cf-chips {
        padding: 6px 12px;
      }
    }

  `;
  document.head.appendChild(styleEl);

  function sanitizeUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed) && !/^\/\//.test(trimmed)) {
      return trimmed.replace(/"/g, '%22').replace(/'/g, '%27');
    }
    return '#';
  }

  // Markdown parser helper
  function renderMarkdown(md) {
    if (!md) return '';
    let html = String(md)
      // Escape basic HTML & quotes to prevent attribute breakout
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      // Code blocks with one-click copy button
      .replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (_, lang, code) => {
        const cleanCode = code.trim();
        const encoded = encodeURIComponent(cleanCode);
        return `<div class="cf-code-wrap"><div class="cf-code-header"><span>${lang || 'code'}</span><button class="cf-copy-code-btn" type="button" data-code="${encoded}">Copy</button></div><pre><code class="language-${lang}">${cleanCode}</code></pre></div>`;
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
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const safeHref = sanitizeUrl(url.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:underline;">${label}</a>`;
      })
      // Newlines
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    return html;
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
            <h3>${escapeHtml(widgetTitle)}</h3>
            <small style="color:#94a3b8;font-size:11px;">Edge AI • <span id="cf-active-model">⚡ Auto-Routing</span></small>
          </div>
        </div>
        <div class="cf-header-actions">
          <select id="cf-mode-select" class="cf-mode-pill" title="Intelligence Routing Mode">
            <option value="auto">✨ Smart Auto</option>
            <option value="fast">⚡ Fast Flash</option>
            <option value="deep-reasoning">🧠 Deep Reasoning</option>
          </select>
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
            <p>${escapeHtml(welcomeMessage)}</p>
            <div class="cf-model-tag">
              <span>Assistant</span>
              <button class="cf-copy-msg-btn" type="button" title="Copy response">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Copy</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="cf-chips">
        ${activeChips.map((c) => `<div class="cf-chip" data-prompt="${escapeHtml(c.prompt)}" title="${escapeHtml(c.prompt)}">${escapeHtml(c.label)}</div>`).join('')}
      </div>

      <div id="cf-quoted-bar" class="cf-quoted-bar">
        <div class="cf-quoted-content">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0 7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <span class="cf-quoted-text" id="cf-quoted-text"></span>
        </div>
        <button class="cf-quoted-close" id="cf-quoted-close" type="button" title="Remove quote">✕</button>
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
  const modeSelect = document.getElementById('cf-mode-select');
  const quotedBar = document.getElementById('cf-quoted-bar');
  const quotedTextEl = document.getElementById('cf-quoted-text');
  const quotedCloseBtn = document.getElementById('cf-quoted-close');

  // Rolling Multi-Turn Context Memory
  const conversationHistory = [];

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

  // Dynamic Chip Management
  function bindChipEvents() {
    document.querySelectorAll('.cf-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt && !isStreaming) {
          inputEl.value = prompt;
          sendMessage();
        }
      });
    });
  }

  function renderDefaultChips() {
    const chipsBox = document.querySelector('.cf-chips');
    if (!chipsBox) return;
    chipsBox.innerHTML = activeChips
      .map((c) => `<div class="cf-chip" data-prompt="${escapeHtml(c.prompt)}" title="${escapeHtml(c.prompt)}">${escapeHtml(c.label)}</div>`)
      .join('');
    bindChipEvents();
  }

  function updateFollowUpChips(replyText) {
    const chipsBox = document.querySelector('.cf-chips');
    if (!chipsBox) return;
    chipsBox.innerHTML = '';
    const dynamicPrompts = [];
    const textLower = (replyText || '').toLowerCase();

    if (textLower.includes('```')) {
      dynamicPrompts.push(
        { label: '🔍 Explain Code', prompt: 'Could you explain step-by-step how that code works?' },
        { label: '⚡ Optimize', prompt: 'How can we optimize this for better performance and lower latency?' },
        { label: '🧪 Add Tests', prompt: 'Can you provide test cases or unit tests for this?' }
      );
    } else if (textLower.includes('error') || textLower.includes('failed') || textLower.includes('issue') || textLower.includes('warning')) {
      dynamicPrompts.push(
        { label: '🛠️ How to Fix?', prompt: 'What is the recommended fix or patch for this issue?' },
        { label: '🔍 Root Cause', prompt: 'What could be the underlying root cause of this?' },
        { label: '🛡️ Prevention', prompt: 'How can we prevent this issue in production?' }
      );
    } else if (textLower.includes('api') || textLower.includes('endpoint') || textLower.includes('token') || textLower.includes('quota')) {
      dynamicPrompts.push(
        { label: '📋 Example Request', prompt: 'Show me an example cURL or fetch request.' },
        { label: '🛡️ Security Best Practices', prompt: 'What security best practices apply here?' },
        { label: '⚡ Quota Guardrails', prompt: 'How do rate limits and quota guardrails work here?' }
      );
    } else if (conversationHistory.length >= 4) {
      dynamicPrompts.push(
        { label: '📝 Summarize', prompt: 'Can you summarize what we have covered so far?' },
        { label: '🚀 Next Steps', prompt: 'What are the recommended next steps?' },
        { label: '💡 Alternatives', prompt: 'Are there any alternative approaches?' }
      );
    } else {
      dynamicPrompts.push(
        { label: '💡 Practical Example', prompt: 'Can you give me a practical, real-world example?' },
        { label: '🔍 Deep Dive', prompt: 'Can you explain the deeper technical architecture?' },
        { label: '⚡ Performance Tips', prompt: 'What are the performance optimizations for this?' }
      );
    }

    chipsBox.innerHTML = dynamicPrompts
      .map((c) => `<div class="cf-chip cf-chip-dynamic" data-prompt="${escapeHtml(c.prompt)}" title="${escapeHtml(c.prompt)}">${escapeHtml(c.label)}</div>`)
      .join('');
    bindChipEvents();
  }

  function formatHistory() {
    if (!conversationHistory || conversationHistory.length === 0) return '';
    const recent = conversationHistory.slice(-6);
    return recent
      .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`)
      .join('\n');
  }

  bindChipEvents();

  // Persistent Webpage Text Selection Tracking
  let activeQuotedSelection = '';

  function updateQuotedBar(text) {
    activeQuotedSelection = text ? text.trim() : '';
    if (activeQuotedSelection && activeQuotedSelection.length >= 2) {
      if (quotedTextEl) {
        const preview = activeQuotedSelection.length > 70
          ? activeQuotedSelection.slice(0, 70) + '...'
          : activeQuotedSelection;
        quotedTextEl.textContent = `Referencing: "${preview}"`;
      }
      if (quotedBar) quotedBar.style.display = 'flex';
    } else {
      activeQuotedSelection = '';
      if (quotedBar) quotedBar.style.display = 'none';
    }
  }

  function clearQuotedBar() {
    updateQuotedBar('');
  }

  if (quotedCloseBtn) {
    quotedCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearQuotedBar();
    });
  }

  function capturePageSelection() {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    // Do not capture if selection is within the chat widget itself
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if (container && (container.contains(anchor) || container.contains(focus))) {
      return;
    }

    const text = sel.toString().trim();
    if (text && text.length >= 2 && text.length <= 1500) {
      updateQuotedBar(text);
    }
  }

  document.addEventListener('selectionchange', capturePageSelection);
  document.addEventListener('mouseup', capturePageSelection);
  document.addEventListener('touchend', capturePageSelection);


  // ============================================================================
  // Live Host Website DOM & UI Introspector (Zero-Hardcode On-Site Guidance)
  // Dynamically discovers sidebar menus, navigation tabs, buttons (with visual
  // colors & labels), headings, and workflows on the host webpage so the widget
  // speaks on behalf of the website and guides users through actual on-site UI.
  // ============================================================================
  function detectElementColorName(el) {
    if (!el) return '';
    const clsAndStyle = (
      String(el.className || '') + ' ' + String(el.getAttribute && el.getAttribute('style') || '')
    ).toLowerCase();

    if (/\b(green|emerald|lime|success|pair|online)\b/.test(clsAndStyle) || /#10b981|#22c55e|#059669|#16a34a|#28a745|#00c853/.test(clsAndStyle)) {
      return 'green';
    }
    if (/\b(red|rose|crimson|danger|error|alert|sos)\b/.test(clsAndStyle) || /#ef4444|#dc2626|#f43f5e|#dc3545/.test(clsAndStyle)) {
      return 'red';
    }
    if (/\b(blue|sky|indigo|primary|info)\b/.test(clsAndStyle) || /#2563eb|#3b82f6|#0ea5e9|#0284c7|#007bff/.test(clsAndStyle)) {
      return 'blue';
    }
    if (/\b(yellow|amber|orange|warning)\b/.test(clsAndStyle) || /#f59e0b|#eab308|#f97316|#ffc107/.test(clsAndStyle)) {
      return 'yellow/orange';
    }
    if (/\b(purple|violet|fuchsia)\b/.test(clsAndStyle) || /#8b5cf6|#a855f7|#7c3aed/.test(clsAndStyle)) {
      return 'purple';
    }
    if (/\b(teal|cyan)\b/.test(clsAndStyle) || /#06b6d4|#14b8a6|#00f0ff/.test(clsAndStyle)) {
      return 'teal/cyan';
    }

    if (typeof window !== 'undefined' && window.getComputedStyle) {
      try {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundColor || cs.borderColor || '';
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
        if (m) {
          const r = Number(m[1]);
          const g = Number(m[2]);
          const b = Number(m[3]);
          const a = m[4] !== undefined ? Number(m[4]) : 1;
          if (a > 0.15) {
            if (g > r + 25 && g > b + 15 && g > 70) return 'green';
            if (r > g + 35 && r > b + 35 && r > 90) return 'red';
            if (b > r + 25 && b > g + 10 && b > 90) return 'blue';
            if (r > 170 && g > 110 && b < 90) return 'yellow/orange';
            if (r > 100 && b > 130 && g < 110) return 'purple';
            if (g > 130 && b > 130 && r < 90) return 'teal/cyan';
          }
        }
      } catch {}
    }
    return '';
  }

  function detectUiRegion(el) {
    if (!el) return 'Page';
    const parts = [];
    let cur = el;
    let depth = 0;
    let regionType = '';
    let sectionName = '';

    while (cur && cur !== document.body && depth < 10) {
      const tag = (cur.tagName || '').toLowerCase();
      const cls = String(cur.className || '').toLowerCase();
      const id = String(cur.id || '').toLowerCase();
      const role = String((cur.getAttribute && cur.getAttribute('role')) || '').toLowerCase();
      const ariaLabel = String((cur.getAttribute && cur.getAttribute('aria-label')) || '').trim();
      const dataSection = String((cur.getAttribute && (cur.getAttribute('data-section') || cur.getAttribute('data-tab') || cur.getAttribute('data-view'))) || '').trim();

      if (!regionType) {
        if (tag === 'aside' || role === 'complementary' || /sidebar|side-nav|sidenav|drawer|left-nav/.test(cls + ' ' + id)) {
          regionType = 'Sidebar';
        } else if (tag === 'nav' || role === 'navigation' || /navbar|topbar|header-nav|main-nav/.test(cls + ' ' + id)) {
          regionType = 'Navigation Bar';
        } else if (tag === 'header') {
          regionType = 'Top Header';
        } else if (role === 'dialog' || /modal|dialog|drawer|popup/.test(cls + ' ' + id)) {
          regionType = 'Modal / Dialog';
        } else if (tag === 'footer') {
          regionType = 'Footer';
        }
      }

      if (!sectionName) {
        if (dataSection) {
          sectionName = dataSection;
        } else if (ariaLabel && ariaLabel.length <= 40) {
          sectionName = ariaLabel;
        } else if (cur.querySelector) {
          const heading = cur.querySelector('h1, h2, h3, h4, [class*="title"], [class*="heading"]');
          if (heading && heading !== el && !heading.contains(el)) {
            const hText = (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim();
            if (hText && hText.length <= 45) {
              sectionName = hText;
            }
          }
        }
      }

      cur = cur.parentElement;
      depth++;
    }

    if (regionType) parts.push(regionType);
    if (sectionName && (!regionType || sectionName.toLowerCase() !== regionType.toLowerCase())) {
      parts.push(sectionName);
    }
    return parts.length > 0 ? parts.join(' -> ') : 'Main Screen';
  }

  function cleanText(raw, maxLen = 60) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
  }

  function captureHostWebsiteContext() {
    if (typeof document === 'undefined' || !document.body) return '';
    try {
      const siteName =
        (currentScript && (currentScript.getAttribute('data-site-name') || currentScript.getAttribute('data-title'))) ||
        document.title ||
        (window.location && window.location.hostname) ||
        'Host Website';
      const customContext = (currentScript && currentScript.getAttribute('data-site-context')) || '';
      const metaDescEl = document.querySelector('meta[name="description"]');
      const metaDesc = metaDescEl ? cleanText(metaDescEl.getAttribute('content') || '', 160) : '';
      const currentPath = (window.location ? (window.location.pathname + window.location.hash) : '/') || '/';

      // 1. Collect Sidebar & Navigation Items
      const navItems = [];
      const seenNav = new Set();
      const navEls = document.querySelectorAll(
        'aside a, aside button, aside [role="button"], aside [role="tab"], nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button, [class*="sidebar"] [role="button"], [id*="sidebar"] a, [id*="sidebar"] button, [role="navigation"] a, [role="navigation"] button, [role="tablist"] button, [role="tablist"] [role="tab"]'
      );
      navEls.forEach((el) => {
        if (container && container.contains(el)) return;
        const label = cleanText(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '', 45);
        if (!label || label.length < 2) return;
        const key = label.toLowerCase();
        if (seenNav.has(key)) return;
        seenNav.add(key);
        const region = detectUiRegion(el);
        const color = detectElementColorName(el);
        const colorDesc = color ? ` (${color})` : '';
        navItems.push(`[${region}] "${label}"${colorDesc}`);
      });

      // 2. Collect Interactive Buttons & Controls on the Host Page
      const buttonItems = [];
      const seenBtns = new Set();
      const btnEls = document.querySelectorAll(
        'button, [role="button"], a[class*="btn"], a[class*="button"], input[type="button"], input[type="submit"], [data-action]'
      );
      btnEls.forEach((el) => {
        if (container && container.contains(el)) return;
        const label = cleanText(
          el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '',
          50
        );
        if (!label || label.length < 2) return;
        const region = detectUiRegion(el);
        const color = detectElementColorName(el);
        const titleHint = cleanText(el.getAttribute('title') || el.getAttribute('aria-label') || '', 60);
        const hintPart = titleHint && titleHint.toLowerCase() !== label.toLowerCase() ? ` — ${titleHint}` : '';
        const colorPart = color ? `${color} button` : 'button';
        const entry = `[${region}] ${colorPart} "${label}"${hintPart}`;
        const dedupKey = `${region.toLowerCase()}|${label.toLowerCase()}`;
        if (seenBtns.has(dedupKey)) return;
        seenBtns.add(dedupKey);
        buttonItems.push(entry);
      });

      // 3. Collect Page Headings & Sections
      const headings = [];
      const seenHeadings = new Set();
      document.querySelectorAll('h1, h2, h3, h4, [data-ai-help], [data-feature]').forEach((el) => {
        if (container && container.contains(el)) return;
        const text = cleanText(el.innerText || el.textContent || el.getAttribute('data-ai-help') || '', 70);
        if (!text || text.length < 2) return;
        const key = text.toLowerCase();
        if (seenHeadings.has(key)) return;
        seenHeadings.add(key);
        headings.push(text);
      });

      const lines = [
        `Website: ${cleanText(siteName, 80)} (Path: ${currentPath})`,
      ];
      if (metaDesc) lines.push(`Site Description: ${metaDesc}`);
      if (customContext) lines.push(`Site Guidance Notes: ${cleanText(customContext, 400)}`);
      if (navItems.length > 0) {
        lines.push(`Sidebar & Navigation Menu Items (${navItems.slice(0, 18).join(' | ')})`);
      }
      if (buttonItems.length > 0) {
        lines.push(`Available On-Page Buttons & Controls:\n- ${buttonItems.slice(0, 28).join('\n- ')}`);
      }
      if (headings.length > 0) {
        lines.push(`Page Sections & Headings: ${headings.slice(0, 15).join(' | ')}`);
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  }


  // Assistant Bubble Model Tag & Copy Button Helper
  function attachModelTag(bubbleEl, compLabel = 'Assistant', modelName = 'Flash Edge') {
    if (!bubbleEl || bubbleEl.querySelector('.cf-model-tag')) return;
    const modelTag = document.createElement('div');
    modelTag.className = 'cf-model-tag';
    modelTag.innerHTML = `
      <span>${escapeHtml(compLabel)} • ${escapeHtml(modelName)}</span>
      <button class="cf-copy-msg-btn" type="button" title="Copy response">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        <span>Copy</span>
      </button>
    `;
    bubbleEl.appendChild(modelTag);
  }

  // Universal Click Delegator: Code Snippet Copy & Assistant Message Copy
  document.addEventListener('click', (e) => {
    // 1. Markdown code block copy button
    const codeBtn = e.target.closest('.cf-copy-code-btn');
    if (codeBtn) {
      const code = decodeURIComponent(codeBtn.getAttribute('data-code') || '');
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
          const orig = codeBtn.textContent;
          codeBtn.textContent = 'Copied!';
          codeBtn.style.color = '#34d399';
          setTimeout(() => {
            codeBtn.textContent = orig;
            codeBtn.style.color = '';
          }, 2000);
        });
      }
      return;
    }

    // 2. Assistant message copy button
    const msgBtn = e.target.closest('.cf-copy-msg-btn');
    if (msgBtn) {
      const bubble = msgBtn.closest('.cf-bubble');
      if (!bubble) return;
      const clone = bubble.cloneNode(true);
      const tag = clone.querySelector('.cf-model-tag');
      if (tag) tag.remove();
      const actionCard = clone.querySelector('.cf-action-card');
      if (actionCard) actionCard.remove();
      const toolPills = clone.querySelectorAll('.cf-tool-pill');
      toolPills.forEach((p) => p.remove());
      const textToCopy = (clone.innerText || clone.textContent || '').trim();
      if (textToCopy && navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const span = msgBtn.querySelector('span');
          const orig = span ? span.textContent : msgBtn.textContent;
          if (span) span.textContent = 'Copied!';
          else msgBtn.textContent = 'Copied!';
          msgBtn.style.color = '#34d399';
          msgBtn.style.borderColor = 'rgba(52, 211, 153, 0.4)';
          setTimeout(() => {
            if (span) span.textContent = orig;
            else msgBtn.textContent = orig;
            msgBtn.style.color = '';
            msgBtn.style.borderColor = '';
          }, 2000);
        });
      }
    }
  });

  clearBtn.addEventListener('click', (e) => {
    conversationHistory.length = 0;
    sessionId = generateSessionId();
    localStorage.setItem(STORAGE_KEY, sessionId);
    clearQuotedBar();
    if (e && e.shiftKey) {
      // Shift+Click on reset re-scans the host website DOM and refreshes cached intelligent chips
      const fresh = synthesizeIntelligentSiteContext();
      activeChips = fresh.chips;
      try {
        localStorage.setItem(CHIPS_STORAGE_KEY, JSON.stringify(fresh.chips));
        localStorage.setItem(TITLE_STORAGE_KEY, fresh.title);
        localStorage.setItem(WELCOME_STORAGE_KEY, fresh.welcome);
      } catch {}
    }
    messagesBox.innerHTML = `
      <div class="cf-msg cf-msg-assistant">
        <div class="cf-bubble">
          <p>Conversation reset. How can I help you today?</p>
          <div class="cf-model-tag">
            <span>Assistant</span>
            <button class="cf-copy-msg-btn" type="button" title="Copy response">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy</span>
            </button>
          </div>
        </div>
      </div>
    `;
    if (activeModelLabel) activeModelLabel.textContent = '⚡ Auto-Routing';
    renderDefaultChips();
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
          expiresAt: actionData.expiresAt,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        statusDiv.textContent = `⚠️ Error: ${data.message || 'Verification failed'}`;
        statusDiv.className = 'cf-action-resolved rejected';
      } else if (data.message) {
        statusDiv.textContent = (approved ? '✓ ' : '✕ ') + data.message;
      }
    } catch {
      statusDiv.textContent = '⚠️ Network error during action execution.';
      statusDiv.className = 'cf-action-resolved rejected';
    }
  }

  // Render Action Card
  function renderActionCard(rawActionData, targetBubble) {
    // Escape all attacker/model-influenced fields before they hit innerHTML.
    const actionData = Object.assign({}, rawActionData, {
      description: escapeHtml(String(rawActionData.description || '')),
      riskLevel: escapeHtml(String(rawActionData.riskLevel || 'medium')),
    });
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

  // Cryptographic Proof-of-Work Challenge Solver (Anti-Bot Clearance)
  async function solveProofOfWork(challenge) {
    if (!challenge || !window.crypto || !window.crypto.subtle) return null;
    const enc = new TextEncoder();
    const targetDifficulty = challenge.targetDifficulty || 2;
    const targetPrefix = '0'.repeat(targetDifficulty);
    let nonce = 0;
    while (nonce < 100000) {
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
          solution: String(nonce),
        };
      }
      nonce++;
    }
    return null;
  }

  // Send message and stream SSE or read JSON response
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
      // Step 1: Solve Proof-of-Work challenge to clear bot shield
      let shieldSolution = null;
      try {
        const chRes = await fetch(`${apiUrl}/api/shield/challenge`);
        if (chRes.ok) {
          const chData = await chRes.json();
          shieldSolution = await solveProofOfWork(chData);
        }
      } catch {}

      // Step 2: Grab Turnstile response if present in window
      let turnstileToken = undefined;
      if (typeof window !== 'undefined' && window.turnstile && typeof window.turnstile.getResponse === 'function') {
        try {
          turnstileToken = window.turnstile.getResponse() || undefined;
        } catch {}
      }

      // Step 3: Model preference & Live Host Website UI Context awareness
      const modelPreference = (modeSelect && modeSelect.value) ? modeSelect.value : 'auto';
      const hostUiContext = captureHostWebsiteContext();

      let contextualMessage = text;
      const quote = activeQuotedSelection;
      if (quote && quote.length >= 2) {
        contextualMessage = `[Referenced page text: "${quote}"]\n${text}`;
        clearQuotedBar();
      } else if (typeof window !== 'undefined' && window.getSelection) {
        try {
          const selection = window.getSelection().toString().trim();
          if (selection && selection.length >= 2 && selection.length < 1500) {
            contextualMessage = `[Referenced page text: "${selection}"]\n${text}`;
          }
        } catch {}
      }

      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: contextualMessage,
          pageContext: hostUiContext || undefined,
          history: formatHistory(),
          modelPreference,
          shield: shieldSolution || undefined,
          turnstileToken,
        }),
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const errData = await response.json();
          cursor.remove();
          assistantBubble.innerHTML = renderMarkdown(errData.reply || errData.error || `Error HTTP ${response.status}`);
          attachModelTag(assistantBubble, 'System', 'Error');
          scrollToBottom();
          return;
        }
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      if (contentType.includes('application/json')) {
        const data = await response.json();
        cursor.remove();
        const replyText = data.reply || data.error || 'Message received.';
        assistantBubble.innerHTML = renderMarkdown(replyText);

        // Record into multi-turn conversational memory
        conversationHistory.push({ role: 'user', content: text });
        conversationHistory.push({ role: 'assistant', content: replyText });

        // Update active model indicator in header
        if (activeModelLabel) {
          const isDeep = data.routedComplexity === 'complex' || modelPreference === 'deep-reasoning';
          const modelClean = (data.usedModel || (isDeep ? 'Deep Reasoning' : 'Fast Flash'))
            .replace('openai/', '')
            .replace('meta-llama/', '');
          activeModelLabel.textContent = `${isDeep ? '🧠' : '⚡'} ${modelClean}`;
        }

        // Add model signature pill to bubble with one-click copy button
        const modelName = data.usedModel || (data.routedComplexity === 'complex' ? 'Reasoning Core' : 'Flash Edge');
        const compLabel = data.routedComplexity === 'complex' ? 'Deep Reasoning' : 'Fast Edge';
        attachModelTag(assistantBubble, compLabel, modelName);

        // Update contextual follow-up chips
        updateFollowUpChips(replyText);

        scrollToBottom();
        return;
      }

      if (!response.body) {
        throw new Error('No readable stream returned from edge.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

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
                    <span>Executing <strong>${escapeHtml(data.name)}</strong>...</span>
                  `;
                  cursor.remove();
                  assistantBubble.appendChild(currentToolPill);
                  assistantBubble.appendChild(cursor);
                  scrollToBottom();
                }
              } else if (currentEvent === 'tool_result') {
                if (currentToolPill) {
                  currentToolPill.innerHTML = `<span>✓ Tool <strong>${escapeHtml(data.name)}</strong> executed</span>`;
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
                if (accumulatedText) {
                  conversationHistory.push({ role: 'user', content: text });
                  conversationHistory.push({ role: 'assistant', content: accumulatedText });
                  const modelClean = activeModelLabel ? activeModelLabel.textContent.replace(/[🧠⚡]/g, '').trim() : 'Flash Edge';
                  attachModelTag(assistantBubble, 'Edge AI', modelClean || 'Flash Edge');
                  updateFollowUpChips(accumulatedText);
                }
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
      attachModelTag(assistantBubble, 'System', 'Error');
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
