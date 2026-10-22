import { escapeHtml } from "./scripts.js";
import { WORKSPACE_STYLES } from "./workspace-styles.js";
import { workspaceScripts } from "./workspace-scripts.js";
import { POPULAR_100_MCP_PRESETS } from "./mcp-presets-catalog.js";

/**
 * Multi-Tenant User Workspace Dashboard HTML.
 * Includes:
 * 1. Human-in-the-Loop Approvals Queue
 * 2. Persistent Conversation Thread & History + Agentic Execution Trace
 * 3. Agentic Workspace Hub (Live Task Planner, Virtual File System & Long-Term Memory)
 * 4. Account Lifecycle (Password Change, Export Data, Delete Account)
 * 5. Personal API Key Management
 * 6. Plan & Usage Metering
 *
 * The stylesheet and client script live in `workspace-styles.ts` /
 * `workspace-scripts.ts` so the markup here stays reviewable in isolation.
 */
export function getUserWorkspaceHtml(username: string, isGuest = false): string {
  const turnstileSiteKey =
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    "0x4AAAAAAFVaFzGbMCgv2_Kr";
  const safeUsername = escapeHtml(username);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Workspace • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
${WORKSPACE_STYLES}
  </style>
</head>
<body>
  <header>
    <a href="/workspace" class="brand">
      <div class="brand-logo">⚡</div>
      <div class="brand-text">ShunopsAI Workspace</div>
    </a>
    <div class="user-pill">
      ${isGuest ? `
        <div class="username-badge" style="background:rgba(245,158,11,0.15); border-color:rgba(245,158,11,0.3); color:#fbbf24;">⚡ <span id="display-username">Guest Trial</span></div>
        <a href="/login" class="btn-sub" style="font-size:12px; padding:5px 12px; text-decoration:none;">Log In</a>
        <a href="/register" class="btn-action" style="font-size:12px; padding:5px 14px; text-decoration:none; font-weight:600;">Sign Up Free</a>
      ` : `
        <div class="username-badge">👤 <span id="display-username">${safeUsername}</span></div>
        <button class="logout-btn" onclick="logout()">Sign Out</button>
      `}
    </div>
  </header>

  <div class="container">
    <div class="welcome-card">
      ${isGuest ? `
        <div class="guest-trial-banner" style="background:linear-gradient(90deg, rgba(56,189,248,0.12), rgba(99,102,241,0.12)); border:1px solid rgba(56,189,248,0.3); border-radius:12px; padding:12px 18px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:22px;">⚡</span>
            <div>
              <div style="font-size:13.5px; font-weight:700; color:#f8fafc;">Zero Signup Guest Sandbox Active</div>
              <div style="font-size:12px; color:#94a3b8;">
                Runs 100% in your browser WebAssembly (0% server load). <strong id="guest-runs-display" style="color:#38bdf8;">3 free trial runs remaining today</strong>.
              </div>
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn-action" style="font-size:11.5px; padding:6px 14px;" onclick="openSignupGateModal('Permanent Cloud Workspace')">🚀 Unlock Unlimited Workspace</button>
          </div>
        </div>
      ` : ''}
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <div>
          <h1 class="welcome-title">Welcome, ${safeUsername}!</h1>
          <div class="welcome-desc">Switch seamlessly between conversational <strong>Chat</strong> and autonomous <strong>Work</strong>.</div>
        </div>
        <!-- 2-Mode Switcher: Chat vs Work -->
        <div class="mode-switcher-bar" role="tablist" aria-label="Workspace Mode">
          <button type="button" id="mode-tab-btn-chat" class="mode-switch-btn active" onclick="switchWorkspaceMainMode('chat')">
            <span>💬 Chat</span>
            <span class="mode-switch-badge">Assistant</span>
          </button>
          <button type="button" id="mode-tab-btn-work" class="mode-switch-btn" onclick="switchWorkspaceMainMode('work')">
            <span>⚡ Work</span>
            <span class="mode-switch-badge" id="work-mode-summary-badge">Tasks &bull; Code &bull; Swarm</span>
          </button>
        </div>

        <!-- Global Model Selection Widget (Always Visible) -->
        <div class="topbar-model-selector">
          <span style="font-size:11px; color:#38bdf8; font-weight:600; display:inline-flex; align-items:center; gap:5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2"></rect>
              <rect x="9" y="9" width="6" height="6"></rect>
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"></path>
            </svg>
            Model:
          </span>
          <select id="navbar-model-select" onchange="onNavbarModelChange(this.value)">
            <optgroup label="─── Smart Modes (Auto-Failover) ───">
              <option value="auto">⚡ Auto: Smart Adaptive (Auto-Routes &amp; Self-Heals)</option>
              <option value="gemini-flash">🚀 Fast &amp; Responsive (Low Quota 🟢)</option>
              <option value="groq-120b">🧠 Deep Reasoning &amp; Math (120B AST ⚠️)</option>
              <option value="code-dev">💻 Code Architect &amp; Debugging (GPT-4o &amp; AST)</option>
              <option value="research-context">📚 Long Context &amp; Research (1M Window)</option>
            </optgroup>
            <optgroup label="─── Direct Multi-Provider Fallbacks ───">
              <option value="gemini-active">✨ Gemini Flash (3.8 Flash / Active Pool)</option>
              <option value="groq:openai/gpt-oss-120b">⚡ Groq LPU (GPT-OSS 120B AST)</option>
              <option value="groq:qwen/qwen3.8-27b">⚡ Groq LPU (Qwen 3.8 27B)</option>
              <option value="openrouter-heavy">🌐 OpenRouter (Nemotron 550B / Llama 70B)</option>
            </optgroup>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn-sub" onclick="toggleAccountModal()">⚙️ Account Settings</button>
        <a href="/portal" class="btn-action">🔑 BYOK Keys &rarr;</a>
      </div>
    </div>

    <!-- Approvals Queue Alert Bar (Shown when sensitive actions await human confirmation) -->
    <div id="workspace-approvals-box" style="display:none; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.4); border-radius:14px; padding:18px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">⚠️</span>
          <strong style="color:#f87171; font-size:15px;">Human Approval Required for Sensitive Autonomous Step</strong>
        </div>
        <button class="btn-sub" onclick="fetchWorkspaceApprovals()">🔄 Refresh</button>
      </div>
      <div id="workspace-approvals-list"></div>
    </div>

    <!-- ================================================================= -->
    <!-- MODE 1: 💬 CHAT (Clean Interactive Conversational Assistant)      -->
    <!-- ================================================================= -->
    <div id="workspace-mode-chat">
      <div class="box box-hero">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:8px;">
          <h2>💬 Chat with ShunopsAI</h2>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span id="context-badge" style="font-size:11px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              🧠 Persistent Memory Active
            </span>
            <button type="button" id="newChatBtn" onclick="startNewConversation()" class="btn-sub" style="font-size:11px; padding:3px 10px; border-color:rgba(56,189,248,0.45); color:#38bdf8; background:rgba(56,189,248,0.12); font-weight:600;" title="Start a fresh chat thread without deleting past chats">
              ✨ + New Chat
            </button>
            <button type="button" id="toggle-conv-drawer-btn" onclick="toggleConversationsDrawer()" class="btn-sub" style="font-size:11px; padding:3px 10px; border-color:rgba(56,189,248,0.35); color:#38bdf8;" title="View all past conversations">
              💬 Chats (<span id="chat-conversations-count">1</span>)
            </button>
            <button type="button" onclick="switchWorkspaceMainMode('work')" class="btn-sub" style="font-size:11px; padding:3px 10px; border-color:rgba(56,189,248,0.35); color:#38bdf8;">
              ⚡ Open Work Studio &rarr;
            </button>
            <button type="button" onclick="switchWorkspaceMainMode('work'); switchAgenticTab('files');" class="btn-sub" style="font-size:11px; padding:3px 10px; border-color:rgba(56,189,248,0.35); color:#38bdf8;" title="View all workspace files">
              📁 Files (<span id="chat-header-files-count">0</span>)
            </button>
            <button type="button" onclick="clearCurrentConversation()" style="background:transparent; border:1px solid rgba(255,255,255,0.12); color:#94a3b8; font-size:11px; padding:3px 9px; border-radius:8px; cursor:pointer; transition:all 0.15s;" title="Clear messages in this conversation">
              🧹 Clear Chat
            </button>
          </div>
        </div>

        <!-- Chat Workspace 2-Column Layout (Sidebar + Chat Area) -->
        <div class="chat-layout-wrapper" style="display:flex; gap:14px; position:relative; align-items:stretch; margin-top:10px;">
          <!-- Collapsible Left Sidebar for Conversations History -->
          <div id="chat-conversations-drawer" style="width:250px; flex-shrink:0; background:#070a13; border:1px solid #1e293b; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; max-height:680px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:6px;">
              <span style="font-size:11.5px; font-weight:600; color:#cbd5e1; display:flex; align-items:center; gap:5px;">💬 Past Chats</span>
              <button type="button" onclick="startNewConversation()" class="btn-sub" style="padding:2px 7px; font-size:10.5px; color:#38bdf8; border-color:rgba(56,189,248,0.35);" title="Start new conversation">+ New</button>
            </div>
            <div id="conversations-list-container" style="display:flex; flex-direction:column; gap:5px; overflow-y:auto; max-height:620px; padding-right:2px;">
              <div style="color:#64748b; font-size:11px; padding:8px 4px; text-align:center;">Loading conversations...</div>
            </div>
          </div>

          <!-- Main Interactive Chat Area -->
          <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
        <!-- Model Selection Bar -->
        <div class="model-bar-row">
          <div style="display:flex; align-items:center; gap:8px;">
            <label for="chat-model-select" style="font-size:12px; font-weight:500; color:#94a3b8; cursor:pointer;">Model:</label>
            <select id="chat-model-select" onchange="onModelPreferenceChange()" style="background:#090d16; color:#fff; border:1px solid #1e293b; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:500; outline:none; cursor:pointer;">
              <optgroup label="─── Smart Modes (Auto-Failover by Need) ───">
                <option value="auto">⚡ Auto: Smart Adaptive (Auto-Routes & Self-Heals)</option>
                <option value="gemini-flash">🚀 Fast & Responsive (Low Quota 🟢)</option>
                <option value="groq-120b">🧠 Deep Reasoning & Math (120B AST ⚠️)</option>
                <option value="code-dev">💻 Code Architect & Debugging (GPT-4o & AST)</option>
                <option value="research-context">📚 Long Context & Research (1M Window)</option>
                <option value="openrouter-heavy">👑 Frontier Flagship (550B & GPT-4o ⚠️)</option>
              </optgroup>
              <optgroup label="─── Google Gemini (Active Pool) ───">
                <option value="gemini:gemini-3.8-flash">Gemini 3.8 Flash (Active 1/5 🟢)</option>
                <option value="gemini:gemini-3-flash-preview">Gemini 3 Flash Preview (🟢)</option>
              </optgroup>
              <optgroup label="─── Groq Ultra-Fast LPUs ───">
                <option value="groq:openai/gpt-oss-120b">Groq GPT-OSS 120B (High Reasoning ⚠️)</option>
                <option value="groq:qwen/qwen3.8-27b">Groq Qwen 3.8 27B (Fast Tool Calling 🟢)</option>
              </optgroup>
              <optgroup label="─── GitHub Models (OpenAI Frontier via PAT) ───">
                <option value="github:gpt-4o">OpenAI GPT-4o (Frontier Omni ⚠️)</option>
                <option value="github:gpt-4o-mini">OpenAI GPT-4o Mini (Fast Q&A 🟢)</option>
                <option value="github:o1-mini">OpenAI o1-mini Reasoning (⚠️)</option>
                <option value="github:meta-llama-3.3-70b-instruct">Meta Llama 3.3 70B (GitHub)</option>
              </optgroup>
              <optgroup label="─── Cloudflare Workers AI (Serverless Edge) ───">
                <option value="cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B Fast (Edge)</option>
                <option value="cloudflare:@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B (Edge Low Quota 🟢)</option>
                <option value="cloudflare:@cf/qwen/qwen1.5-7b-chat-awq">Qwen 1.5 7B Chat (Edge)</option>
              </optgroup>
              <optgroup label="─── Open Models (OpenRouter Pool) ───">
                <option value="openrouter:nvidia/nemotron-3-ultra-550b-a55b:free">Nemotron 3 Ultra 550B (Giant ⚠️)</option>
                <option value="openrouter:nvidia/nemotron-3.5-lightning:free">Nemotron 3.5 Lightning (1M Context)</option>
                <option value="openrouter:meta-llama/llama-3.3-70b-instruct:free">Meta Llama 3.3 70B Instruct</option>
                <option value="openrouter:google/gemma-4-31b-it:free">Google Gemma 4 31B IT</option>
                <option value="openrouter:cohere/north-mini-code:free">Cohere North Mini Code</option>
                <option value="openrouter:nvidia/nemotron-3-super-120b-a12b:free">Nemotron 3 Super 120B</option>
                <option value="openrouter:qwen/qwen3.8-27b:free">Qwen 3.8 27B (OpenRouter)</option>
                <option value="openrouter:openrouter/free">OpenRouter Free Router Fallback</option>
              </optgroup>
            </select>
          </div>
          <div id="model-status-badge" style="font-size:11px; color:#10b981; display:flex; align-items:center; gap:5px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block;"></span>
            <span>Healthy</span>
          </div>
          <span id="quota-warning-badge" style="display:none;"></span>
        </div>

        <!-- Message Thread -->
        <div id="chat-thread" class="chat-thread-container">
          <div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">
            👋 Loading your persistent workspace conversation...
          </div>
        </div>

        <!-- Optional Context / Notes Drawer -->
        <div style="margin-bottom:10px;">
          <button type="button" onclick="toggleContextDrawer()" style="background:transparent; border:none; color:#38bdf8; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:6px; padding:2px 0;">
            <span id="context-toggle-arrow">▸</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span>Add Custom Context or Notes (Optional)</span>
          </button>
          <div id="custom-context-drawer" style="display:none; margin-top:8px;">
            <textarea id="custom-context-input" placeholder="Paste background notes, document snippet, code, or special instructions here to give your assistant extra context for this chat session..." style="width:100%; height:64px; background:#070a12; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12px; font-family:inherit; resize:vertical; outline:none;"></textarea>
          </div>
        </div>

        <!-- Attached Image Preview Container -->
        <div id="attached-image-container" style="display:none; align-items:center; gap:8px; padding:6px 10px; background:#0c1220; border:1px solid #1e293b; border-radius:8px; margin-bottom:8px; width:fit-content;">
          <img id="attached-image-thumb" src="" alt="Attached preview" style="max-height:48px; max-width:64px; border-radius:4px; object-fit:cover; border:1px solid #334155;">
          <div style="font-size:11px; color:#cbd5e1;">
            <div id="attached-image-name" style="font-weight:600; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">image.png</div>
            <div id="attached-image-size" style="color:#64748b; font-size:10px;"></div>
          </div>
          <button type="button" onclick="clearAttachedImage()" style="background:transparent; border:none; color:#ef4444; font-size:14px; cursor:pointer; padding:2px 6px; border-radius:4px;" title="Remove image">&times;</button>
        </div>

        <!-- Attached Document / PDF Container -->
        <div id="attached-doc-container" style="display:none; align-items:center; gap:10px; padding:7px 12px; background:rgba(168,85,247,0.1); border:1px solid rgba(168,85,247,0.3); border-radius:8px; margin-bottom:8px; width:fit-content;">
          <div style="width:28px; height:28px; border-radius:6px; background:rgba(168,85,247,0.2); display:flex; align-items:center; justify-content:center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div style="font-size:11.5px; color:#cbd5e1;">
            <div id="attached-doc-name" style="font-weight:600; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">document.pdf</div>
            <div id="attached-doc-status" style="color:#c084fc; font-size:10.5px; font-weight:500;">⚡ Vector Indexed (Ready for RAG)</div>
          </div>
          <button type="button" onclick="clearAttachedDoc()" style="background:transparent; border:none; color:#ef4444; font-size:14px; cursor:pointer; padding:2px 6px; border-radius:4px;" title="Remove document">&times;</button>
        </div>

        <!-- Input Row with Universal Attach Dropdown (+) -->
        <div class="chat-input-wrapper">
          <input type="file" id="chat-image-input" accept="image/*" style="display:none;" onchange="handleImageAttach(this)">
          <input type="file" id="chat-doc-input" accept=".pdf,.txt,.md,.json,.csv,.ts,.js,.py,.html,.css" style="display:none;" onchange="handleDocAttach(this)">

          <div class="attach-dropdown-wrapper" style="position:relative;">
            <button type="button" id="attach-plus-btn" class="attach-plus-btn" onclick="toggleAttachDropdown(event)" title="Add files: Image, PDF Document, or Connect GitHub Repo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <div id="attach-dropdown-menu" class="attach-dropdown-menu" style="display:none;">
              <button type="button" class="attach-menu-item" onclick="triggerAttachImage()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Upload Image (Vision)</span>
              </button>
              <button type="button" class="attach-menu-item" onclick="triggerAttachDoc()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>Upload PDF / Document (RAG)</span>
              </button>
              <button type="button" class="attach-menu-item" onclick="openGitHubModal()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                <span>Connect GitHub Repo (RAG)</span>
              </button>
            </div>
          </div>

          <input type="text" id="user-chat-input" class="chat-input" placeholder="Ask anything, or tell your agent to plan tasks, run code, or write files..." onkeydown="if(event.key==='Enter') sendUserChat(true)">
          <button class="chat-send-btn" id="send-btn" onclick="sendUserChat()">Send</button>
        </div>

        <!-- Agentic Quick Action Chips -->
        <div class="quick-chips">
          <div class="chip" onclick="askSuggestion('Create a 4-step action plan for launching my API and mark step 1 in progress')">📋 Create Task Plan</div>
          <div class="chip" onclick="askSuggestion('Search the web for OpenTelemetry distributed tracing best practices and save a summary to otel-guide.md')">🌐 Web Research &rarr; File</div>
          <div class="chip" onclick="askSuggestion('Write and execute a JavaScript benchmark in the sandbox to compare Map vs Object lookup speed')">💻 Run Code in Sandbox</div>
          <div class="chip" onclick="askSuggestion('Remember that my preferred tech stack is TypeScript, Fastify, and PostgreSQL')">🧠 Save Agent Memory</div>
        </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODE 2: ⚡ WORK (Unified Autonomous Tasks, Code, Swarm & Files)   -->
    <!-- ================================================================= -->
    <div id="workspace-mode-work" style="display:none;">
      <div class="work-grid">
        <!-- Left Column: Unified Execution Studio (Task Goal / AI Code Sandbox / 4-Agent Swarm) -->
        <div class="box" style="margin-bottom:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <div>
              <h2>⚡ Autonomous Work Studio</h2>
              <p style="margin-bottom:0; font-size:12px;">Execute multi-step goals, custom AI code in the sandbox, or 4-agent swarms — all synced with your workspace.</p>
            </div>
            <span style="font-size:10.5px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:3px 9px; border-radius:12px; font-weight:600;">
              🔒 Isolated Tenant Scope
            </span>
          </div>

          <!-- 3 Sub-Engine Tabs inside Work Studio -->
          <div class="work-engine-tabs">
            <button type="button" id="work-subtab-btn-task" class="work-engine-tab active" onclick="switchWorkEngineTab('task')">
              🚀 Autonomous Goal
            </button>
            <button type="button" id="work-subtab-btn-code" class="work-engine-tab" onclick="switchWorkEngineTab('code')">
              💻 AI Code &amp; Sandbox
            </button>
            <button type="button" id="work-subtab-btn-swarm" class="work-engine-tab" onclick="switchWorkEngineTab('swarm')">
              🐝 4-Agent Swarm
            </button>
          </div>

          <!-- Sub-Panel 1: Autonomous Multi-Step Task Runner -->
          <div id="work-subpanel-task">
            <label for="task-goal-input" style="font-size:11.5px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:6px;">
              What goal should the agent execute autonomously?
            </label>
            <textarea id="task-goal-input" rows="4" placeholder="e.g. Research Redis caching patterns, benchmark lookup latency in the sandbox, create a 3-step rollout plan, and save config.json to my workspace" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:10px; padding:10px 12px; color:#fff; font-size:13px; outline:none; resize:vertical; line-height:1.5;"></textarea>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
              <select id="task-max-steps" style="background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12.5px; outline:none;">
                <option value="3">Max 3 steps (Fast)</option>
                <option value="6" selected>Max 6 steps (Balanced)</option>
                <option value="10">Max 10 steps (Deep)</option>
              </select>
              <button class="btn-action" style="flex:1; justify-content:center;" onclick="runAutonomousTask()">▶ Run Autonomous Goal</button>
            </div>
            <div id="task-run-status" style="display:none; margin-top:12px; font-size:12px; line-height:1.5; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:12px; white-space:pre-wrap; word-break:break-word;"></div>
            <div id="workspace-recent-tasks" style="margin-top:12px; font-size:11.5px; color:#94a3b8;"></div>
          </div>

          <!-- Sub-Panel 2: Custom AI Code & Sandbox Studio (No Hardcoded Restriction!) -->
          <div id="work-subpanel-code" style="display:none;">
            <!-- AI Custom Task-to-Code Generator Bar -->
            <div style="background:#060a12; border:1px solid rgba(56,189,248,0.25); border-radius:10px; padding:12px; margin-bottom:12px;">
              <label for="work-code-task-prompt" style="font-size:11.5px; color:#38bdf8; font-weight:700; display:block; margin-bottom:6px;">
                ✨ Run Any Custom Task (AI Writes &amp; Executes Code for You)
              </label>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <input type="text" id="work-code-task-prompt" placeholder="Describe any task (e.g. 'Generate 10 mock orders, calculate GST & save to orders.json' or 'Benchmark Set vs Array')..." onkeydown="if(event.key==='Enter') runAiCodeTaskFromWork()" style="flex:1; min-width:200px; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12.5px; outline:none;" />
                <button type="button" class="btn-action" id="work-ai-code-btn" onclick="runAiCodeTaskFromWork()" style="padding:8px 14px; font-size:12px;">
                  ✨ AI Generate &amp; Run
                </button>
              </div>
            </div>

            <!-- Template Presets & Clear Bar -->
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
              <span style="font-size:11px; color:#94a3b8; font-weight:600;">JavaScript Editor (Editable &bull; V8 Sandbox):</span>
              <div style="display:flex; gap:5px; flex-wrap:wrap;">
                <button type="button" class="btn-sub" style="font-size:10.5px; padding:3px 8px;" onclick="loadSandboxTemplate('blank')">🧹 Blank</button>
                <button type="button" class="btn-sub" style="font-size:10.5px; padding:3px 8px;" onclick="loadSandboxTemplate('benchmark')">⚡ Benchmark</button>
                <button type="button" class="btn-sub" style="font-size:10.5px; padding:3px 8px;" onclick="loadSandboxTemplate('file_gen')">📄 Save JSON File</button>
                <button type="button" class="btn-sub" style="font-size:10.5px; padding:3px 8px;" onclick="loadSandboxTemplate('stats')">📊 Math &amp; Stats</button>
              </div>
            </div>

            <textarea id="work-sandbox-code-input" rows="8" placeholder="// Write any custom JavaScript code here, or use the AI Task bar above...
// Helpers: writeWorkspaceFile(name, text), readWorkspaceFile(name), sum(), mean(), median(), stdDev(), groupBy(), csvParse(), formatMarkdownTable()
" style="width:100%; background:#050811; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12px; font-family:'JetBrains Mono', monospace; line-height:1.5; resize:vertical; outline:none;"></textarea>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn-action" id="work-sandbox-exec-btn" onclick="executeWorkSandboxCode()">▶ Execute Custom Code</button>
              <span id="work-sandbox-run-meta" style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono', monospace;"></span>
            </div>

            <div id="work-sandbox-output-box" style="display:none; margin-top:12px; background:#070a12; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; font-size:12px; font-family:'JetBrains Mono', monospace;">
              <div style="font-size:10.5px; color:#64748b; text-transform:uppercase; margin-bottom:4px; font-weight:700;">Sandbox Execution Output</div>
              <pre id="work-sandbox-output-content" style="margin:0; white-space:pre-wrap; word-break:break-word; color:#38bdf8;"></pre>
            </div>
          </div>

          <!-- Sub-Panel 3: 4-Agent Swarm Orchestrator (Dynamic Blackboard) -->
          <div id="work-subpanel-swarm" style="display:none;">
            <div style="font-size:11.5px; color:#94a3b8; margin-bottom:10px; line-height:1.45;">
              Coordinate <strong>🔍 Researcher</strong>, <strong>💻 Coder</strong>, <strong>📊 Analyst</strong> &amp; <strong>🛡️ Auditor</strong> on a Shared Blackboard. Each agent dynamically adapts to your objective.
            </div>
            <div style="margin-bottom:8px;">
              <label for="work-swarm-objective-input" style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Swarm Objective (Type any topic or system to research, benchmark &amp; audit)</label>
              <input type="text" id="work-swarm-objective-input" placeholder="e.g. Evaluate Redis Caching vs In-Memory LRU Cache for high-throughput Fastify APIs" value="Evaluate Redis Caching vs In-Memory LRU Cache for high-throughput Fastify APIs" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12.5px; outline:none;" />
            </div>
            <div class="swarm-grid-responsive">
              <div>
                <label for="work-swarm-mode-select" style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Execution Mode</label>
                <select id="work-swarm-mode-select" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 9px; color:#fff; font-size:12px; outline:none;">
                  <option value="hybrid_dag" selected>⚡ Hybrid DAG (Wave 1 Research+Code &rarr; Wave 2 Analyst &rarr; Auditor)</option>
                  <option value="sequential">🔗 Sequential Handoff (Researcher &rarr; Coder &rarr; Analyst &rarr; Auditor)</option>
                  <option value="parallel">🚀 Full Parallel Fan-Out (All 4 Run Concurrently)</option>
                </select>
              </div>
              <div>
                <label for="work-swarm-deliverable-input" style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Save Deliverable File</label>
                <input type="text" id="work-swarm-deliverable-input" value="swarm-audit-report.md" placeholder="e.g. swarm-report.md" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 9px; color:#fff; font-size:12px; font-family:'JetBrains Mono', monospace; outline:none;" />
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn-action" id="work-swarm-dispatch-btn" onclick="dispatchSwarmFromWork()">🐝 Dispatch 4-Agent Swarm</button>
              <span id="work-swarm-run-meta" style="font-size:11px; color:#c084fc; font-family:'JetBrains Mono', monospace;"></span>
            </div>
            <div id="work-swarm-blackboard-box" style="display:none; max-height:340px; overflow-y:auto; background:#050811; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; font-size:12px;"></div>
          </div>
        </div>

        <!-- Right Column: Workspace Hub (Tasks, Files, Memory, Watchdogs) & Utilities -->
        <aside class="workspace-sidebar">
          <div class="box box-sidebar">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <h2>🗂️ Workspace Files, Tasks &amp; Memory</h2>
              <div style="display:flex; align-items:center; gap:6px;">
                <span id="sync-status-badge" style="font-size:10.5px; color:#10b981; display:none;">✓ Synced</span>
                <button type="button" class="btn-sub" style="font-size:10.5px; padding:3px 9px;" onclick="loadAgenticWorkspaceState(true)" title="Sync without losing records">↻ Sync</button>
              </div>
            </div>
            <!-- 4-Tab Switcher -->
            <div style="display:flex; gap:4px; background:#060a12; padding:3px; border-radius:8px; border:1px solid #1e293b; margin-bottom:10px;">
              <button type="button" id="agentic-tab-btn-tasks" onclick="switchAgenticTab('tasks')" style="flex:1; font-size:11px; padding:5px 6px; border-radius:6px; background:#2563eb; color:#fff; border:none; font-weight:600; cursor:pointer;">
                📋 Tasks (<span id="agentic-tasks-count">0</span>)
              </button>
              <button type="button" id="agentic-tab-btn-files" onclick="switchAgenticTab('files')" style="flex:1; font-size:11px; padding:5px 6px; border-radius:6px; background:transparent; color:#94a3b8; border:none; font-weight:600; cursor:pointer;">
                📁 Files (<span id="agentic-files-count">0</span>)
              </button>
              <button type="button" id="agentic-tab-btn-memory" onclick="switchAgenticTab('memory')" style="flex:1; font-size:10.5px; padding:5px 4px; border-radius:6px; background:transparent; color:#94a3b8; border:none; font-weight:600; cursor:pointer;">
                🧠 Mem (<span id="agentic-memory-count">0</span>)
              </button>
              <button type="button" id="agentic-tab-btn-schedules" onclick="switchAgenticTab('schedules')" style="flex:1; font-size:10.5px; padding:5px 4px; border-radius:6px; background:transparent; color:#94a3b8; border:none; font-weight:600; cursor:pointer;">
                ⏰ Watch (<span id="agentic-schedules-count">0</span>)
              </button>
            </div>

            <!-- Tab 1: Live Agent Task Checklist -->
            <div id="agentic-panel-tasks">
              <div id="agentic-tasks-progress" style="display:none; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:#94a3b8; margin-bottom:4px;">
                  <span id="agentic-tasks-progress-label">0/0 completed</span>
                  <button type="button" onclick="clearCompletedAgentTasks()" style="background:transparent; border:none; color:#38bdf8; font-size:10.5px; cursor:pointer; padding:0;">Clear Done</button>
                </div>
                <div style="background:#1e293b; border-radius:5px; height:5px; overflow:hidden;">
                  <div id="agentic-tasks-progress-bar" style="background:#10b981; height:100%; width:0%; transition:width 0.3s;"></div>
                </div>
              </div>
              <div id="agentic-tasks-list" style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:#94a3b8; margin-bottom:8px;">
                <div style="color:#64748b; font-size:11px; padding:6px 0;">No active task plan yet. Run a goal or add a step below.</div>
              </div>
              <div style="display:flex; gap:6px;">
                <input type="text" id="agentic-new-task-input" placeholder="Add step to checklist..." onkeydown="if(event.key==='Enter') addManualAgentTask()" style="flex:1; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:5px 8px; color:#fff; font-size:11.5px; outline:none;" />
                <button type="button" class="btn-sub" style="padding:5px 9px; font-size:11px;" onclick="addManualAgentTask()">+ Add</button>
              </div>
            </div>

            <!-- Tab 2: Virtual Workspace File Explorer -->
            <div id="agentic-panel-files" style="display:none;">
              <div id="agentic-files-list" style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:#94a3b8; margin-bottom:8px;">
                <div style="color:#64748b; font-size:11px; padding:6px 0;">No workspace files yet. Run a task or create a file below.</div>
              </div>
              <button type="button" class="btn-sub" style="width:100%; padding:6px; font-size:11px; border-color:rgba(56,189,248,0.35); color:#38bdf8;" onclick="openWorkspaceFileModal('', '')">+ Create New Workspace File</button>
            </div>

            <!-- Tab 3: Long-Term Semantic Memory Store -->
            <div id="agentic-panel-memory" style="display:none;">
              <div id="agentic-memory-list" style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:#94a3b8; margin-bottom:8px;">
                <div style="color:#64748b; font-size:11px; padding:6px 0;">No saved memories yet. Save your stack or preferences below.</div>
              </div>
              <div style="display:flex; flex-direction:column; gap:5px;">
                <div style="display:flex; gap:5px;">
                  <input type="text" id="agentic-mem-key-input" placeholder="Key (e.g. stack)" style="width:38%; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:5px 7px; color:#fff; font-size:11px; outline:none;" />
                  <input type="text" id="agentic-mem-fact-input" placeholder="Fact to remember..." onkeydown="if(event.key==='Enter') addManualAgentMemory()" style="flex:1; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:5px 7px; color:#fff; font-size:11px; outline:none;" />
                  <button type="button" class="btn-sub" style="padding:5px 8px; font-size:11px;" onclick="addManualAgentMemory()">Save</button>
                </div>
              </div>
            </div>

            <!-- Tab 4: Autonomous Scheduled Monitors & Watchdogs -->
            <div id="agentic-panel-schedules" style="display:none;">
              <div id="agentic-schedules-list" style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:#94a3b8; margin-bottom:8px;">
                <div style="color:#64748b; font-size:11px; padding:6px 0;">No active watchdogs yet. Add a website monitor or research digest below.</div>
              </div>
              <div style="display:flex; flex-direction:column; gap:5px;">
                <div style="display:flex; gap:5px;">
                  <input type="text" id="agentic-sched-name-input" placeholder="Monitor name..." style="width:40%; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:5px 7px; color:#fff; font-size:11px; outline:none;" />
                  <input type="text" id="agentic-sched-target-input" placeholder="https://... or search query" onkeydown="if(event.key==='Enter') addManualAgentSchedule()" style="flex:1; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:5px 7px; color:#fff; font-size:11px; outline:none;" />
                  <button type="button" class="btn-sub" style="padding:5px 8px; font-size:11px;" onclick="addManualAgentSchedule()">+ Watch</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Plan & Token Usage Meter -->
          <div class="box box-sidebar">
            <h2>📊 Token Usage</h2>
            <div style="background:#090d16; border:1px solid #1e293b; border-radius:10px; padding:12px 14px; margin-bottom:10px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:12.5px;">
                <span>Plan: <strong id="user-plan-badge" style="color:#38bdf8;">Community</strong></span>
                <span>Tokens: <strong id="user-usage-count" style="color:#fff;">0</strong> / <span id="user-usage-limit">1.5M</span></span>
              </div>
              <div style="background:#1e293b; border-radius:6px; height:7px; overflow:hidden; margin-bottom:10px;">
                <div id="user-usage-bar" style="background:linear-gradient(90deg, #38bdf8, #2563eb); height:100%; width:0%; transition:width 0.4s;"></div>
              </div>
              <div id="token-breakdown-row" style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 8px; margin-bottom:8px;">
                <span>📥 In: <strong id="user-in-tokens" style="color:#cbd5e1;">0</strong></span>
                <span>📤 Out: <strong id="user-out-tokens" style="color:#cbd5e1;">0</strong></span>
                <span>⚡ <strong id="user-query-calls" style="color:#cbd5e1;">0</strong> Calls</span>
              </div>
              <div style="font-size:11px; color:#94a3b8;">
                Need unlimited tokens? Connect your free Groq or Gemini key in the <a href="/portal" style="color:#38bdf8;">BYOK Portal</a>.
              </div>
            </div>
          </div>

          <!-- Website Chatbot Widget Embed Snippet Box -->
          <div class="box box-sidebar">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <h2>🤖 Website Chatbot</h2>
              <span style="font-size:10px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
                Edge CDN
              </span>
            </div>
            <p>Embed customer agent widget on external sites (WordPress, Shopify, HTML).</p>
            <div class="code-snippet-box">
              <div class="code-snippet-header">
                <div class="code-snippet-lang">
                  <span class="code-dot"></span>
                  <span>HTML</span>
                </div>
                <button type="button" class="copy-code-btn" onclick="copyWorkspaceWidgetSnippet(this)">
                  <svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="btn-label">Copy code</span>
                </button>
              </div>
              <pre class="code-snippet-content"><code>&lt;script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" data-api-url="https://edge-agent-widget.shunopsai.workers.dev" defer&gt;&lt;/script&gt;</code></pre>
            </div>
            <div style="font-size:10.5px; color:#64748b; margin-top:8px;">
              💡 Paste right before <code>&lt;/body&gt;</code> in your website template.
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>

  <!-- Workspace File Viewer / Editor Modal -->
  <div id="workspace-file-modal" class="modal-overlay" onclick="if(event.target === this) closeWorkspaceFileModal()" style="z-index:1150;">
    <div class="modal-dialog" style="max-width:680px;">
      <div class="modal-header">
        <h2 id="workspace-file-modal-title">📄 Workspace File</h2>
        <button class="modal-close-btn" onclick="closeWorkspaceFileModal()" title="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:10px;">
          <label for="workspace-file-name-input" style="font-size:11.5px; color:#94a3b8; display:block; margin-bottom:4px;">Filename (e.g. <code>architecture.md</code>, <code>script.js</code>)</label>
          <input type="text" id="workspace-file-name-input" placeholder="notes.md" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12.5px; font-family:'JetBrains Mono', monospace; outline:none;" />
        </div>
        <div style="margin-bottom:12px;">
          <label for="workspace-file-content-input" style="font-size:11.5px; color:#94a3b8; display:block; margin-bottom:4px;">Content</label>
          <textarea id="workspace-file-content-input" rows="13" placeholder="Write or inspect file content..." style="width:100%; background:#050811; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12px; font-family:'JetBrains Mono', monospace; line-height:1.5; resize:vertical; outline:none;"></textarea>
        </div>
        <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn-sub" onclick="copyCurrentWorkspaceFile(this)">📋 Copy</button>
            <button type="button" class="btn-sub" onclick="downloadCurrentWorkspaceFile()">📥 Download</button>
            <button type="button" id="workspace-file-run-btn" class="btn-sub" style="border-color:rgba(16,185,129,0.35); color:#10b981; display:none;" onclick="runCurrentWorkspaceFileInSandbox()">▶ Run JS</button>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn-sub" onclick="closeWorkspaceFileModal()">Cancel</button>
            <button type="button" class="btn-action" onclick="saveCurrentWorkspaceFile()">💾 Save File</button>
          </div>
        </div>
      </div>
    </div>
  </div>


  <!-- Sandbox Code Runner Modal -->
  <div id="sandbox-code-modal" class="modal-overlay" onclick="if(event.target === this) closeSandboxCodeModal()" style="z-index:1160;">
    <div class="modal-dialog" style="max-width:700px;">
      <div class="modal-header">
        <h2>💻 Autonomous Code Sandbox</h2>
        <button class="modal-close-btn" onclick="closeSandboxCodeModal()" title="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:#060a12; border:1px solid rgba(56,189,248,0.25); border-radius:10px; padding:10px 12px; margin-bottom:10px;">
          <label for="modal-code-task-prompt" style="font-size:11px; color:#38bdf8; font-weight:700; display:block; margin-bottom:5px;">
            ✨ Ask AI to Write &amp; Run Code for Any Custom Task
          </label>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <input type="text" id="modal-code-task-prompt" placeholder="e.g. 'Generate 15 mock users, group by role, and save to users.json'..." onkeydown="if(event.key==='Enter') runAiCodeTaskFromModal()" style="flex:1; min-width:180px; background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; outline:none;" />
            <button type="button" class="btn-action" id="modal-ai-code-btn" onclick="runAiCodeTaskFromModal()" style="padding:6px 12px; font-size:11.5px;">✨ AI Write &amp; Run</button>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
          <span style="font-size:11px; color:#94a3b8;">Or write/edit custom JavaScript directly:</span>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            <button type="button" class="btn-sub" style="font-size:10px; padding:2px 7px;" onclick="loadSandboxTemplate('blank', true)">🧹 Blank</button>
            <button type="button" class="btn-sub" style="font-size:10px; padding:2px 7px;" onclick="loadSandboxTemplate('benchmark', true)">⚡ Benchmark</button>
            <button type="button" class="btn-sub" style="font-size:10px; padding:2px 7px;" onclick="loadSandboxTemplate('file_gen', true)">📄 Save File</button>
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <textarea id="sandbox-code-input" rows="9" placeholder="// Type any custom JavaScript code here, or use the AI task bar above...\nreturn sum([12, 34, 56, 78]);" style="width:100%; background:#050811; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12px; font-family:'JetBrains Mono', monospace; line-height:1.5; resize:vertical; outline:none;"></textarea>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <button type="button" class="btn-action" id="sandbox-exec-btn" onclick="executeSandboxCodeFromModal()">▶ Execute Code</button>
          <span id="sandbox-run-meta" style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono', monospace;"></span>
        </div>
        <div id="sandbox-output-box" style="display:none; background:#070a12; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; font-size:12px; font-family:'JetBrains Mono', monospace;">
          <div style="font-size:10.5px; color:#64748b; text-transform:uppercase; margin-bottom:4px; font-weight:700;">Output</div>
          <pre id="sandbox-output-content" style="margin:0; white-space:pre-wrap; word-break:break-word; color:#38bdf8;"></pre>
        </div>
      </div>
    </div>
  </div>


  <!-- Multi-Agent Swarm Orchestrator Modal -->
  <div id="swarm-launcher-modal" class="modal-overlay" onclick="if(event.target === this) closeSwarmLauncherModal()" style="z-index:1165;">
    <div class="modal-dialog" style="max-width:740px;">
      <div class="modal-header">
        <h2>🐝 Multi-Agent Swarm Orchestrator (Shared Blackboard)</h2>
        <button class="modal-close-btn" onclick="closeSwarmLauncherModal()" title="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="font-size:11.5px; color:#94a3b8; margin-bottom:10px; line-height:1.45;">
          Coordinate up to 4 specialized sub-agents (<strong>🔍 Researcher</strong>, <strong>💻 Coder</strong>, <strong>📊 Analyst</strong>, <strong>🛡️ Auditor</strong>) sharing a tenant-isolated Blackboard and saving the synthesized report directly to your workspace.
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Swarm Objective</label>
          <input type="text" id="swarm-objective-input" value="Research OpenTelemetry tracing overhead, benchmark sampling rates in sandbox, and produce a security & architecture audit" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; color:#fff; font-size:12px; outline:none;" />
        </div>
        <div class="swarm-grid-responsive">
          <div>
            <label style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Execution Mode</label>
            <select id="swarm-mode-select" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 9px; color:#fff; font-size:12px; outline:none;">
              <option value="hybrid_dag" selected>⚡ Hybrid DAG (Wave 1 Parallel Research+Code &rarr; Wave 2 Analyst &rarr; Auditor)</option>
              <option value="sequential">🔗 Sequential Blackboard Handoff (Researcher &rarr; Coder &rarr; Analyst &rarr; Auditor)</option>
              <option value="parallel">🚀 Full Parallel Fan-Out (All Sub-Agents Run Concurrently)</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px; color:#cbd5e1; font-weight:600; display:block; margin-bottom:4px;">Save Deliverable File</label>
            <input type="text" id="swarm-deliverable-input" value="swarm-audit-report.md" placeholder="e.g. swarm-report.md" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 9px; color:#fff; font-size:12px; font-family:'JetBrains Mono', monospace; outline:none;" />
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <button type="button" class="btn-action" id="swarm-dispatch-btn" onclick="dispatchSwarmFromModal()">🐝 Dispatch 4-Agent Swarm</button>
          <span id="swarm-run-meta" style="font-size:11px; color:#c084fc; font-family:'JetBrains Mono', monospace;"></span>
        </div>
        <div id="swarm-blackboard-box" style="display:none; max-height:280px; overflow-y:auto; background:#050811; border:1px solid #1e293b; border-radius:8px; padding:10px 12px; font-size:12px;"></div>
      </div>
    </div>
  </div>

  <!-- Account Settings & Security Modal -->
  <div id="account-settings-modal" class="modal-overlay" onclick="if(event.target === this) toggleAccountModal(false)">
    <div class="modal-dialog">
      <div class="modal-header">
        <h2>⚙️ Account &amp; Security Settings</h2>
        <button class="modal-close-btn" onclick="toggleAccountModal(false)" title="Close">&times;</button>
      </div>
      <div class="modal-body">
        <!-- Personal API Keys Section -->
        <div class="modal-section-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin:0;">
              🔑 Personal API Keys
            </h3>
            <span style="font-size:11px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 8px; border-radius:12px; font-weight:600;">
              Active &amp; Functional
            </span>
          </div>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Generate isolated <code>shun_*</code> secret keys to invoke tasks from external scripts, webhooks, or n8n workflows.
          </p>
          <div style="display:flex; gap:8px; margin-bottom:12px;">
            <input type="text" id="api-key-name-input" placeholder="Key description (e.g. n8n runner)" style="flex:1; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 10px; color:#fff; font-size:12px; outline:none;" />
            <button class="btn-sub" onclick="generateApiKey()">+ Create Key</button>
          </div>
          <div id="new-key-display" style="display:none; background:rgba(16,185,129,0.12); border:1px solid #10b981; border-radius:8px; padding:12px; margin-bottom:12px; font-size:12px;">
            <div style="font-weight:600; color:#10b981; margin-bottom:6px;">New Key Generated (Save it now — cannot be displayed again):</div>
            <div style="display:flex; gap:8px; align-items:center; background:#050811; border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:6px 10px;">
              <code id="new-key-value" style="font-family:'JetBrains Mono', monospace; word-break:break-all; color:#fff; font-size:12px; flex:1;"></code>
              <button type="button" class="copy-code-btn" onclick="copyNewApiKey(this)">
                <svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="btn-label">Copy</span>
              </button>
            </div>
          </div>
          <div id="user-keys-list" style="font-size:12px; color:#94a3b8; font-family:'JetBrains Mono', monospace;">
            Loading active keys...
          </div>
        </div>

        <!-- Platform Connections (the user's OWN provider credentials) -->
        <div class="modal-section-card">
          <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            🔌 Platform Connections
          </h3>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Your agent tasks run with <strong>your own</strong> credentials. Connect a platform here and the assistant can act on it — your commands can only ever touch your account, never anyone else's.
          </p>
          <div id="platform-connected-list" style="font-size:12px; color:#94a3b8;">Loading connected platforms...</div>
          <div id="platform-vault-warning" style="display:none; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.45); border-radius:8px; padding:10px; margin-top:12px; font-size:11.5px; color:#fbbf24; line-height:1.5;">
            ⚠️ Credential storage is not configured on this server, so platform accounts cannot be connected yet. An operator must set <code>CREDENTIALS_ENCRYPTION_KEY</code>.
          </div>
          <div style="border-top:1px solid #1e293b; margin-top:14px; padding-top:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <label for="platform-select" style="font-size:12px; font-weight:600; color:#fff;">Connect a Platform</label>
              <button type="button" class="btn-sub" style="font-size:11px; padding:3px 8px; border-color:rgba(56,189,248,0.3); color:#38bdf8; background:rgba(56,189,248,0.08);" onclick="openMcpDirectoryModal()">
                🔍 Browse 100+ Directory
              </button>
            </div>
            <!-- Category Tabs: Direct Native / Local Bridge / Remote MCP -->
            <div id="inline-tier-tabs" style="display:flex; gap:6px; margin-bottom:10px; background:#060a12; padding:3px; border-radius:8px; border:1px solid #1e293b;">
              <button type="button" id="tab-tier-native" class="tier-tab-pill active" onclick="setInlineTierFilter('native')" style="flex:1; font-size:11px; padding:6px 8px; border-radius:6px; background:#10b981; color:#fff; border:none; font-weight:600; cursor:pointer; text-align:center; transition:all 0.15s;">
                ⚡ Direct Native Drivers
              </button>
              <button type="button" id="tab-tier-local_bridge" class="tier-tab-pill" onclick="setInlineTierFilter('local_bridge')" style="flex:1; font-size:11px; padding:6px 8px; border-radius:6px; background:transparent; color:#94a3b8; border:none; font-weight:600; cursor:pointer; text-align:center; transition:all 0.15s;">
                💻 Local Bridge
              </button>
              <button type="button" id="tab-tier-mcp" class="tier-tab-pill" onclick="setInlineTierFilter('mcp')" style="flex:1; font-size:11px; padding:6px 8px; border-radius:6px; background:transparent; color:#94a3b8; border:none; font-weight:600; cursor:pointer; text-align:center; transition:all 0.15s;">
                🌐 Remote MCP
              </button>
            </div>
            <select id="platform-select" onchange="onPlatformSelectChange()" style="width:100%; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:7px 10px; color:#fff; font-size:12px; outline:none;"></select>
            <div id="platform-connect-note" style="font-size:11px; color:#f59e0b; margin-top:6px; line-height:1.45;"></div>
            <div id="platform-field-inputs" style="margin-top:8px; display:flex; flex-direction:column; gap:8px;"></div>
            <div id="platform-buttons-row" style="display:flex; gap:8px; margin-top:10px;">
              <button id="platform-test-button" class="btn-sub" style="flex:1; border-color:rgba(56,189,248,0.4); color:#38bdf8; padding:8px; display:none;" onclick="testMcpConnection()">Test Connection 🔌</button>
              <button id="platform-connect-button" class="btn-sub" style="flex:1; background:#2563eb; color:#fff; border:none; padding:8px;" onclick="connectPlatformCredential()">Connect Account</button>
            </div>
            <div id="mcp-test-status" style="display:none; font-size:11.5px; margin-top:8px; padding:8px 10px; border-radius:6px; line-height:1.45;"></div>
            <div id="platform-connect-status" role="status" aria-live="polite" style="font-size:11.5px; margin-top:8px; line-height:1.5;"></div>
            <div style="font-size:10.5px; color:#64748b; margin-top:8px;">
              🔒 Secrets are encrypted at rest (AES-256-GCM) and only shown back to you as a 4-character hint.
            </div>
          </div>
        </div>

        <!-- Account Security & Lifecycle Section -->
        <div class="modal-section-card">
          <h3 style="font-size:15px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            🔒 Account Privacy &amp; Security
          </h3>
          <p style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:12px;">
            Manage your password, export your complete workspace activity (GDPR), or permanently close your account.
          </p>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn-sub" onclick="togglePasswordChangeDrawer()">🔑 Change Password</button>
            <div id="password-change-drawer" style="display:none; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:12px;">
              <input type="password" id="pw-current" placeholder="Current Password" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; margin-bottom:8px; outline:none;" />
              <input type="password" id="pw-new" placeholder="New Password (min 8 chars)" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; margin-bottom:8px; outline:none;" />
              <button class="btn-sub" style="background:#2563eb; color:#fff; border:none; width:100%; padding:8px;" onclick="submitPasswordChange()">Update Password</button>
            </div>
            <button class="btn-sub" onclick="exportMyData()">📥 Export My Data (JSON)</button>
            <button class="btn-sub" style="border-color:rgba(239,68,68,0.4); color:#ef4444;" onclick="deleteMyAccount()">🗑️ Delete My Account Permanently</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- MCP Directory & Presets Explorer Modal -->
  <div id="mcp-directory-modal" class="modal-overlay" onclick="if(event.target === this) toggleMcpDirectoryModal(false)" style="z-index:1100;">
    <div class="modal-dialog mcp-modal-dialog">
      <div class="modal-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:22px;">⚡</span>
          <div>
            <h2 style="font-size:16px; margin:0;">Model Context Protocol (MCP) Directory</h2>
            <div style="font-size:11px; color:#94a3b8;">Discover 100+ popular verified MCP servers with 1-click presets</div>
          </div>
        </div>
        <button class="modal-close-btn" onclick="toggleMcpDirectoryModal(false)" title="Close">&times;</button>
      </div>
      <div class="mcp-modal-body">
        <!-- Search bar, Tier Filter Chips & Count badge -->
        <div style="position:sticky; top:0; z-index:5; background:#0b1120; padding-bottom:12px;">
          <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
            <input type="text" id="mcp-search-input" oninput="filterMcpDirectory()" placeholder="🔍 Search 100+ connectors (e.g. search, postgres, github, docker, gcp, redis, sqlite)..." style="flex:1; background:#060a12; border:1px solid #1e293b; border-radius:8px; padding:10px 14px; color:#fff; font-size:13px; outline:none;" />
            <span id="mcp-count-badge" style="font-size:11px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:8px 12px; border-radius:8px; font-weight:600; white-space:nowrap;">100 Connectors</span>
          </div>
          <!-- 3-Tier Filter Chips -->
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-sub" id="tier-tab-all" onclick="setPresetTierFilter('all')" style="font-size:11px; padding:4px 12px; border-radius:14px; background:rgba(255,255,255,0.08); color:#fff; border-color:rgba(255,255,255,0.2);">All Connectors</button>
            <button type="button" class="btn-sub" id="tier-tab-native" onclick="setPresetTierFilter('native')" style="font-size:11px; padding:4px 12px; border-radius:14px; border-color:rgba(16,185,129,0.35); color:#10b981; background:rgba(16,185,129,0.08);">⚡ Direct Native Drivers</button>
            <button type="button" class="btn-sub" id="tier-tab-local" onclick="setPresetTierFilter('local_bridge')" style="font-size:11px; padding:4px 12px; border-radius:14px; border-color:rgba(245,158,11,0.35); color:#f59e0b; background:rgba(245,158,11,0.08);">💻 Self-Hosted / Local Bridge</button>
            <button type="button" class="btn-sub" id="tier-tab-mcp" onclick="setPresetTierFilter('mcp')" style="font-size:11px; padding:4px 12px; border-radius:14px; border-color:rgba(56,189,248,0.35); color:#38bdf8; background:rgba(56,189,248,0.08);">🌐 Remote MCP Servers</button>
          </div>
        </div>
        <!-- MCP Presets Grid: Exactly 3 items per row (3 ke neeche 3) -->
        <div id="mcp-presets-grid" class="mcp-presets-grid">
          <!-- Dynamically populated via JS -->
        </div>
      </div>
    </div>
  </div>

    <!-- Hard Signup Gate Modal (Zero Signup Barrier Protection) -->
  <div id="signup-gate-modal" class="modal-overlay" onclick="if(event.target === this) closeSignupGateModal()" style="display:none; z-index:1250;">
    <div class="modal-content" style="max-width:480px; text-align:center; padding:32px 28px; background:#0b0f19; border:1px solid #1e293b; border-radius:16px; box-shadow:0 25px 50px rgba(0,0,0,0.85);">
      <div style="font-size:44px; margin-bottom:12px;">🔒</div>
      <h2 id="signup-gate-title" style="color:#f8fafc; font-size:20px; font-weight:700; margin-bottom:10px;">Sign Up to Unlock Feature</h2>
      <p id="signup-gate-desc" style="color:#94a3b8; font-size:13.5px; line-height:1.6; margin-bottom:24px;">
        You are currently in <strong>Zero Signup Guest Sandbox</strong>. To save virtual files to PostgreSQL, schedule autonomous watchdogs, or connect external MCP tools, create a free account in 10 seconds.
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <a href="/register" class="btn-action" style="text-decoration:none; padding:12px; font-size:14px; text-align:center; font-weight:600;">
          🚀 Create Free Account (Instant)
        </a>
        <a href="/login" class="btn-sub" style="text-decoration:none; padding:10px; font-size:13px; text-align:center;">
          Already have an account? Log In
        </a>
        <button type="button" onclick="closeSignupGateModal()" style="background:transparent; border:none; color:#64748b; font-size:12px; cursor:pointer; margin-top:6px;">
          Continue testing in guest sandbox &rarr;
        </button>
      </div>
    </div>
  </div>

  <!-- GitHub Repository RAG Connect Modal -->
  <div id="github-rag-modal" class="modal-overlay" onclick="if(event.target === this) closeGitHubModal()" style="display:none; z-index:1260;">
    <div class="modal-dialog" style="max-width:520px; background:#0b1120; border:1px solid rgba(74,222,128,0.25); border-radius:14px; box-shadow:0 25px 50px rgba(0,0,0,0.85); padding:20px 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-size:16px; color:#f8fafc; font-weight:700; display:flex; align-items:center; gap:8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
          Connect GitHub Repo for Deep RAG
        </h3>
        <button type="button" onclick="closeGitHubModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;" title="Close">&times;</button>
      </div>
      <p style="font-size:12.5px; color:#94a3b8; margin:0 0 16px 0; line-height:1.5;">
        Indexes documentation and code into your <strong>Neon PostgreSQL pgvector store</strong> with 768-dim embeddings. The agent will semantically query and quote files with exact citations.
      </p>
      <div style="margin-bottom:12px;">
        <label for="github-repo-input" style="display:block; font-size:11.5px; color:#cbd5e1; font-weight:600; margin-bottom:5px;">Repository URL or Owner/Repo</label>
        <input type="text" id="github-repo-input" placeholder="e.g. ShunyaPulse/ShunopsAI or https://github.com/facebook/react" style="width:100%; box-sizing:border-box; background:#070d19; border:1px solid #1e293b; border-radius:6px; color:#fff; padding:8px 12px; font-size:13px; outline:none;">
      </div>
      <div style="margin-bottom:14px;">
        <label for="github-branch-input" style="display:block; font-size:11.5px; color:#cbd5e1; font-weight:600; margin-bottom:5px;">Branch (Optional, defaults to main/master)</label>
        <input type="text" id="github-branch-input" placeholder="main" style="width:100%; box-sizing:border-box; background:#070d19; border:1px solid #1e293b; border-radius:6px; color:#fff; padding:8px 12px; font-size:13px; outline:none;">
      </div>
      <div id="github-modal-status" style="display:none; font-size:12px; margin-bottom:14px; padding:8px 12px; border-radius:6px;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" onclick="closeGitHubModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; border-radius:6px; padding:7px 14px; font-size:12.5px; cursor:pointer;">Cancel</button>
        <button type="button" id="github-submit-btn" onclick="submitGitHubConnect()" style="background:#22c55e; border:none; color:#0f172a; font-weight:700; border-radius:6px; padding:7px 18px; font-size:12.5px; cursor:pointer;">Index Repository into pgvector</button>
      </div>
    </div>
  </div>

  <div id="guest-turnstile-widget" class="cf-turnstile" data-sitekey="${turnstileSiteKey}" data-callback="onGuestTurnstileSuccess" data-theme="dark" style="display:none;"></div>

  <div class="footer">
    <div>&copy; 2026 ShunopsAI. Designed for multi-tenant privacy and sovereign autonomy.</div>
    <div style="display:flex; gap:16px;">
      <a href="/portal">Settings</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/about">About &amp; Technical Details</a>
    </div>
  </div>

  <script>
${workspaceScripts(safeUsername, JSON.stringify(POPULAR_100_MCP_PRESETS), isGuest)}
  </script>
</body>
</html>`;
}
