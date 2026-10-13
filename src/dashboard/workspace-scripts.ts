/**
 * Client-side JavaScript for the multi-tenant user workspace page (`workspace.ts`).
 *
 * Parameterized by the already-escaped `safeUsername`, which is interpolated
 * into the empty-state greeting. Kept as a plain string so the page stays a
 * zero-build, single-response HTML document.
 */
export function workspaceScripts(safeUsername: string, presetsJson = '[]'): string {
  return `    let conversationHistory = [];
    let attachedImageDataUri = null;
    const MCP_PRESETS = ${presetsJson};

    function handleImageAttach(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert('Image must be under 5MB to ensure fast processing.');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = function(e) {
        attachedImageDataUri = e.target.result;
        const container = document.getElementById('attached-image-container');
        const thumb = document.getElementById('attached-image-thumb');
        const nameEl = document.getElementById('attached-image-name');
        const sizeEl = document.getElementById('attached-image-size');
        if (container && thumb && nameEl && sizeEl) {
          thumb.src = attachedImageDataUri;
          nameEl.textContent = file.name;
          sizeEl.textContent = (file.size / 1024).toFixed(1) + ' KB';
          container.style.display = 'inline-flex';
        }
      };
      reader.readAsDataURL(file);
    }

    function clearAttachedImage() {
      attachedImageDataUri = null;
      const input = document.getElementById('chat-image-input');
      if (input) input.value = '';
      const container = document.getElementById('attached-image-container');
      if (container) container.style.display = 'none';
      const thumb = document.getElementById('attached-image-thumb');
      if (thumb) thumb.src = '';
    }

    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    function toggleContextDrawer() {
      const drawer = document.getElementById('custom-context-drawer');
      const arrow = document.getElementById('context-toggle-arrow');
      if (drawer.style.display === 'none') {
        drawer.style.display = 'block';
        arrow.textContent = '▾';
      } else {
        drawer.style.display = 'none';
        arrow.textContent = '▸';
      }
    }

    function togglePasswordChangeDrawer() {
      const d = document.getElementById('password-change-drawer');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    }

    function updateContextBadge() {
      const badge = document.getElementById('context-badge');
      const count = conversationHistory.length;
      badge.textContent = '🧠 Persistent Memory (' + count + ' messages)';
    }

    function onModelPreferenceChange() {
      const select = document.getElementById('chat-model-select');
      const badge = document.getElementById('model-status-badge');
      const quotaBadge = document.getElementById('quota-warning-badge');
      if (!select) return;
      const val = select.value;

      // Identify heavy models for quota advisory
      const isHeavy = val === 'groq-120b' ||
        val === 'openrouter-heavy' ||
        val === 'github:o1-mini' ||
        val === 'github:gpt-4o' ||
        val === 'groq:openai/gpt-oss-120b' ||
        val.includes('550b') ||
        val.includes('120b');

      if (quotaBadge) {
        if (isHeavy) {
          quotaBadge.style.background = 'rgba(239,68,68,0.15)';
          quotaBadge.style.color = '#f87171';
          quotaBadge.style.border = '1px solid rgba(239,68,68,0.3)';
          quotaBadge.textContent = '⚠️ Heavy Quota Usage (Uses Limits Fast)';
        } else if (val === 'code-dev' || val === 'research-context' || val.includes('70b')) {
          quotaBadge.style.background = 'rgba(245,158,11,0.15)';
          quotaBadge.style.color = '#f59e0b';
          quotaBadge.style.border = '1px solid rgba(245,158,11,0.3)';
          quotaBadge.textContent = '🟠 Balanced Quota Usage';
        } else {
          quotaBadge.style.background = 'rgba(16,185,129,0.12)';
          quotaBadge.style.color = '#10b981';
          quotaBadge.style.border = '1px solid rgba(16,185,129,0.25)';
          quotaBadge.textContent = '🟢 Low Quota Usage (Economical)';
        }
      }

      if (badge) {
        if (val === 'auto') {
          badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#38bdf8; display:inline-block;"></span><span style="color:#38bdf8;">Smart Auto-Router Active</span>';
        } else if (['gemini-flash', 'groq-120b', 'code-dev', 'research-context', 'openrouter-heavy'].includes(val)) {
          badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block;"></span><span style="color:#10b981;">Smart Category Active</span>';
        } else {
          badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#a855f7; display:inline-block;"></span><span style="color:#a855f7;">Individual Model Locked</span>';
        }
      }
    }

    async function fetchModelStatus() {
      try {
        const res = await fetch('/api/models/status');
        const data = await res.json();
        if (!data.success || !Array.isArray(data.tiers)) return;

        const select = document.getElementById('chat-model-select');
        const badge = document.getElementById('model-status-badge');
        if (!select) return;

        let degradedCount = 0;

        if (Array.isArray(data.tiers)) {
          data.tiers.forEach(tier => {
            const opt = select.querySelector('option[value="' + tier.tierId + '"]');
            if (!opt) return;

            if (tier.degraded) {
              degradedCount++;
              opt.disabled = true;
              const remaining = tier.cooldownRemainingSeconds ? (' (' + tier.cooldownRemainingSeconds + 's cooldown)') : '';
              opt.textContent = '⚠️ [Degraded] ' + tier.name + remaining;
              if (select.value === tier.tierId) {
                select.value = 'auto';
              }
            } else {
              opt.disabled = false;
              if (tier.tierId === 'auto') opt.textContent = '⚡ Auto: Smart Adaptive (Auto-Routes & Self-Heals)';
              if (tier.tierId === 'gemini-flash') opt.textContent = '🚀 Fast & Responsive (Quick Q&A • Low Quota 🟢)';
              if (tier.tierId === 'groq-120b') opt.textContent = '🧠 Deep Reasoning & Math (120B AST • Heavy Quota ⚠️)';
              if (tier.tierId === 'code-dev') opt.textContent = '💻 Code Architect & Debugging (GPT-4o & AST • Balanced)';
              if (tier.tierId === 'research-context') opt.textContent = '📚 Long Context & Research (1M Window • Balanced)';
              if (tier.tierId === 'openrouter-heavy') opt.textContent = '👑 Frontier Flagship (550B & GPT-4o • Heavy Quota ⚠️)';
            }
          });
        }

        if (Array.isArray(data.models)) {
          data.models.forEach(m => {
            const opt = select.querySelector('option[value="' + m.id + '"]');
            if (!opt) return;

            if (m.degraded) {
              degradedCount++;
              opt.disabled = true;
              const remaining = m.cooldownRemainingSeconds ? (' (' + m.cooldownRemainingSeconds + 's cooldown)') : '';
              opt.textContent = '⚠️ [Degraded] ' + m.name + remaining;
              if (select.value === m.id) {
                select.value = 'auto';
              }
            } else {
              opt.disabled = false;
              opt.textContent = m.name;
            }
          });
        }

        if (badge && select.value !== 'auto') {
          return;
        }

        if (badge) {
          if (degradedCount > 0) {
            badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#f59e0b; display:inline-block;"></span><span style="color:#f59e0b;">' + degradedCount + ' Model(s) in Cooldown (Zero Ping)</span>';
          } else {
            badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block;"></span><span style="color:#10b981;">All Models Healthy</span>';
          }
        }
      } catch (e) {
        // Silent fail
      }
    }

    // 1. Persistent Chat History: Load from DB on startup
    async function loadSavedChatHistory() {
      const thread = document.getElementById('chat-thread');
      try {
        const res = await fetch('/api/workspace/chat-history');
        const data = await res.json();
        const emptyState = document.getElementById('empty-state');

        if (data.success && data.messages && data.messages.length > 0) {
          if (emptyState) emptyState.remove();
          thread.innerHTML = '';
          conversationHistory = [];
          data.messages.forEach(m => {
            appendMessageBubble(m.role, m.message, false);
            conversationHistory.push({ role: m.role, content: m.message });
          });
          updateContextBadge();
        } else {
          if (emptyState) {
            emptyState.innerHTML = '👋 Hello <strong>${safeUsername}</strong>! Ask a question or pick a prompt below to begin.';
          }
        }
      } catch (e) {
        const emptyState = document.getElementById('empty-state');
        if (emptyState) emptyState.innerHTML = '👋 Welcome! Start a new conversation below.';
      }
    }

    // 2. Clear Chat History in DB & in Memory
    async function clearConversation() {
      if (!confirm('Are you sure you want to clear your conversation history?')) return;
      try {
        await fetch('/api/workspace/chat-history', { method: 'DELETE' });
        conversationHistory = [];
        const thread = document.getElementById('chat-thread');
        thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">👋 Fresh conversation started! Ask a question below.</div>';
        updateContextBadge();
      } catch (e) {
        alert('Could not clear history: ' + e.message);
      }
    }

    function askSuggestion(text) {
      document.getElementById('user-chat-input').value = text;
      sendUserChat();
    }

    function escapeHtmlText(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function appendMessageBubble(role, content, autoScroll = true, meta = null, imageUri = null) {
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.remove();

      const thread = document.getElementById('chat-thread');
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble ' + (role === 'user' ? 'msg-user' : 'msg-assistant');

      const header = document.createElement('div');
      header.className = 'msg-header';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';

      const titleSpan = document.createElement('span');
      titleSpan.textContent = role === 'user' ? '👤 You' : '⚡ Assistant';
      header.appendChild(titleSpan);

      if (role === 'assistant' && meta && meta.usedModel) {
        const badge = document.createElement('span');
        badge.style.fontSize = '10.5px';
        badge.style.padding = '2px 7px';
        badge.style.borderRadius = '6px';
        badge.style.fontWeight = '600';
        if (meta.switched) {
          badge.style.background = 'rgba(245,158,11,0.16)';
          badge.style.color = '#f59e0b';
          badge.style.border = '1px solid rgba(245,158,11,0.35)';
          badge.textContent = '🔄 Auto-switched: ' + meta.usedModel;
          badge.title = 'Primary model experienced high traffic or rate-limits; ShunopsAI auto-switched to this healthy fallback.';
        } else {
          badge.style.background = 'rgba(56,189,248,0.12)';
          badge.style.color = '#38bdf8';
          badge.style.border = '1px solid rgba(56,189,248,0.25)';
          badge.textContent = '🎯 ' + meta.usedModel;
        }
        header.appendChild(badge);
      }
      bubble.appendChild(header);

      if (imageUri) {
        const img = document.createElement('img');
        img.src = imageUri;
        img.style.maxWidth = '220px';
        img.style.maxHeight = '180px';
        img.style.borderRadius = '8px';
        img.style.marginTop = '6px';
        img.style.marginBottom = '6px';
        img.style.display = 'block';
        img.style.border = '1px solid rgba(255,255,255,0.15)';
        bubble.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = content;

      bubble.appendChild(body);
      thread.appendChild(bubble);
      if (autoScroll) thread.scrollTop = thread.scrollHeight;
    }

    let thinkingTimerA = null;
    let thinkingTimerB = null;

    function showThinkingIndicator() {
      const thread = document.getElementById('chat-thread');
      const thinking = document.createElement('div');
      thinking.id = 'thinking-indicator';
      thinking.className = 'thinking-bubble';
      thinking.innerHTML = '<span id="thinking-label">Thinking</span><span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      thread.appendChild(thinking);
      thread.scrollTop = thread.scrollHeight;

      if (thinkingTimerA) clearTimeout(thinkingTimerA);
      if (thinkingTimerB) clearTimeout(thinkingTimerB);

      thinkingTimerA = setTimeout(() => {
        const lbl = document.getElementById('thinking-label');
        if (lbl) lbl.textContent = 'Processing reasoning';
      }, 4000);

      thinkingTimerB = setTimeout(() => {
        const lbl = document.getElementById('thinking-label');
        if (lbl) lbl.textContent = 'Routing fast fallback';
      }, 9000);
    }

    function removeThinkingIndicator() {
      if (thinkingTimerA) { clearTimeout(thinkingTimerA); thinkingTimerA = null; }
      if (thinkingTimerB) { clearTimeout(thinkingTimerB); thinkingTimerB = null; }
      const thinking = document.getElementById('thinking-indicator');
      if (thinking) thinking.remove();
    }

    const DB_NAME = "shunops_secure_vault_v3";
    const STORE_NAME = "keys_store";

    async function loadVaultKeys() {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const record = await new Promise((resolve, reject) => {
          const req = store.get("encrypted_payload");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const cryptoKey = await new Promise((resolve, reject) => {
          const kTx = db.transaction(STORE_NAME, "readonly");
          const kStore = kTx.objectStore(STORE_NAME);
          const req = kStore.get("non_extractable_master_key");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!record || !record.iv || !record.ciphertext || !cryptoKey) return null;
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, cryptoKey, record.ciphertext);
        return JSON.parse(new TextDecoder().decode(decrypted));
      } catch (e) {
        return null;
      }
    }

    // Cryptographic Proof-of-Work Solver (Client Anti-Bot Shield)
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

    let currentChatAbortController = null;

    function stopChatGeneration() {
      if (currentChatAbortController) {
        currentChatAbortController.abort();
        currentChatAbortController = null;
      }
    }

    async function sendUserChat(isKeyEvent) {
      const sendBtn = document.getElementById('send-btn');

      // If generation is actively in flight, clicking the button STOPS it immediately!
      if (currentChatAbortController) {
        if (isKeyEvent) return; // Prevent Enter key in input from triggering stop accidentally
        stopChatGeneration();
        removeThinkingIndicator();
        appendMessageBubble('assistant', 'Generation stopped.');
        if (sendBtn) {
          sendBtn.classList.remove('generating');
          sendBtn.disabled = false;
          sendBtn.title = '';
          sendBtn.innerHTML = 'Send';
        }
        return;
      }

      const input = document.getElementById('user-chat-input');
      let msg = (input ? input.value : '').trim();
      const currentAttachedImage = attachedImageDataUri;
      if (!msg && !currentAttachedImage) return;
      if (!msg && currentAttachedImage) {
        msg = 'Analyze this image and explain what you see.';
      }

      if (input) input.value = '';
      clearAttachedImage();

      // Transform button to an interactive STOP button
      currentChatAbortController = new AbortController();
      if (sendBtn) {
        sendBtn.classList.add('generating');
        sendBtn.disabled = false;
        sendBtn.title = 'Stop generation';
        sendBtn.innerHTML = '<span class="stop-square"></span>Stop';
      }

      // 1. Render User Message
      appendMessageBubble('user', msg, true, null, currentAttachedImage);
      showThinkingIndicator();

      // 2. Build multi-turn context
      const customContext = document.getElementById('custom-context-input')?.value.trim();
      const historyItems = [];
      if (customContext) {
        historyItems.push('Custom Workspace Notes/Instructions:\\n' + customContext);
      }
      if (conversationHistory.length > 0) {
        if (conversationHistory.length <= 6) {
          const turnsText = conversationHistory.map(t => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.content).join('\\n');
          historyItems.push('Previous Conversation History:\\n' + turnsText);
        } else {
          // Hierarchical Rolling Memory: condense older background turns into bulleted key points
          const older = conversationHistory.slice(0, -6);
          const recent = conversationHistory.slice(-6);
          const olderDistilled = older.map(t => '• ' + (t.role === 'user' ? 'User' : 'Assistant') + ': ' + (t.content.length > 140 ? t.content.slice(0, 137) + '...' : t.content)).join('\\n');
          const recentText = recent.map(t => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.content).join('\\n');
          historyItems.push('=== Prior Session Context & Key Decisions (Rolling Memory) ===\\n' + olderDistilled + '\\n\\n=== Recent Active Conversation Turns ===\\n' + recentText);
        }
      }
      const historyPayload = historyItems.length > 0 ? historyItems.join('\\n\\n') : undefined;

      try {
        const headers = { 'Content-Type': 'application/json' };
        const vault = await loadVaultKeys();
        if (vault) {
          if (vault.groq) headers['x-groq-key'] = vault.groq;
          if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
        }

        // Solve Proof-of-Work challenge in background (WebCrypto solves in ~20-30ms)
        let shieldSolution = null;
        try {
          const chRes = await fetch('/api/shield/challenge', { signal: currentChatAbortController.signal });
          if (chRes.ok) {
            const chData = await chRes.json();
            shieldSolution = await solveProofOfWork(chData);
          }
        } catch (e) {}

        const modelPreference = document.getElementById('chat-model-select')?.value || 'auto';

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          signal: currentChatAbortController.signal,
          body: JSON.stringify({
            message: msg,
            history: historyPayload,
            image: currentAttachedImage || undefined,
            modelPreference,
            shield: shieldSolution || undefined,
          })
        });

        const data = await res.json();
        removeThinkingIndicator();

        const reply = data.reply || 'No response received. Please try again.';
        const usedModel = data.usedModel || '';
        const pref = modelPreference;
        let isSwitched = false;
        if (usedModel && pref !== 'auto') {
          // If preference was an individual model e.g. "github:gpt-4o"
          if (pref.includes(':') && !usedModel.toLowerCase().includes(pref.split(':')[1].toLowerCase())) {
            isSwitched = true;
          }
          // If preference was a smart category that didn't land on its primary
          if (pref === 'gemini-flash' && !usedModel.toLowerCase().includes('gemini')) isSwitched = true;
          if (pref === 'groq-120b' && !usedModel.toLowerCase().includes('120b')) isSwitched = true;
          if (pref === 'code-dev' && !usedModel.toLowerCase().includes('gpt-4o') && !usedModel.toLowerCase().includes('code')) isSwitched = true;
          if (pref === 'research-context' && !usedModel.toLowerCase().includes('lightning') && !usedModel.toLowerCase().includes('gemini')) isSwitched = true;
          if (pref === 'openrouter-heavy' && !usedModel.toLowerCase().includes('550b') && !usedModel.toLowerCase().includes('gpt-4o')) isSwitched = true;
        }

        appendMessageBubble('assistant', reply, true, {
          usedModel: usedModel ? usedModel.replace(/^openrouter:/i, '').replace(/^github:/i, '').replace(/^gemini:/i, '').replace(/^groq:/i, '').replace(/^cloudflare:/i, '') : '',
          switched: isSwitched,
        });

        conversationHistory.push({ role: 'user', content: msg });
        conversationHistory.push({ role: 'assistant', content: reply });
        updateContextBadge();
        fetchBillingUsage();

        if (data.routedComplexity && modelPreference === 'auto') {
          const badge = document.getElementById('model-status-badge');
          if (badge) {
            const compLabel = data.routedComplexity === 'complex' ? '🧠 Deep Reasoning' : '🚀 Fast Flash';
            const switchNotice = usedModel ? (' (' + usedModel.split(':')[0].toUpperCase() + ')') : '';
            badge.innerHTML = '<span style="width:6px; height:6px; border-radius:50%; background:#38bdf8; display:inline-block;"></span><span style="color:#38bdf8;">Auto-routed: ' + compLabel + switchNotice + '</span>';
          }
        }
        fetchModelStatus();

      } catch (err) {
        removeThinkingIndicator();
        if (err && (err.name === 'AbortError' || String(err).includes('aborted'))) {
          // Intentionally stopped by user, already handled
          return;
        }
        appendMessageBubble('assistant', 'Sorry, could not connect right now. Please check your connection and try again.');
      } finally {
        currentChatAbortController = null;
        if (sendBtn) {
          sendBtn.classList.remove('generating');
          sendBtn.disabled = false;
          sendBtn.title = '';
          sendBtn.innerHTML = 'Send';
        }
      }
    }

    // 3. Human Approvals Queue Polling & Execution
    async function fetchWorkspaceApprovals() {
      const box = document.getElementById('workspace-approvals-box');
      const list = document.getElementById('workspace-approvals-list');
      try {
        const res = await fetch('/api/pending-approvals');
        if (!res.ok) return;
        const data = await res.json();
        const pending = data.pending || [];

        if (pending.length === 0) {
          box.style.display = 'none';
          return;
        }

        box.style.display = 'block';
        list.innerHTML = pending.map(req => \`
          <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px; margin-top: 10px;">
            <div style="display:flex; justify-content:space-between;">
              <strong style="color:#f87171;">\${escapeHtmlText(req.action)}</strong>
              <span style="font-size:11px; color:#94a3b8; font-family:monospace;">\${escapeHtmlText(req.id)}</span>
            </div>
            <div style="font-size:12px; color:#cbd5e1; margin:4px 0;">\${escapeHtmlText(req.riskReason)}</div>
            <pre style="background:#000; padding:6px; border-radius:4px; font-size:11px; overflow-x:auto; margin:6px 0; color:#e2e8f0;">\${escapeHtmlText(req.commandOrPayload)}</pre>
            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
              <button class="btn-sub" style="border-color:#ef4444; color:#ef4444;" onclick="submitApproval('\${escapeHtmlText(req.id)}', false)">❌ Reject</button>
              <button class="btn-sub" style="background:#10b981; color:#fff; border:none;" onclick="submitApproval('\${escapeHtmlText(req.id)}', true)">✅ Approve</button>
            </div>
          </div>
        \`).join('');
      } catch (e) {}
    }

    async function submitApproval(id, approved) {
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, approved })
        });
        const data = await res.json();
        alert(data.message || (approved ? 'Approved' : 'Rejected'));
        fetchWorkspaceApprovals();
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    // 4. Billing Usage & Meter
    function formatTokens(num) {
      if (!num || isNaN(num)) return '0';
      if (num >= 999999999) return 'Unlimited';
      if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(num);
    }

    async function fetchBillingUsage() {
      try {
        const res = await fetch('/api/billing/usage');
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          document.getElementById('user-plan-badge').textContent = (data.plan || 'community').toUpperCase();
          const totalTok = data.totalTokens !== undefined ? data.totalTokens : (data.queryCount || 0);
          const limitTok = data.tokenLimit || data.limit || 500000;
          document.getElementById('user-usage-count').textContent = formatTokens(totalTok);
          document.getElementById('user-usage-limit').textContent = formatTokens(limitTok);

          const inEl = document.getElementById('user-in-tokens');
          if (inEl) inEl.textContent = formatTokens(data.inputTokens || 0);

          const outEl = document.getElementById('user-out-tokens');
          if (outEl) outEl.textContent = formatTokens(data.outputTokens || 0);

          const callsEl = document.getElementById('user-query-calls');
          if (callsEl) callsEl.textContent = data.queryCount || 0;

          const pct = limitTok >= 999999999 
            ? 0 
            : Math.min(100, Math.round((totalTok / limitTok) * 100));
          document.getElementById('user-usage-bar').style.width = pct + '%';
        }
      } catch (e) {}
    }

    // 5. Personal API Keys
    async function loadApiKeys() {
      const container = document.getElementById('user-keys-list');
      try {
        const res = await fetch('/api/user/api-keys');
        const data = await res.json();
        if (data.success && data.keys) {
          if (data.keys.length === 0) {
            container.innerHTML = '<div style="color:#64748b;">No active API keys yet.</div>';
            return;
          }
          container.innerHTML = data.keys.map(k => \`
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
              <div>
                <span style="color:#fff; font-weight:600;">\${escapeHtmlText(k.name)}</span>
                <span style="color:#64748b; margin-left:6px;">(\${escapeHtmlText(k.keyPrefix)}...)</span>
              </div>
              <button class="btn-sub" style="padding:2px 8px; font-size:10px; border-color:#ef4444; color:#ef4444;" onclick="revokeApiKey(\${k.id})">Revoke</button>
            </div>
          \`).join('');
        }
      } catch (e) {
        container.innerHTML = '<div style="color:#ef4444;">Failed to load keys.</div>';
      }
    }

    async function generateApiKey() {
      const input = document.getElementById('api-key-name-input');
      const name = input.value.trim() || 'API Key';
      try {
        const res = await fetch('/api/user/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
          input.value = '';
          document.getElementById('new-key-value').textContent = data.key;
          document.getElementById('new-key-display').style.display = 'block';
          loadApiKeys();
        } else {
          alert('Error: ' + (data.error || 'Failed to generate key'));
        }
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    async function revokeApiKey(id) {
      if (!confirm('Revoke this API key?')) return;
      try {
        const res = await fetch('/api/user/api-keys/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) loadApiKeys();
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    // 6. Account Lifecycle: Change Password, Export Data, Delete Account
    async function submitPasswordChange() {
      const currentPassword = document.getElementById('pw-current').value;
      const newPassword = document.getElementById('pw-new').value;
      if (!newPassword || newPassword.length < 8) {
        alert('New password must be at least 8 characters long.');
        return;
      }
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          alert('Password updated successfully!');
          document.getElementById('pw-current').value = '';
          document.getElementById('pw-new').value = '';
          togglePasswordChangeDrawer();
        } else {
          alert('Error: ' + (data.error || 'Failed to update password'));
        }
      } catch (e) {
        alert('Failed: ' + e.message);
      }
    }

    function exportMyData() {
      window.location.href = '/api/auth/account/export';
    }

    async function deleteMyAccount() {
      const conf = confirm('⚠️ ARE YOU ABSOLUTELY SURE?\\n\\nThis will permanently delete your account, workspace, conversation history, and API keys. This action CANNOT be undone.');
      if (!conf) return;
      const conf2 = prompt('Type DELETE to confirm permanent account removal:');
      if (conf2 !== 'DELETE') {
        alert('Account deletion aborted.');
        return;
      }
      try {
        const res = await fetch('/api/auth/account', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          alert('Your account has been deleted permanently.');
          window.location.href = '/register';
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    
    function toggleAccountModal(show) {
      const modal = document.getElementById('account-settings-modal');
      if (!modal) return;
      const shouldOpen = show !== undefined ? show : !modal.classList.contains('active');
      if (shouldOpen) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        loadApiKeys();
      } else {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleAccountModal(false);
      }
    });

    function copyToClipboardStandard(btn, textToCopy, copiedLabel) {
      if (!textToCopy) return;
      navigator.clipboard.writeText(textToCopy).then(() => {
        const label = btn.querySelector('.btn-label');
        const origHtml = btn.innerHTML;
        btn.classList.add('copied');
        if (label) {
          label.textContent = copiedLabel || 'Copied!';
          const svg = btn.querySelector('svg');
          if (svg) {
            svg.outerHTML = '<svg class="copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          }
        } else {
          btn.textContent = '✓ Copied!';
        }
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = origHtml;
        }, 2000);
      }).catch(() => {
        prompt('Copy:', textToCopy);
      });
    }

    function copyNewApiKey(btn) {
      const el = document.getElementById('new-key-value');
      const key = el ? el.textContent : '';
      copyToClipboardStandard(btn, key, 'Copied!');
    }

    function copyWorkspaceWidgetSnippet(btn) {
      const code = '<' + 'script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" data-api-url="https://edge-agent-widget.shunopsai.workers.dev" defer><' + '/script>';
      copyToClipboardStandard(btn, code, 'Copied!');
    }

    // 8. Platform Connections (the user's OWN provider credentials)
    let platformSpecs = [];
    let platformConnected = [];
    let platformVaultReady = true;
    let platformBusy = false;
    let activeMcpPreset = null;

    // Attribute-safe escaping: escapeHtmlText runs through innerHTML, which
    // leaves quotes intact and would let a value break out of an attribute.
    function escapeHtmlAttr(str) {
      return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function platformIsConnected(platformId) {
      return platformConnected.some(function (item) { return item.platform === platformId; });
    }

    function connectedPlatformFor(platformId) {
      return platformConnected.filter(function (item) { return item.platform === platformId; })[0];
    }

    function applyPlatformButtonState() {
      const btn = document.getElementById('platform-connect-button');
      if (!btn) return;
      const disabled = platformBusy || !platformVaultReady;
      btn.disabled = disabled;
      btn.style.opacity = disabled ? '0.55' : '1';
      btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }

    function setPlatformBusy(busy) {
      platformBusy = busy;
      applyPlatformButtonState();
    }

    function renderVaultWarning() {
      const box = document.getElementById('platform-vault-warning');
      if (box) box.style.display = platformVaultReady ? 'none' : 'block';
      applyPlatformButtonState();
    }

    function setPlatformStatus(message, ok) {
      const el = document.getElementById('platform-connect-status');
      if (!el) return;
      el.textContent = message;
      el.style.color = ok ? '#10b981' : '#f87171';
    }

    async function loadPlatformCredentials() {
      const listBox = document.getElementById('platform-connected-list');
      try {
        const res = await fetch('/api/user/platform-credentials');
        if (!res.ok) {
          if (listBox) listBox.textContent = 'Could not load connected platforms.';
          return;
        }
        const data = await res.json();
        platformSpecs = data.available || [];
        platformConnected = data.connected || [];
        platformVaultReady = data.vaultReady !== false;
        renderVaultWarning();
        renderConnectedPlatforms(platformConnected);
        renderPlatformSelect();
      } catch (e) {
        if (listBox) listBox.textContent = 'Could not load connected platforms.';
      }
    }

    function renderConnectedPlatforms(connected) {
      const box = document.getElementById('platform-connected-list');
      if (!box) return;
      if (!connected.length) {
        box.innerHTML = '<div style="font-size:12px; color:#94a3b8; line-height:1.5;">No platform accounts connected yet. Tasks you run can only use what you connect here.</div>';
        return;
      }
      box.innerHTML = connected.map(function (item) {
        const isMcp = item.platform === 'mcp' || item.platform.startsWith('mcp:');
        const spec = platformSpecs.filter(function (s) {
          return s.id === item.platform || (isMcp && s.id === 'mcp');
        })[0];
        // A stored row is only usable when every required field of its spec round-trips.
        const stored = item.fields || [];
        const incomplete = Boolean(spec) && spec.fields.some(function (field) {
          return !field.optional && stored.indexOf(field.key) === -1;
        });
        let banner = '';
        if (item.readable === false) {
          banner = '<div style="font-size:11px; color:#f87171; margin-top:2px;">⚠ Unreadable on this server — reconnect the account.</div>';
        } else if (incomplete) {
          banner = '<div style="font-size:11px; color:#f59e0b; margin-top:2px;">⚠︎ Incomplete — reconnect to store every required field.</div>';
        }

        const connectedBadge = '<span style="font-size:10px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 7px; border-radius:10px; font-weight:600; margin-left:6px;">🟢 Connected</span>';
        const pingBtn = isMcp
          ? '<button class="btn-sub" data-test-ping="' + escapeHtmlAttr(item.platform) + '" style="border-color:rgba(56,189,248,0.3); color:#38bdf8; font-size:11px; padding:3px 8px;">⚡ Test Ping</button>'
          : '';

        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; margin-bottom:6px;">'
          + '<div><div style="font-size:12.5px; color:#fff; font-weight:600; display:flex; align-items:center;">'
          + escapeHtmlText(item.label || (spec ? spec.label : item.platform))
          + connectedBadge
          + '</div>'
          + '<div style="font-size:11px; color:#94a3b8; font-family:monospace; margin-top:2px;">' + escapeHtmlText(item.hint || '') + ' · updated ' + escapeHtmlText(String(item.updatedAt || '').slice(0, 10)) + '</div>'
          + banner + '</div>'
          + '<div style="display:flex; gap:6px; align-items:center;">'
          + pingBtn
          + '<button class="btn-sub" data-disconnect="' + escapeHtmlAttr(item.platform) + '" style="border-color:rgba(239,68,68,0.4); color:#ef4444; font-size:11px; padding:3px 8px;">Disconnect</button>'
          + '</div>'
          + '</div>';
      }).join('');

      box.querySelectorAll('[data-disconnect]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          disconnectPlatform(btn.getAttribute('data-disconnect'));
        });
      });
      box.querySelectorAll('[data-test-ping]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          testConnectedPlatformPing(btn.getAttribute('data-test-ping'), btn);
        });
      });
    }

    function renderPlatformSelect() {
      const select = document.getElementById('platform-select');
      if (!select) return;
      const previous = select.value;

      const nativeOptions = [];
      const bridgeOptions = [];
      const mcpOptions = [];

      platformSpecs.forEach(function (spec) {
        const suffix = platformIsConnected(spec.id) ? ' ✓ connected' : '';
        const optHtml = '<option value="' + escapeHtmlAttr(spec.id) + '">' + escapeHtmlText(spec.label + suffix) + '</option>';
        if (spec.tier === 'native') nativeOptions.push(optHtml);
        else if (spec.tier === 'local_bridge') bridgeOptions.push(optHtml);
        else mcpOptions.push(optHtml);
      });

      // Also include any connected custom MCP preset platforms
      platformConnected.forEach(function (conn) {
        if (conn.platform.startsWith('mcp:') && !platformSpecs.some(function (s) { return s.id === conn.platform; })) {
          mcpOptions.push('<option value="' + escapeHtmlAttr(conn.platform) + '">' + escapeHtmlText((conn.label || conn.platform) + ' ✓ connected') + '</option>');
        }
      });

      let html = '';
      if (nativeOptions.length) {
        html += '<optgroup label="⚡ Direct Native Drivers (Zero-Daemon)">' + nativeOptions.join('') + '</optgroup>';
      }
      if (bridgeOptions.length) {
        html += '<optgroup label="💻 Self-Hosted / Local Bridge (Localhost)">' + bridgeOptions.join('') + '</optgroup>';
      }
      if (mcpOptions.length) {
        html += '<optgroup label="🌐 Remote Model Context Protocol (MCP)">' + mcpOptions.join('') + '</optgroup>';
      }

      select.innerHTML = html;
      if (previous && (platformSpecs.some(function (s) { return s.id === previous; }) || platformConnected.some(function (c) { return c.platform === previous; }))) {
        select.value = previous;
      }
      onPlatformSelectChange();
    }

    function onPlatformSelectChange() {
      const select = document.getElementById('platform-select');
      const box = document.getElementById('platform-field-inputs');
      const note = document.getElementById('platform-connect-note');
      const testBtn = document.getElementById('platform-test-button');
      const testStatus = document.getElementById('mcp-test-status');
      if (!select || !box) return;

      const isMcp = select.value === 'mcp' || select.value.startsWith('mcp:');
      if (testBtn) testBtn.style.display = isMcp ? 'inline-block' : 'none';
      if (testStatus) {
        testStatus.style.display = 'none';
        testStatus.textContent = '';
      }

      const spec = platformSpecs.filter(function (s) {
        return s.id === select.value || (isMcp && s.id === 'mcp');
      })[0];
      setPlatformStatus('', true);
      if (!spec) {
        box.innerHTML = '';
        if (note) note.textContent = '';
        return;
      }
      const existing = connectedPlatformFor(select.value);
      box.innerHTML = '<div style="font-size:11.5px; color:#94a3b8; line-height:1.45;">' + escapeHtmlText(spec.description) + '</div>'
        + spec.fields.map(function (field) {
          return '<div style="display:flex; flex-direction:column; gap:4px;">'
            + '<label style="font-size:11px; color:#94a3b8;" data-cred-label="' + escapeHtmlAttr(field.key) + '">' + escapeHtmlText(field.label) + '</label>'
            + '<input data-cred-field="' + escapeHtmlAttr(field.key) + '" type="' + (field.secret ? 'password' : 'text') + '" placeholder="' + escapeHtmlAttr(field.placeholder) + '" autocomplete="off" spellcheck="false" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; outline:none;" />'
            + '</div>';
        }).join('');
      const button = document.getElementById('platform-connect-button');
      if (button) button.textContent = existing ? 'Update Connection' : 'Connect Account';
      if (note) {
        note.textContent = existing
          ? 'The stored ' + (existing.label || spec.label) + ' credential is ' + (existing.hint || 'saved') + '. Submitting replaces it.'
          : '';
      }
    }

    async function testMcpConnection() {
      const urlInput = document.querySelector('[data-cred-field="serverUrl"]');
      const tokenInput = document.querySelector('[data-cred-field="apiKey"]');
      const testBtn = document.getElementById('platform-test-button');
      const statusBox = document.getElementById('mcp-test-status');

      const serverUrl = (urlInput ? urlInput.value : '').trim();
      const apiKey = (tokenInput ? tokenInput.value : '').trim();

      if (!serverUrl) {
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.style.background = 'rgba(245,158,11,0.12)';
          statusBox.style.border = '1px solid rgba(245,158,11,0.3)';
          statusBox.style.color = '#fbbf24';
          statusBox.textContent = 'Please enter an MCP Server URL before testing.';
        }
        return;
      }

      if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing... ⏳';
      }
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(56,189,248,0.1)';
        statusBox.style.border = '1px solid rgba(56,189,248,0.25)';
        statusBox.style.color = '#38bdf8';
        statusBox.textContent = 'Pinging MCP server & discovering tools via JSON-RPC...';
      }

      try {
        const res = await fetch('/api/user/platform-credentials/test-mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: serverUrl, apiKey: apiKey }),
        });
        const data = await res.json();
        if (data.success && data.connected) {
          const toolNames = (data.tools || []).map(function (t) { return t.name; }).slice(0, 5).join(', ');
          const extra = (data.toolsCount > 5) ? (' +' + (data.toolsCount - 5) + ' more') : '';
          if (statusBox) {
            statusBox.style.background = 'rgba(16,185,129,0.12)';
            statusBox.style.border = '1px solid rgba(16,185,129,0.3)';
            statusBox.style.color = '#10b981';
            statusBox.innerHTML = '✅ <strong>Connected &amp; Verified!</strong> Found ' + data.toolsCount + ' active tool' + (data.toolsCount === 1 ? '' : 's') + (toolNames ? (' (<code>' + escapeHtmlText(toolNames + extra) + '</code>)') : '') + '.';
          }
        } else {
          if (statusBox) {
            statusBox.style.background = 'rgba(239,68,68,0.12)';
            statusBox.style.border = '1px solid rgba(239,68,68,0.3)';
            statusBox.style.color = '#f87171';
            statusBox.textContent = '❌ Connection failed: ' + (data.error || 'Server unreachable or returned invalid JSON-RPC response.');
          }
        }
      } catch (err) {
        if (statusBox) {
          statusBox.style.background = 'rgba(239,68,68,0.12)';
          statusBox.style.border = '1px solid rgba(239,68,68,0.3)';
          statusBox.style.color = '#f87171';
          statusBox.textContent = '❌ Network error while pinging MCP server.';
        }
      } finally {
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.textContent = 'Test Connection 🔌';
        }
      }
    }

    async function testConnectedPlatformPing(platform, btn) {
      const originalText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Testing... ⏳';
      }
      try {
        const res = await fetch('/api/user/platform-credentials/test-mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: platform }),
        });
        const data = await res.json();
        if (data.success && data.connected) {
          if (btn) {
            btn.style.color = '#10b981';
            btn.style.borderColor = 'rgba(16,185,129,0.4)';
            btn.textContent = '✅ ' + data.toolsCount + ' tools online';
            setTimeout(function () {
              btn.style.color = '#38bdf8';
              btn.style.borderColor = 'rgba(56,189,248,0.3)';
              btn.textContent = originalText;
              btn.disabled = false;
            }, 4000);
          }
        } else {
          if (btn) {
            btn.style.color = '#f87171';
            btn.style.borderColor = 'rgba(239,68,68,0.4)';
            btn.textContent = '❌ Ping failed';
            setTimeout(function () {
              btn.style.color = '#38bdf8';
              btn.style.borderColor = 'rgba(56,189,248,0.3)';
              btn.textContent = originalText;
              btn.disabled = false;
            }, 4000);
          }
        }
      } catch (e) {
        if (btn) {
          btn.textContent = '❌ Network error';
          setTimeout(function () {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 4000);
        }
      }
    }

    async function connectPlatformCredential() {
      const select = document.getElementById('platform-select');
      const box = document.getElementById('platform-field-inputs');
      if (!select || !box) return;
      if (platformBusy) return;
      if (!platformVaultReady) {
        setPlatformStatus('Credential storage is not configured on this server, so accounts cannot be connected.', false);
        return;
      }
      const platformId = select.value;
      const isMcp = platformId === 'mcp' || platformId.startsWith('mcp:');
      const spec = platformSpecs.filter(function (s) {
        return s.id === platformId || (isMcp && s.id === 'mcp');
      })[0];
      if (!spec) {
        setPlatformStatus('Choose a platform to connect.', false);
        return;
      }

      const values = {};
      let missing = '';
      box.querySelectorAll('[data-cred-field]').forEach(function (input) {
        const key = input.getAttribute('data-cred-field');
        values[key] = input.value;
        const value = (input.value || '').trim();
        const field = spec.fields.filter(function (f) { return f.key === key; })[0];
        if (!value && (!field || !field.optional) && !missing) missing = field ? field.label : key;
      });
      if (missing) {
        setPlatformStatus(missing + ' is required.', false);
        return;
      }

      const updating = platformIsConnected(platformId);
      setPlatformBusy(true);
      setPlatformStatus(updating ? 'Updating...' : 'Connecting...', true);

      let customLabel = '';
      if (activeMcpPreset && platformId === ('mcp:' + activeMcpPreset.id)) {
        customLabel = activeMcpPreset.name + ' MCP';
      } else if (isMcp && platformId !== 'mcp') {
        customLabel = platformId.replace(/^mcp:/, '') + ' MCP';
      }

      try {
        const res = await fetch('/api/user/platform-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: platformId, values: values, label: customLabel || undefined }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
          setPlatformStatus(data.error || 'Could not connect that account.', false);
          return;
        }
        box.querySelectorAll('[data-cred-field]').forEach(function (input) { input.value = ''; });
        // Reloading the panel refreshes the connected list and resets the form
        // status, so the confirmation is applied after the refresh.
        await loadPlatformCredentials();
        setPlatformStatus(
          updating ? 'Updated. Your tasks use the new credential.' : 'Connected! This platform is now live for your tasks.',
          true
        );
      } catch (e) {
        setPlatformStatus('Network error while connecting.', false);
      } finally {
        setPlatformBusy(false);
      }
    }

    async function disconnectPlatform(platform) {
      if (platformBusy) return;
      setPlatformBusy(true);
      setPlatformStatus('Disconnecting...', true);
      try {
        const res = await fetch('/api/user/platform-credentials/' + encodeURIComponent(platform), { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(function () { return {}; });
          setPlatformStatus(data.error || 'Could not disconnect that account.', false);
          return;
        }
        await loadPlatformCredentials();
        setPlatformStatus('Disconnected.', true);
      } catch (e) {
        setPlatformStatus('Network error while disconnecting.', false);
      } finally {
        setPlatformBusy(false);
      }
    }

    // 9. Autonomous task dispatch (scoped to this account's own connections)
    async function runAutonomousTask() {
      const input = document.getElementById('task-goal-input');
      const statusBox = document.getElementById('task-run-status');
      const stepsSelect = document.getElementById('task-max-steps');
      if (!input || !statusBox) return;

      const goal = (input.value || '').trim();
      if (!goal) {
        statusBox.style.display = 'block';
        statusBox.style.color = '#f59e0b';
        statusBox.textContent = 'Describe what you want the agent to do first.';
        return;
      }

      statusBox.style.display = 'block';
      statusBox.style.color = '#94a3b8';
      statusBox.textContent = 'Submitting task...';

      try {
        // Async dispatch keeps the page responsive while the agent works and
        // while it waits for your approval in the red bar above.
        const res = await fetch('/api/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: goal,
            maxSteps: Number((stepsSelect && stepsSelect.value) || 6),
            async: true,
          }),
        });
        const data = await res.json();
        if (!data || !data.taskId) {
          statusBox.style.color = '#f87171';
          statusBox.textContent = (data && data.error) || 'The task could not be started.';
          return;
        }
        statusBox.textContent = 'Task accepted (' + data.taskId + '). Running... the agent pauses for your approval before any sensitive step.';
        fetchWorkspaceApprovals();
        pollTaskResult(data.taskId, statusBox, 0);
      } catch (e) {
        statusBox.style.color = '#f87171';
        statusBox.textContent = 'Network error while starting the task.';
      }
    }

    // 9. MCP Directory & 1-Click Presets Explorer
    function toggleMcpDirectoryModal(show) {
      const modal = document.getElementById('mcp-directory-modal');
      if (!modal) return;
      const shouldOpen = show !== undefined ? show : !modal.classList.contains('active');
      if (shouldOpen) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        renderMcpPresets(MCP_PRESETS);
        const searchInput = document.getElementById('mcp-search-input');
        if (searchInput) {
          searchInput.value = '';
          setTimeout(() => searchInput.focus(), 50);
        }
      } else {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    }

    function openMcpDirectoryModal() {
      toggleMcpDirectoryModal(true);
    }

    let currentTierFilter = 'all';

    function setPresetTierFilter(tier) {
      currentTierFilter = tier;
      ['all', 'native', 'local_bridge', 'mcp'].forEach(t => {
        const btnId = 'tier-tab-' + (t === 'local_bridge' ? 'local' : t);
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (t === tier) {
          btn.style.background = 'rgba(255,255,255,0.22)';
          btn.style.borderColor = '#fff';
          btn.style.fontWeight = '700';
        } else {
          btn.style.fontWeight = '500';
          if (t === 'all') {
            btn.style.background = 'rgba(255,255,255,0.08)';
            btn.style.borderColor = 'rgba(255,255,255,0.2)';
          } else if (t === 'native') {
            btn.style.background = 'rgba(16,185,129,0.08)';
            btn.style.borderColor = 'rgba(16,185,129,0.35)';
          } else if (t === 'local_bridge') {
            btn.style.background = 'rgba(245,158,11,0.08)';
            btn.style.borderColor = 'rgba(245,158,11,0.35)';
          } else {
            btn.style.background = 'rgba(56,189,248,0.08)';
            btn.style.borderColor = 'rgba(56,189,248,0.35)';
          }
        }
      });
      filterMcpDirectory();
    }

    function filterMcpDirectory() {
      const query = (document.getElementById('mcp-search-input')?.value || '').toLowerCase().trim();
      const filtered = MCP_PRESETS.filter(p => {
        const pTier = p.tier || 'mcp';
        const tierMatch = currentTierFilter === 'all' || pTier === currentTierFilter;
        if (!tierMatch) return false;
        if (!query) return true;
        return (
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query)
        );
      });
      renderMcpPresets(filtered);
    }

    function renderMcpPresets(presets) {
      const grid = document.getElementById('mcp-presets-grid');
      const countBadge = document.getElementById('mcp-count-badge');
      if (countBadge) {
        countBadge.textContent = presets.length + ' Connectors';
      }
      if (!grid) return;
      if (!presets.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:30px; color:#94a3b8; font-size:12.5px;">No matching connectors found in this category.</div>';
        return;
      }
      grid.innerHTML = presets.map(p => {
        const pTier = p.tier || 'mcp';
        let tierBadge = '<span style="font-size:9px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 6px; border-radius:10px; font-weight:600;">🌐 Remote MCP</span>';
        let actionBtn = '<button class="btn-sub" style="font-size:11px; padding:5px 12px; background:#2563eb; color:#fff; border:none; font-weight:600; border-radius:6px;" data-preset-id="' + escapeHtmlAttr(p.id) + '" onclick="selectMcpPreset(this.dataset.presetId)">Use Preset 🌐</button>';

        if (pTier === 'native') {
          tierBadge = '<span style="font-size:9px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:2px 6px; border-radius:10px; font-weight:700;">⚡ Native Driver</span>';
          actionBtn = '<button class="btn-sub" style="font-size:11px; padding:5px 12px; background:#10b981; color:#fff; border:none; font-weight:600; border-radius:6px;" data-preset-id="' + escapeHtmlAttr(p.id) + '" onclick="selectMcpPreset(this.dataset.presetId)">Connect Native ⚡</button>';
        } else if (pTier === 'local_bridge') {
          tierBadge = '<span style="font-size:9px; background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); padding:2px 6px; border-radius:10px; font-weight:700;">💻 Local Bridge</span>';
          actionBtn = '<button class="btn-sub" style="font-size:11px; padding:5px 12px; background:#d97706; color:#fff; border:none; font-weight:600; border-radius:6px;" data-preset-id="' + escapeHtmlAttr(p.id) + '" onclick="selectMcpPreset(this.dataset.presetId)">Use Bridge 💻</button>';
        }

        return '<div class="mcp-card">'
          + '<div>'
          + '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">'
          + '<strong style="font-size:13px; color:#fff; font-weight:700; line-height:1.3;">' + escapeHtmlText(p.name) + '</strong>'
          + tierBadge
          + '</div>'
          + '<p style="font-size:11.5px; color:#94a3b8; line-height:1.45; margin:6px 0 12px;">' + escapeHtmlText(p.description) + '</p>'
          + '</div>'
          + '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px; margin-top:auto;">'
          + '<span style="font-size:10px; color:#64748b; font-family:monospace; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:120px;">' + escapeHtmlText(p.docs) + '</span>'
          + actionBtn
          + '</div>'
          + '</div>';
      }).join('');
    }

    function selectMcpPreset(presetId) {
      const preset = MCP_PRESETS.find(p => p.id === presetId);
      if (!preset) return;
      toggleMcpDirectoryModal(false);

      const platformSelect = document.getElementById('platform-select');
      if (!platformSelect) return;

      // Tier 1: Direct Native Driver available
      if (preset.tier === 'native' && preset.nativePlatform) {
        platformSelect.value = preset.nativePlatform;
        activeMcpPreset = preset;
        onPlatformSelectChange();

        setTimeout(() => {
          const firstInput = document.querySelector('#platform-field-inputs input');
          if (firstInput) firstInput.focus();
          setPlatformStatus('Selected ⚡ Direct Native Driver for ' + preset.name + '. Enter your connection credentials directly.', true);
        }, 50);
        return;
      }

      // Tier 2: Self-Hosted / Local Bridge
      if (preset.tier === 'local_bridge') {
        const bridgePlatformId = 'mcp:' + preset.id;
        let opt = platformSelect.querySelector('option[value="' + bridgePlatformId + '"]');
        if (!opt) {
          opt = document.createElement('option');
          opt.value = bridgePlatformId;
          opt.textContent = '💻 ' + preset.name + ' (Local Bridge)' + (platformIsConnected(bridgePlatformId) ? ' ✓ connected' : '');
          platformSelect.appendChild(opt);
        }
        platformSelect.value = bridgePlatformId;
        activeMcpPreset = preset;
        onPlatformSelectChange();

        setTimeout(() => {
          const urlInput = document.querySelector('[data-cred-field="serverUrl"]');
          if (urlInput) urlInput.value = preset.url || 'http://127.0.0.1:8000/sse';
          setPlatformStatus('Configured 💻 Local Bridge for ' + preset.name + '. Click "Test Connection 🔌" to verify, then "Connect Account".', true);
        }, 50);
        return;
      }

      // Tier 3: Remote Cloud MCP Server
      const customPlatformId = 'mcp:' + preset.id;
      let opt = platformSelect.querySelector('option[value="' + customPlatformId + '"]');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = customPlatformId;
        opt.textContent = '🌐 ' + preset.name + ' (MCP Server)' + (platformIsConnected(customPlatformId) ? ' ✓ connected' : '');
        platformSelect.appendChild(opt);
      }
      platformSelect.value = customPlatformId;
      activeMcpPreset = preset;
      onPlatformSelectChange();

      setTimeout(() => {
        const urlInput = document.querySelector('[data-cred-field="serverUrl"]');
        const tokenInput = document.querySelector('[data-cred-field="apiKey"]');
        const tokenLabel = document.querySelector('[data-cred-label="apiKey"]');

        if (urlInput && preset.url) urlInput.value = preset.url;
        if (tokenInput && preset.tokenPlaceholder) {
          tokenInput.placeholder = preset.tokenPlaceholder;
          tokenInput.focus();
        }
        if (tokenLabel && preset.tokenLabel) tokenLabel.textContent = preset.tokenLabel;
        setPlatformStatus('Configured ' + preset.name + '. Click "Test Connection 🔌" to verify, then "Connect Account".', true);
      }, 50);
    }

    window.addEventListener('DOMContentLoaded', () => {
      loadSavedChatHistory();
      fetchWorkspaceApprovals();
      fetchBillingUsage();
      loadApiKeys();
      fetchModelStatus();
      loadPlatformCredentials();
      setInterval(fetchWorkspaceApprovals, 4000); // Live approvals polling
    });`;
}
