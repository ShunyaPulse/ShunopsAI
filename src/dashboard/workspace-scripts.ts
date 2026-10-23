/**
 * Client-side JavaScript for the multi-tenant user workspace page (`workspace.ts`).
 *
 * Parameterized by the already-escaped `safeUsername`, which is interpolated
 * into the empty-state greeting. Kept as a plain string so the page stays a
 * zero-build, single-response HTML document.
 */
export function workspaceScripts(safeUsername: string, presetsJson = '[]', isGuest = false): string {
  return `    const isGuest = ${Boolean(isGuest)};
    let guestRunsLeft = parseInt(localStorage.getItem('shunops_guest_runs_left') || '3', 10);
    window.guestTurnstileToken = '';
    window.onGuestTurnstileSuccess = function(token) {
      window.guestTurnstileToken = token;
    };

    function updateGuestRunsDisplay() {
      const el = document.getElementById('guest-runs-display');
      if (el) {
        el.textContent = guestRunsLeft + ' free trial run' + (guestRunsLeft === 1 ? '' : 's') + ' remaining today';
      }
    }

    function openSignupGateModal(featureName, customDesc) {
      const modal = document.getElementById('signup-gate-modal');
      const title = document.getElementById('signup-gate-title');
      const desc = document.getElementById('signup-gate-desc');
      if (title && featureName) title.textContent = '🔒 ' + featureName + ' Requires Free Signup';
      if (desc && customDesc) desc.textContent = customDesc;
      if (modal) modal.style.display = 'flex';
    }

    function closeSignupGateModal() {
      const modal = document.getElementById('signup-gate-modal');
      if (modal) modal.style.display = 'none';
    }

    // Pillar 1: Client-Side Web Worker Sandbox (Aapka Server Chhuyega Bhi Nahi)
    function runCodeInBrowserSandbox(code, timeoutMs) {
      timeoutMs = timeoutMs || 3000;
      return new Promise(function(resolve) {
        var start = performance.now();
        var logs = [];

        var workerFn = function() {
          self.onmessage = function(e) {
            var userCode = e.data.code;
            var logs = [];
            var writtenFiles = {};
            var customConsole = {
              log: function() { logs.push(Array.from(arguments).map(function(a){ return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
              warn: function() { logs.push('[WARN] ' + Array.from(arguments).map(String).join(' ')); },
              error: function() { logs.push('[ERROR] ' + Array.from(arguments).map(String).join(' ')); }
            };
            var sum = function(arr) { return (arr||[]).reduce(function(a,b){return a+b;},0); };
            var mean = function(arr) { return (arr && arr.length) ? sum(arr)/arr.length : 0; };
            var median = function(arr) {
              if (!arr || !arr.length) return 0;
              var s = arr.slice().sort(function(a,b){return a-b;});
              var m = Math.floor(s.length/2);
              return s.length % 2 !== 0 ? s[m] : (s[m-1] + s[m])/2;
            };
            var stdDev = function(arr) {
              if (!arr || arr.length < 2) return 0;
              var m = mean(arr);
              var v = arr.reduce(function(acc, x){ return acc + Math.pow(x - m, 2); }, 0) / arr.length;
              return Math.sqrt(v);
            };
            var csvParse = function(text) {
              var lines = String(text||'').trim().split('\\n');
              if (!lines.length) return [];
              var headers = lines[0].split(',').map(function(h){return h.trim();});
              return lines.slice(1).map(function(line){
                var vals = line.split(',');
                var obj = {};
                headers.forEach(function(h, i){ obj[h] = (vals[i]||'').trim(); });
                return obj;
              });
            };
            var groupBy = function(arr, key) {
              return (arr||[]).reduce(function(acc, item){
                var k = item[key];
                (acc[k] = acc[k] || []).push(item);
                return acc;
              }, {});
            };
            var formatMarkdownTable = function(rows) {
              if (!rows || !rows.length) return '';
              var headers = Object.keys(rows[0]);
              var out = '| ' + headers.join(' | ') + ' |\\n| ' + headers.map(function(){return '---';}).join(' | ') + ' |\\n';
              rows.forEach(function(r){
                out += '| ' + headers.map(function(h){return r[h] !== undefined ? r[h] : '';}).join(' | ') + ' |\\n';
              });
              return out;
            };
            var writeWorkspaceFile = function(name, content) {
              var clean = String(name || '').trim().replace(/^\\/+/, '');
              writtenFiles[clean] = String(content || '');
              return true;
            };
            var appendWorkspaceFile = function(name, content) {
              var clean = String(name || '').trim().replace(/^\\/+/, '');
              writtenFiles[clean] = (writtenFiles[clean] || '') + String(content || '');
              return true;
            };
            var listWorkspaceFiles = function() {
              return Object.keys(writtenFiles);
            };

            try {
              var fn = new Function('console', 'sum', 'mean', 'median', 'stdDev', 'csvParse', 'groupBy', 'formatMarkdownTable', 'writeWorkspaceFile', 'appendWorkspaceFile', 'listWorkspaceFiles', userCode);
              var result = fn(customConsole, sum, mean, median, stdDev, csvParse, groupBy, formatMarkdownTable, writeWorkspaceFile, appendWorkspaceFile, listWorkspaceFiles);
              self.postMessage({ success: true, result: result, logs: logs, writtenFiles: writtenFiles });
            } catch (err) {
              self.postMessage({ success: false, error: err.message, logs: logs, writtenFiles: writtenFiles });
            }
          };
        };

        function executeSyncFallback() {
          var logs = [];
          var writtenFiles = {};
          var customConsole = {
            log: function() { var args = Array.prototype.slice.call(arguments); logs.push(args.map(function(a){return typeof a === 'object' ? JSON.stringify(a) : String(a);}).join(' ')); },
            info: function() { this.log.apply(this, arguments); },
            warn: function() { this.log.apply(this, arguments); },
            error: function() { this.log.apply(this, arguments); }
          };
          var sum = function(arr){ return (arr||[]).reduce(function(a,b){return a + (Number(b)||0);}, 0); };
          var mean = function(arr){ return !arr||!arr.length ? 0 : sum(arr)/arr.length; };
          var median = function(arr){ if(!arr||!arr.length) return 0; var s = arr.slice().sort(function(a,b){return a-b;}); var m = Math.floor(s.length/2); return s.length%2!==0 ? s[m] : (s[m-1]+s[m])/2; };
          var stdDev = function(arr){ if(!arr||arr.length<2) return 0; var avg = mean(arr); var sq = arr.map(function(x){return Math.pow(x-avg, 2);}); return Math.sqrt(sum(sq)/(arr.length-1)); };
          var csvParse = function(txt){ var l = (txt||'').trim().split('\\n'); if(!l.length) return []; var h = l[0].split(',').map(function(s){return s.trim();}); return l.slice(1).map(function(row){ var c = row.split(','); var obj = {}; h.forEach(function(col, i){ obj[col] = (c[i]||'').trim(); }); return obj; }); };
          var groupBy = function(arr, key){ return (arr||[]).reduce(function(acc, item){ var k = item[key]; (acc[k] = acc[k] || []).push(item); return acc; }, {}); };
          var formatMarkdownTable = function(rows){ if(!rows||!rows.length) return ''; var h = Object.keys(rows[0]); var out = '| ' + h.join(' | ') + ' |\\n| ' + h.map(function(){return '---';}).join(' | ') + ' |\\n'; rows.forEach(function(r){ out += '| ' + h.map(function(k){return r[k]!==undefined?r[k]:'';}).join(' | ') + ' |\\n'; }); return out; };
          var writeWorkspaceFile = function(name, content){ var c = String(name||'').trim().replace(/^\\/+/,''); writtenFiles[c] = String(content||''); return true; };
          var appendWorkspaceFile = function(name, content){ var c = String(name||'').trim().replace(/^\\/+/,''); writtenFiles[c] = (writtenFiles[c]||'') + String(content||''); return true; };
          var listWorkspaceFiles = function(){ return Object.keys(writtenFiles); };

          try {
            var fn = new Function('console', 'sum', 'mean', 'median', 'stdDev', 'csvParse', 'groupBy', 'formatMarkdownTable', 'writeWorkspaceFile', 'appendWorkspaceFile', 'listWorkspaceFiles', code);
            var result = fn(customConsole, sum, mean, median, stdDev, csvParse, groupBy, formatMarkdownTable, writeWorkspaceFile, appendWorkspaceFile, listWorkspaceFiles);
            return { success: true, result: result, logs: logs, writtenFiles: writtenFiles, executionTimeMs: Math.round(performance.now() - start), engine: 'client-sandbox-inline' };
          } catch(err) {
            return { success: false, error: err.message, logs: logs, writtenFiles: writtenFiles, executionTimeMs: Math.round(performance.now() - start), engine: 'client-sandbox-inline' };
          }
        }

        try {
          var blob = new Blob(['(' + workerFn.toString() + ')()'], { type: 'application/javascript' });
          var workerUrl = URL.createObjectURL(blob);
          var worker = new Worker(workerUrl);

          var finished = false;
          var timer = setTimeout(function() {
            if (!finished) {
              finished = true;
              worker.terminate();
              try { URL.revokeObjectURL(workerUrl); } catch(e) {}
              resolve({
                success: false,
                error: 'Execution timed out (' + timeoutMs + 'ms) — terminated in client browser (server load: 0.00%).',
                logs: logs,
                executionTimeMs: Math.round(performance.now() - start),
                engine: 'client-wasm-worker',
              });
            }
          }, timeoutMs);

          worker.onmessage = function(e) {
            if (!finished) {
              finished = true;
              clearTimeout(timer);
              worker.terminate();
              try { URL.revokeObjectURL(workerUrl); } catch(e) {}
              var data = e.data;
              resolve({
                success: data.success,
                result: data.result,
                error: data.error,
                logs: data.logs || [],
                writtenFiles: data.writtenFiles || {},
                executionTimeMs: Math.round(performance.now() - start),
                engine: 'client-wasm-worker',
              });
            }
          };

          worker.onerror = function(err) {
            if (!finished) {
              finished = true;
              clearTimeout(timer);
              worker.terminate();
              try { URL.revokeObjectURL(workerUrl); } catch(e) {}
              // Gracefully fall back to inline sandbox if WebWorker was blocked by CSP or browser policy
              resolve(executeSyncFallback());
            }
          };

          worker.postMessage({ code: code });
        } catch (e) {
          resolve(executeSyncFallback());
        }
      });
    }

    let conversationHistory = [];
    let attachedImageDataUri = null;
    let attachedDocMeta = null;
    const MCP_PRESETS = ${presetsJson};

    function handleImageAttach(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      if (!allowedTypes.includes(file.type)) {
        alert("Only PNG, JPEG, WEBP, or GIF images are permitted.");
        input.value = "";
        return;
      }
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

    function toggleAttachDropdown(e) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const menu = document.getElementById('attach-dropdown-menu');
      if (!menu) return;
      menu.style.display = menu.style.display === 'none' || menu.style.display === '' ? 'flex' : 'none';
    }

    function triggerAttachImage() {
      const menu = document.getElementById('attach-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const input = document.getElementById('chat-image-input');
      if (input) input.click();
    }

    function triggerAttachDoc() {
      const menu = document.getElementById('attach-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const input = document.getElementById('chat-doc-input');
      if (input) input.click();
    }

    async function handleDocAttach(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      if (file.size > 20 * 1024 * 1024) {
        alert('Document must be under 20MB.');
        input.value = '';
        return;
      }

      const container = document.getElementById('attached-doc-container');
      const nameEl = document.getElementById('attached-doc-name');
      const statusEl = document.getElementById('attached-doc-status');

      if (container && nameEl && statusEl) {
        nameEl.textContent = file.name;
        statusEl.textContent = '⏳ Indexing into pgvector...';
        statusEl.style.color = '#f59e0b';
        container.style.display = 'inline-flex';
      }

      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const fileData = e.target.result;
          const res = await fetch('/api/knowledge/upload-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileData: fileData,
              fileType: file.type || ''
            })
          });
          const data = await res.json();
          if (data.success) {
            attachedDocMeta = {
              fileName: file.name,
              totalChunks: data.totalChunks,
              engine: data.engine
            };
            if (statusEl) {
              statusEl.textContent = '⚡ Vector Indexed (' + data.totalChunks + ' chunks ready for RAG)';
              statusEl.style.color = '#c084fc';
            }
          } else {
            if (statusEl) {
              statusEl.textContent = '⚠️ Indexing failed: ' + (data.error || 'Unknown error');
              statusEl.style.color = '#ef4444';
            }
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = '⚠️ Upload failed: ' + err.message;
            statusEl.style.color = '#ef4444';
          }
        }
      };
      reader.readAsDataURL(file);
    }

    function clearAttachedDoc() {
      attachedDocMeta = null;
      const input = document.getElementById('chat-doc-input');
      if (input) input.value = '';
      const container = document.getElementById('attached-doc-container');
      if (container) container.style.display = 'none';
    }

    function openGitHubModal() {
      const menu = document.getElementById('attach-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const modal = document.getElementById('github-rag-modal');
      const statusEl = document.getElementById('github-modal-status');
      if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
      }
      if (modal) modal.style.display = 'flex';
      const input = document.getElementById('github-repo-input');
      if (input) input.focus();
    }

    function closeGitHubModal() {
      const modal = document.getElementById('github-rag-modal');
      if (modal) modal.style.display = 'none';
    }

    async function submitGitHubConnect() {
      const repoInput = document.getElementById('github-repo-input');
      const branchInput = document.getElementById('github-branch-input');
      const statusEl = document.getElementById('github-modal-status');
      const submitBtn = document.getElementById('github-submit-btn');

      const repoUrl = (repoInput ? repoInput.value : '').trim();
      const branch = (branchInput ? branchInput.value : '').trim();

      if (!repoUrl) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
          statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          statusEl.style.color = '#fca5a5';
          statusEl.textContent = 'Please enter a GitHub repository URL or owner/repo (e.g. facebook/react).';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Indexing repo into pgvector...';
      }
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(56, 189, 248, 0.12)';
        statusEl.style.border = '1px solid rgba(56, 189, 248, 0.3)';
        statusEl.style.color = '#38bdf8';
        statusEl.textContent = 'Fetching file tree and generating 768-dim embeddings in Neon pgvector...';
      }

      try {
        const res = await fetch('/api/knowledge/connect-github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl, branch })
        });
        const data = await res.json();
        if (data.success) {
          if (statusEl) {
            statusEl.style.background = 'rgba(34, 197, 94, 0.15)';
            statusEl.style.border = '1px solid rgba(34, 197, 94, 0.4)';
            statusEl.style.color = '#4ade80';
            statusEl.textContent = '✓ Successfully indexed ' + data.indexedFilesCount + ' files from ' + data.repo + ' (' + data.branch + ') into pgvector!';
          }
          setTimeout(() => {
            closeGitHubModal();
            appendMessageBubble('assistant', '🔗 **Connected GitHub Repository:** ' + data.repo + ' (' + data.branch + ')\\n\\n' + data.indexedFilesCount + ' files have been chunked and indexed into Neon Lakebase pgvector with ' + data.engine + ' embeddings. You can now ask questions about the repository architecture, code, and documentation.');
          }, 1200);
        } else {
          if (statusEl) {
            statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
            statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            statusEl.style.color = '#fca5a5';
            statusEl.textContent = 'Error: ' + (data.error || 'Failed to index repository.');
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
          statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          statusEl.style.color = '#fca5a5';
          statusEl.textContent = 'Network error: ' + err.message;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Index Repository into pgvector';
        }
      }
    }

    document.addEventListener('click', function(e) {
      const menu = document.getElementById('attach-dropdown-menu');
      const btn = document.getElementById('attach-plus-btn');
      if (menu && menu.style.display === 'flex') {
        if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
          menu.style.display = 'none';
        }
      }
    });

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

      try {
        localStorage.setItem('shunops_preferred_model', val);
      } catch (e) {}

      const navSelect = document.getElementById('navbar-model-select');
      if (navSelect && navSelect.value !== val) {
        navSelect.value = val;
      }
    }

    function onNavbarModelChange(navVal) {
      const chatSelect = document.getElementById('chat-model-select');
      if (chatSelect && chatSelect.value !== navVal) {
        chatSelect.value = navVal;
        onModelPreferenceChange();
      }
    }

    async function fetchModelStatus() {
      try {
        const res = await fetch('/api/models/status');
        const data = await res.json();
        if (!data.success || !Array.isArray(data.tiers)) return;

        const selects = [
          document.getElementById('chat-model-select'),
          document.getElementById('navbar-model-select'),
        ].filter(Boolean);
        const badge = document.getElementById('model-status-badge');
        if (selects.length === 0) return;

        let degradedCount = 0;

        selects.forEach(select => {
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
        });

        const activeVal = (selects[0] && selects[0].value) || 'auto';
        if (badge && activeVal !== 'auto') {
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

    // Multi-Conversation Session Management & Persistence
    let currentConversationId = localStorage.getItem('shunops_current_conv_id') || ('conv_' + Date.now().toString(36));
    let cachedConversations = [];

    function formatRelativeTime(iso) {
      if (!iso) return 'Recent';
      try {
        const diffMs = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + 'd ago';
        return new Date(iso).toLocaleDateString();
      } catch (e) { return 'Recent'; }
    }

    function escapeHtmlAttr(str) {
      return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeHtmlText(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function renderConversationsList() {
      const container = document.getElementById('conversations-list-container');
      const countBadge = document.getElementById('chat-conversations-count');
      if (!container) return;

      if (countBadge) {
        countBadge.textContent = String(Math.max(1, cachedConversations.length));
      }

      if (cachedConversations.length === 0) {
        container.innerHTML = '<div style="color:#64748b; font-size:11px; padding:10px 4px; text-align:center;">No past chats yet. Start chatting below!</div>';
        return;
      }

      container.innerHTML = cachedConversations.map(function(c) {
        const isActive = c.id === currentConversationId;
        const activeCls = isActive ? 'conv-item active' : 'conv-item';
        const titleSafe = escapeHtmlText(c.title || 'Conversation');
        const countTxt = (c.message_count && c.message_count > 0) ? (' • ' + c.message_count + ' msgs') : '';
        return '<div class="' + activeCls + '" onclick="switchConversation(\\'' + escapeHtmlAttr(c.id) + '\\')" title="Open chat: ' + titleSafe + '">'
          + '<div style="overflow:hidden; flex:1; min-width:0;">'
          + '<div style="font-size:11.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + titleSafe + '</div>'
          + '<div style="font-size:9.5px; color:#64748b; margin-top:2px;">' + formatRelativeTime(c.updated_at) + countTxt + '</div>'
          + '</div>'
          + '<button type="button" onclick="event.stopPropagation(); deleteConversationById(\\'' + escapeHtmlAttr(c.id) + '\\')" class="conv-del-btn" style="background:transparent; border:none; color:#64748b; font-size:14px; cursor:pointer; padding:0 4px;" title="Delete this conversation">&times;</button>'
          + '</div>';
      }).join('');
    }

    async function loadConversationsList() {
      if (isGuest) {
        try {
          const raw = localStorage.getItem('shunops_guest_conversations');
          cachedConversations = raw ? JSON.parse(raw) : [];
        } catch (e) { cachedConversations = []; }
      } else {
        try {
          const res = await fetch('/api/workspace/conversations', { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.success && Array.isArray(data.conversations)) {
              cachedConversations = data.conversations;
            }
          }
        } catch (e) {}
      }

      // If active conversation not yet in list and we have messages, prepend it
      const exists = cachedConversations.some(function(c) { return c.id === currentConversationId; });
      if (!exists && conversationHistory.length > 0) {
        const firstUser = conversationHistory.find(function(m) { return m.role === 'user'; });
        const autoTitle = firstUser ? firstUser.content.slice(0, 45) : 'Current Chat';
        cachedConversations.unshift({
          id: currentConversationId,
          title: autoTitle,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      renderConversationsList();
    }

    async function loadSavedChatHistory(convId) {
      const thread = document.getElementById('chat-thread');
      const targetId = convId || currentConversationId;
      try {
        let messages = [];
        if (!isGuest) {
          const res = await fetch('/api/workspace/chat-history?conversationId=' + encodeURIComponent(targetId), { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.success && Array.isArray(data.messages)) {
              messages = data.messages;
            }
          }
        } else {
          try {
            const raw = localStorage.getItem('shunops_guest_msgs_' + targetId);
            messages = raw ? JSON.parse(raw) : [];
          } catch (e) {}
        }

        const emptyState = document.getElementById('empty-state');
        if (messages.length > 0) {
          if (emptyState) emptyState.remove();
          thread.innerHTML = '';
          conversationHistory = [];
          messages.forEach(function(m) {
            appendMessageBubble(m.role, m.message, false);
            conversationHistory.push({ role: m.role, content: m.message });
          });
          updateContextBadge();
        } else {
          conversationHistory = [];
          thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">'
            + '👋 Hello <strong>' + escapeHtmlText('${safeUsername}') + '</strong>! Start a new chat or pick a prompt below to begin.'
            + '</div>';
          updateContextBadge();
        }
      } catch (e) {
        const emptyState = document.getElementById('empty-state');
        if (emptyState) emptyState.innerHTML = '👋 Welcome! Start a new conversation below.';
      }
    }

    async function switchConversation(convId) {
      if (!convId || convId === currentConversationId) return;
      currentConversationId = convId;
      localStorage.setItem('shunops_current_conv_id', convId);
      await loadSavedChatHistory(convId);
      renderConversationsList();
    }

    async function startNewConversation() {
      if (conversationHistory.length > 0 && currentConversationId) {
        const firstUser = conversationHistory.find(function(m) { return m.role === 'user'; });
        const autoTitle = firstUser ? (firstUser.content || '').slice(0, 36) : 'Chat ' + currentConversationId.slice(-4);
        if (!isGuest) {
          try {
            await fetch('/api/workspace/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ id: currentConversationId, title: autoTitle })
            });
          } catch (e) {}
        }
      }

      currentConversationId = 'conv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      localStorage.setItem('shunops_current_conv_id', currentConversationId);
      conversationHistory = [];

      const thread = document.getElementById('chat-thread');
      if (thread) {
        thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">'
          + '✨ New conversation started! What would you like to build, debug, or explore?'
          + '</div>';
      }

      const input = document.getElementById('user-chat-input');
      if (input) input.focus();

      updateContextBadge();
      loadConversationsList();
    }

    async function deleteConversationById(convId) {
      if (!confirm('Are you sure you want to delete this conversation?')) return;
      if (isGuest) {
        cachedConversations = cachedConversations.filter(function(c) { return c.id !== convId; });
        try {
          localStorage.setItem('shunops_guest_conversations', JSON.stringify(cachedConversations));
          localStorage.removeItem('shunops_guest_msgs_' + convId);
        } catch (e) {}
      } else {
        try {
          await fetch('/api/workspace/conversations/' + encodeURIComponent(convId), {
            method: 'DELETE',
            credentials: 'same-origin'
          });
        } catch (e) {}
      }

      cachedConversations = cachedConversations.filter(function(c) { return c.id !== convId; });

      if (currentConversationId === convId) {
        startNewConversation();
      } else {
        renderConversationsList();
      }
    }

    async function clearCurrentConversation() {
      if (!confirm('Are you sure you want to clear messages in this chat thread?')) return;
      if (isGuest) {
        conversationHistory = [];
        try { localStorage.removeItem('shunops_guest_msgs_' + currentConversationId); } catch (e) {}
        const thread = document.getElementById('chat-thread');
        if (thread) {
          thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">👋 Conversation cleared. Ask a question below.</div>';
        }
      } else {
        try {
          await fetch('/api/workspace/chat-history?conversationId=' + encodeURIComponent(currentConversationId), {
            method: 'DELETE',
            credentials: 'same-origin'
          });
          conversationHistory = [];
          const thread = document.getElementById('chat-thread');
          if (thread) {
            thread.innerHTML = '<div id="empty-state" style="margin:auto; text-align:center; color:#64748b; font-size:13px; padding:20px;">👋 Conversation cleared. Ask a question below.</div>';
          }
        } catch (e) {
          alert('Could not clear history: ' + e.message);
        }
      }
      updateContextBadge();
      loadConversationsList();
    }

    function toggleConversationsDrawer() {
      const drawer = document.getElementById('chat-conversations-drawer');
      if (!drawer) return;
      drawer.style.display = (drawer.style.display === 'none') ? 'flex' : 'none';
    }
    window.startNewConversation = startNewConversation;
    window.switchConversation = switchConversation;
    window.deleteConversationById = deleteConversationById;
    window.clearCurrentConversation = clearCurrentConversation;
    window.clearConversation = clearCurrentConversation;
    window.toggleConversationsDrawer = toggleConversationsDrawer;
    window.loadConversationsList = loadConversationsList;

    function askSuggestion(text) {
      document.getElementById('user-chat-input').value = text;
      sendUserChat();
    }

    function renderSafeMarkdown(md) {
      if (!md) return '';
      let html = escapeHtmlText(String(md));
      html = html.replace(/\\x60\\x60\\x60([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\\x60\\x60\\x60/g, function(_, lang, code) {
        return '<pre style="background:#020617;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 12px;overflow-x:auto;font-family:monospace;font-size:12px;color:#e2e8f0;margin:8px 0;"><code>' + code.trim() + '</code></pre>';
      });
      html = html.replace(/\\x60([^\\x60\\n]+)\\x60/g, '<code style="background:rgba(56,189,248,0.12);color:#38bdf8;padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px;">$1</code>');
      html = html.replace(/^### (.*$)/gim, '<strong style="display:block;font-size:14px;color:#f8fafc;margin:10px 0 4px;">$1</strong>');
      html = html.replace(/^## (.*$)/gim, '<strong style="display:block;font-size:15px;color:#38bdf8;margin:12px 0 6px;">$1</strong>');
      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong style="color:#fff;">$1</strong>');
      html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;">$1</a>');
      // Convert workspace file references like 📄 filename.md into 1-click open buttons
      html = html.replace(/(?:📄|&#128196;)\\s*([a-zA-Z0-9_\\-\\.\\/]+\\.[a-zA-Z0-9]+)/g, function(_, fname) {
        return '<button type="button" class="btn-sub" onclick="openWorkspaceFileByName(\\'' + fname + '\\')" style="display:inline-flex; align-items:center; gap:5px; padding:3px 9px; font-size:11.5px; font-family:monospace; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); background:rgba(56,189,248,0.1); border-radius:6px; cursor:pointer; margin:2px 0; vertical-align:middle; font-weight:600;" title="Click to view/edit file in workspace">📄 ' + fname + ' <span style="font-size:9.5px; opacity:0.85; background:rgba(56,189,248,0.2); padding:1px 5px; border-radius:3px;">Open</span></button>';
      });
      html = html.replace(/\\[(?:file|workspace):\\s*([a-zA-Z0-9_\\-\\.\\/]+\\.[a-zA-Z0-9]+)\\]/gi, function(_, fname) {
        return '<button type="button" class="btn-sub" onclick="openWorkspaceFileByName(\\'' + fname + '\\')" style="display:inline-flex; align-items:center; gap:5px; padding:3px 9px; font-size:11.5px; font-family:monospace; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); background:rgba(56,189,248,0.1); border-radius:6px; cursor:pointer; margin:2px 0; vertical-align:middle; font-weight:600;" title="Click to view/edit file in workspace">📄 ' + fname + ' <span style="font-size:9.5px; opacity:0.85; background:rgba(56,189,248,0.2); padding:1px 5px; border-radius:3px;">Open</span></button>';
      });
      html = html.replace(/\\n/g, '<br>');
      return html;
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

      if (imageUri && /^data:image\\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(imageUri)) {
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

      // Render Agentic Execution Trace (Tool Calls & Steps) when present
      if (role === 'assistant' && meta && Array.isArray(meta.stepsLog) && meta.stepsLog.length > 0) {
        const traceBox = document.createElement('details');
        traceBox.style.margin = '8px 0 10px 0';
        traceBox.style.background = 'rgba(15, 23, 42, 0.75)';
        traceBox.style.border = '1px solid rgba(56, 189, 248, 0.28)';
        traceBox.style.borderRadius = '8px';
        traceBox.style.padding = '8px 12px';
        traceBox.style.fontSize = '12px';
        traceBox.open = true;

        const summary = document.createElement('summary');
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = '600';
        summary.style.color = '#38bdf8';
        summary.style.userSelect = 'none';
        summary.textContent = '🤖 Agentic Execution Trace (' + meta.stepsLog.length + ' tool action' + (meta.stepsLog.length > 1 ? 's' : '') + ' executed)';
        traceBox.appendChild(summary);

        const listDiv = document.createElement('div');
        listDiv.style.marginTop = '8px';
        listDiv.style.display = 'flex';
        listDiv.style.flexDirection = 'column';
        listDiv.style.gap = '6px';

        meta.stepsLog.forEach((st) => {
          const item = document.createElement('div');
          item.style.background = 'rgba(2, 6, 23, 0.65)';
          item.style.border = '1px solid ' + (st.isError ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.25)');
          item.style.borderRadius = '6px';
          item.style.padding = '6px 10px';
          item.style.fontFamily = 'monospace';
          item.style.fontSize = '11px';

          const topRow = document.createElement('div');
          topRow.style.display = 'flex';
          topRow.style.justifyContent = 'space-between';
          topRow.style.color = st.isError ? '#f87171' : '#34d399';
          topRow.style.fontWeight = '600';
          topRow.textContent = (st.isError ? '⚠️ Step ' : '🛠️ Step ') + st.step + ': ' + st.tool + ' (' + (st.durationMs || 1) + 'ms)';
          item.appendChild(topRow);

          if (st.argsPreview) {
            const argsEl = document.createElement('div');
            argsEl.style.color = '#94a3b8';
            argsEl.style.marginTop = '2px';
            argsEl.textContent = 'Args: ' + st.argsPreview;
            item.appendChild(argsEl);
          }
          if (st.resultPreview) {
            const resEl = document.createElement('div');
            resEl.style.color = '#cbd5e1';
            resEl.style.marginTop = '3px';
            resEl.style.whiteSpace = 'pre-wrap';
            resEl.textContent = 'Output: ' + st.resultPreview;
            item.appendChild(resEl);
          }
          listDiv.appendChild(item);
        });

        traceBox.appendChild(listDiv);
        bubble.appendChild(traceBox);
      }

      const body = document.createElement('div');
      body.className = 'msg-body';
      if (role === 'assistant') {
        body.innerHTML = renderSafeMarkdown(content);
      } else {
        body.textContent = content;
      }

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
      const currentAttachedDoc = attachedDocMeta;
      if (!msg && !currentAttachedImage && !currentAttachedDoc) return;
      if (!msg && currentAttachedImage) {
        msg = 'Analyze this image and explain what you see.';
      } else if (!msg && currentAttachedDoc) {
        msg = 'Please analyze and summarize the attached document "' + currentAttachedDoc.fileName + '".';
      } else if (currentAttachedDoc) {
        msg = msg + '\\n\\n[Refer to uploaded document: "' + currentAttachedDoc.fileName + '" indexed in pgvector]';
      }

      if (input) input.value = '';
      clearAttachedImage();
      clearAttachedDoc();

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
          if (vault.aiMode !== 'shared') {
            if (vault.groq) headers['x-groq-key'] = vault.groq;
            if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
          }
          if (vault.monitorUrl && (!vault.services || vault.services.sentinel !== false)) {
            historyItems.unshift('Configured Sentinel Monitored Website URL: ' + vault.monitorUrl);
          }
        }
        const finalHistoryPayload = historyItems.length > 0 ? historyItems.join('\\n\\n') : undefined;

        // Solve Proof-of-Work challenge in background (WebCrypto solves in ~20-30ms)
        let shieldSolution = null;
        try {
          const chRes = await fetch('/api/shield/challenge', { signal: currentChatAbortController.signal });
          if (chRes.ok) {
            const chData = await chRes.json();
            shieldSolution = await solveProofOfWork(chData);
          }
        } catch (e) {}

        const modelPreference = document.getElementById('navbar-model-select')?.value || document.getElementById('chat-model-select')?.value || 'auto';

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          signal: currentChatAbortController.signal,
          body: JSON.stringify({
            sessionId: currentConversationId,
            message: msg,
            history: finalHistoryPayload,
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
          stepsLog: Array.isArray(data.stepsLog) ? data.stepsLog : [],
        });

        conversationHistory.push({ role: 'user', content: msg });
        conversationHistory.push({ role: 'assistant', content: reply });
        updateContextBadge();

        const titleSnippet = msg.slice(0, 45).replace(/\\n/g, ' ').trim() || 'Conversation';
        const existingIdx = cachedConversations.findIndex(function(c) { return c.id === currentConversationId; });
        if (existingIdx === -1) {
          cachedConversations.unshift({
            id: currentConversationId,
            title: titleSnippet,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: conversationHistory.length
          });
        } else {
          cachedConversations[existingIdx].updated_at = new Date().toISOString();
          cachedConversations[existingIdx].message_count = conversationHistory.length;
        }

        if (isGuest) {
          try {
            localStorage.setItem('shunops_guest_msgs_' + currentConversationId, JSON.stringify(conversationHistory));
            localStorage.setItem('shunops_guest_conversations', JSON.stringify(cachedConversations));
          } catch (e) {}
        } else {
          try {
            fetch('/api/workspace/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ id: currentConversationId, title: titleSnippet })
            }).catch(() => {});
          } catch (e) {}
        }
        renderConversationsList();
        fetchBillingUsage();
        loadAgenticWorkspaceState();
        if (Array.isArray(data.stepsLog) && data.stepsLog.length > 0) {
          const toolsUsed = data.stepsLog.map(function(s) { return s.tool; });
          if (toolsUsed.indexOf('manage_workspace_files') !== -1) {
            switchAgenticTab('files');
          } else if (toolsUsed.indexOf('manage_agent_tasks') !== -1) {
            switchAgenticTab('tasks');
          } else if (toolsUsed.indexOf('manage_agent_schedules') !== -1) {
            switchAgenticTab('schedules');
          } else if (toolsUsed.indexOf('manage_agent_memory') !== -1) {
            switchAgenticTab('memory');
          }
        }

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
              <button class="btn-sub" style="border-color:#ef4444; color:#ef4444;" data-req-id="\${escapeHtmlAttr(req.id)}" onclick="submitApproval(this.dataset.reqId, false)">❌ Reject</button>
              <button class="btn-sub" style="background:#10b981; color:#fff; border:none;" data-req-id="\${escapeHtmlAttr(req.id)}" onclick="submitApproval(this.dataset.reqId, true)">✅ Approve</button>
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
    let currentInlineTier = 'native';

    const LOCAL_BRIDGE_PRESETS = [
      { id: 'local_bridge', name: 'Custom Local Bridge (127.0.0.1:8000)', url: 'http://127.0.0.1:8000/sse' },
      { id: 'local_bridge:docker', name: 'Docker Engine (Local Bridge)', url: 'http://127.0.0.1:8000/sse' },
      { id: 'local_bridge:sqlite', name: 'SQLite Database (Local Bridge)', url: 'http://127.0.0.1:8000/sse' },
      { id: 'local_bridge:git', name: 'Local Git Repository (Local Bridge)', url: 'http://127.0.0.1:8000/sse' },
      { id: 'local_bridge:ollama', name: 'Ollama Local LLMs (Local Bridge)', url: 'http://127.0.0.1:8000/sse' },
      { id: 'local_bridge:filesystem', name: 'Local Filesystem (Local Bridge)', url: 'http://127.0.0.1:8000/sse' }
    ];

    const REMOTE_MCP_POPULAR_PRESETS = [
      { id: 'mcp:shunops-core', name: 'ShunopsAI Core MCP (Built-in /api/mcp)', url: '/api/mcp' },
      { id: 'mcp', name: 'Custom Remote MCP Server (SSE / HTTPS)', url: '' },
      { id: 'mcp:wikipedia-mcp', name: 'Wikipedia & Wikidata MCP', url: 'https://mcp.wikipedia.org/v1' },
      { id: 'mcp:firecrawl-mcp', name: 'Firecrawl Web Scraper MCP', url: 'https://mcp.firecrawl.dev/v1' },
      { id: 'mcp:browserbase-mcp', name: 'Browserbase Cloud Browser MCP', url: 'https://mcp.browserbase.com/v1' },
      { id: 'mcp:arxiv-papers', name: 'ArXiv Research Papers MCP', url: 'https://mcp.arxiv.org/v1' },
      { id: 'mcp:exa-search', name: 'Exa Neural Search MCP', url: 'https://mcp.exa.ai/v1' },
      { id: 'mcp:slack-mcp', name: 'Slack Workspace MCP', url: 'https://mcp.slack.com/v1' },
      { id: 'mcp:linear-mcp', name: 'Linear Issues & Tracking MCP', url: 'https://mcp.linear.app/v1' }
    ];

    function setInlineTierFilter(tier) {
      currentInlineTier = tier;
      const tabNative = document.getElementById('tab-tier-native');
      const tabLocal = document.getElementById('tab-tier-local_bridge');
      const tabMcp = document.getElementById('tab-tier-mcp');

      if (tabNative) {
        tabNative.style.background = tier === 'native' ? '#10b981' : 'transparent';
        tabNative.style.color = tier === 'native' ? '#fff' : '#94a3b8';
      }
      if (tabLocal) {
        tabLocal.style.background = tier === 'local_bridge' ? '#f59e0b' : 'transparent';
        tabLocal.style.color = tier === 'local_bridge' ? '#fff' : '#94a3b8';
      }
      if (tabMcp) {
        tabMcp.style.background = tier === 'mcp' ? '#0284c7' : 'transparent';
        tabMcp.style.color = tier === 'mcp' ? '#fff' : '#94a3b8';
      }

      renderPlatformSelect();
    }

    // Attribute-safe escaping already provided by escapeHtmlAttr above.
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
        const isLocalBridge = item.platform === 'local_bridge' || item.platform.startsWith('local_bridge:') || (item.label && item.label.includes('(Local Bridge)'));
        const isMcp = !isLocalBridge && (item.platform === 'mcp' || item.platform.startsWith('mcp:'));
        const spec = platformSpecs.filter(function (s) {
          return s.id === item.platform || (isLocalBridge && s.id === 'local_bridge') || (isMcp && s.id === 'mcp');
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

        let tierBadge = '<span style="font-size:9px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 7px; border-radius:10px; font-weight:700; margin-left:6px;">⚡ Native</span>';
        if (isLocalBridge) {
          tierBadge = '<span style="font-size:9px; background:rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.25); padding:2px 7px; border-radius:10px; font-weight:700; margin-left:6px;">💻 Local Bridge</span>';
        } else if (isMcp) {
          tierBadge = '<span style="font-size:9px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:2px 7px; border-radius:10px; font-weight:700; margin-left:6px;">🌐 Remote MCP</span>';
        }

        const pingBtn = (isMcp || isLocalBridge)
          ? '<button class="btn-sub" data-test-ping="' + escapeHtmlAttr(item.platform) + '" style="border-color:rgba(56,189,248,0.3); color:#38bdf8; font-size:11px; padding:3px 8px;">⚡ Test Ping</button>'
          : '';

        const cleanLabel = (item.label || (spec ? spec.label : item.platform)).replace(/^⚡\s*/, '');

        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; margin-bottom:6px;">'
          + '<div><div style="font-size:12.5px; color:#fff; font-weight:600; display:flex; align-items:center;">'
          + escapeHtmlText(cleanLabel)
          + tierBadge
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

      let options = [];

      if (currentInlineTier === 'native') {
        platformSpecs.filter(function (s) { return s.tier === 'native'; }).forEach(function (spec) {
          const isConn = platformIsConnected(spec.id);
          options.push('<option value="' + escapeHtmlAttr(spec.id) + '">' + escapeHtmlText(spec.label + (isConn ? ' ✓ connected' : '')) + '</option>');
        });
      } else if (currentInlineTier === 'local_bridge') {
        LOCAL_BRIDGE_PRESETS.forEach(function (item) {
          const isConn = platformIsConnected(item.id);
          options.push('<option value="' + escapeHtmlAttr(item.id) + '">' + escapeHtmlText(item.name + (isConn ? ' ✓ connected' : '')) + '</option>');
        });
        platformConnected.forEach(function (conn) {
          if ((conn.platform === 'local_bridge' || conn.platform.startsWith('local_bridge:')) && !LOCAL_BRIDGE_PRESETS.some(function (b) { return b.id === conn.platform; })) {
            options.push('<option value="' + escapeHtmlAttr(conn.platform) + '">' + escapeHtmlText((conn.label || conn.platform) + ' ✓ connected') + '</option>');
          }
        });
      } else {
        // Tier 3: Remote MCP
        REMOTE_MCP_POPULAR_PRESETS.forEach(function (item) {
          const isConn = platformIsConnected(item.id);
          options.push('<option value="' + escapeHtmlAttr(item.id) + '">' + escapeHtmlText(item.name + (isConn ? ' ✓ connected' : '')) + '</option>');
        });
        // Deduplicated: Don't show native platforms under remote MCP!
        const nativeDuplicates = ['mcp:gcp', 'mcp:redis', 'mcp:neon', 'mcp:brave', 'mcp:tavily', 'mcp:cloudflare', 'mcp:github', 'mcp:supabase', 'mcp:upstash'];
        platformConnected.forEach(function (conn) {
          if (conn.platform.startsWith('mcp:') && nativeDuplicates.indexOf(conn.platform) === -1 && !REMOTE_MCP_POPULAR_PRESETS.some(function (r) { return r.id === conn.platform; }) && !LOCAL_BRIDGE_PRESETS.some(function (b) { return b.id === conn.platform; })) {
            options.push('<option value="' + escapeHtmlAttr(conn.platform) + '">' + escapeHtmlText((conn.label || conn.platform) + ' ✓ connected') + '</option>');
          }
        });
      }

      select.innerHTML = options.join('');
      if (previous && options.some(function (opt) { return opt.includes('value="' + escapeHtmlAttr(previous) + '"'); })) {
        select.value = previous;
      } else if (select.options.length > 0) {
        select.selectedIndex = 0;
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

      const selectedVal = select.value;
      const isLocalBridge = currentInlineTier === 'local_bridge' || selectedVal === 'local_bridge' || selectedVal.startsWith('local_bridge:');
      const isMcp = currentInlineTier === 'mcp' || selectedVal === 'mcp' || selectedVal.startsWith('mcp:');

      if (testBtn) testBtn.style.display = (isMcp || isLocalBridge) ? 'inline-block' : 'none';
      if (testStatus) {
        testStatus.style.display = 'none';
        testStatus.textContent = '';
      }

      let spec = null;
      if (isLocalBridge) {
        spec = platformSpecs.filter(function (s) { return s.id === 'local_bridge'; })[0];
      } else if (isMcp) {
        spec = platformSpecs.filter(function (s) { return s.id === 'mcp'; })[0];
      } else {
        spec = platformSpecs.filter(function (s) { return s.id === selectedVal; })[0];
      }

      setPlatformStatus('', true);
      if (!spec) {
        box.innerHTML = '';
        if (note) note.textContent = '';
        return;
      }

      const existing = connectedPlatformFor(selectedVal);
      box.innerHTML = '<div style="font-size:11.5px; color:#94a3b8; line-height:1.45;">' + escapeHtmlText(spec.description) + '</div>'
        + spec.fields.map(function (field) {
          return '<div style="display:flex; flex-direction:column; gap:4px;">'
            + '<label style="font-size:11px; color:#94a3b8;" data-cred-label="' + escapeHtmlAttr(field.key) + '">' + escapeHtmlText(field.label) + '</label>'
            + '<input data-cred-field="' + escapeHtmlAttr(field.key) + '" type="' + (field.secret ? 'password' : 'text') + '" placeholder="' + escapeHtmlAttr(field.placeholder) + '" autocomplete="off" spellcheck="false" style="width:100%; background:#070a12; border:1px solid #1e293b; border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; outline:none;" />'
            + '</div>';
        }).join('');

      // Auto-populate preset defaults if selecting a preset option:
      if (isLocalBridge) {
        const bridgeItem = LOCAL_BRIDGE_PRESETS.filter(function (b) { return b.id === selectedVal; })[0];
        const urlInput = box.querySelector('[data-cred-field="bridgeUrl"]');
        if (urlInput && bridgeItem && bridgeItem.url && !existing) {
          urlInput.value = bridgeItem.url;
        }
      } else if (isMcp) {
        const mcpItem = REMOTE_MCP_POPULAR_PRESETS.filter(function (r) { return r.id === selectedVal; })[0];
        const urlInput = box.querySelector('[data-cred-field="serverUrl"]');
        if (urlInput && mcpItem && mcpItem.url && !existing) {
          urlInput.value = mcpItem.url;
        }
      }

      const button = document.getElementById('platform-connect-button');
      if (button) button.textContent = existing ? 'Update Connection' : 'Connect Account';
      if (note) {
        note.textContent = existing
          ? 'The stored ' + (existing.label || spec.label) + ' credential is ' + (existing.hint || 'saved') + '. Submitting replaces it.'
          : '';
      }
    }

    async function testMcpConnection() {
      const urlInput = document.querySelector('[data-cred-field="serverUrl"]') || document.querySelector('[data-cred-field="bridgeUrl"]');
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
          statusBox.textContent = 'Please enter a Server / Bridge URL before testing.';
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
      const isLocalBridge = currentInlineTier === 'local_bridge' || platformId === 'local_bridge' || platformId.startsWith('local_bridge:');
      const isMcp = !isLocalBridge && (platformId === 'mcp' || platformId.startsWith('mcp:'));
      const spec = platformSpecs.filter(function (s) {
        return s.id === platformId || (isLocalBridge && s.id === 'local_bridge') || (isMcp && s.id === 'mcp');
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
      if (activeMcpPreset && (platformId === ('mcp:' + activeMcpPreset.id) || platformId === ('local_bridge:' + activeMcpPreset.id))) {
        customLabel = activeMcpPreset.name + (isLocalBridge ? ' (Local Bridge)' : ' MCP');
      } else if (isLocalBridge && platformId !== 'local_bridge') {
        const bridgePreset = LOCAL_BRIDGE_PRESETS.filter(function (b) { return b.id === platformId; })[0];
        customLabel = bridgePreset ? bridgePreset.name : (platformId.replace(/^local_bridge:/, '') + ' (Local Bridge)');
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
        const headers = { 'Content-Type': 'application/json' };
        const vault = await loadVaultKeys();
        let taskContext = undefined;
        if (vault) {
          if (vault.aiMode !== 'shared') {
            if (vault.groq) headers['x-groq-key'] = vault.groq;
            if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
          }
          if (vault.monitorUrl && (!vault.services || vault.services.sentinel !== false)) {
            taskContext = 'Configured Sentinel Monitored Website URL: ' + vault.monitorUrl;
          }
        }

        // Async dispatch keeps the page responsive while the agent works and
        // while it waits for your approval in the red bar above.
        const res = await fetch('/api/task', {
          method: 'POST',
          headers: headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            goal: goal,
            context: taskContext,
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

    async function pollTaskResult(taskId, statusBox, attempt) {
      const maxAttempts = 150; // Up to ~5 minutes (matching 5-min human approval timeout)
      if (!taskId || !statusBox) return;
      if (attempt >= maxAttempts) {
        statusBox.style.color = '#f59e0b';
        statusBox.textContent = 'Task ' + taskId + ' is still running in the background. Refresh to check status.';
        return;
      }

      try {
        const res = await fetch('/api/task/' + encodeURIComponent(taskId), {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setTimeout(function () { pollTaskResult(taskId, statusBox, attempt + 1); }, 2000);
          return;
        }
        const data = await res.json();
        const task = data && data.task;
        if (!task) {
          setTimeout(function () { pollTaskResult(taskId, statusBox, attempt + 1); }, 2000);
          return;
        }

        fetchWorkspaceApprovals();

        if (task.status === 'COMPLETED') {
          statusBox.style.color = '#10b981';
          const answer = (task.result && task.result.finalAnswer) || 'Task completed.';
          const steps = (task.result && task.result.stepsTaken) ? (' (' + task.result.stepsTaken + ' step(s))') : '';
          const sLog = (task.result && Array.isArray(task.result.stepsLog) && task.result.stepsLog.length > 0)
            ? '\\n\\n🤖 Executed Tools:\\n' + task.result.stepsLog.map(function(s) { return '• Step ' + s.step + ': ' + s.tool + ' (' + (s.durationMs || 1) + 'ms)'; }).join('\\n')
            : '';
          statusBox.textContent = '✅ Completed' + steps + ':\\n' + answer + sLog;
          fetchBillingUsage();
          loadWorkspaceTasks();
          loadAgenticWorkspaceState();
          return;
        }

        if (task.status === 'FAILED') {
          statusBox.style.color = '#f87171';
          const errText = task.error || (task.result && task.result.finalAnswer) || 'Task failed.';
          statusBox.textContent = '❌ Task failed: ' + errText;
          fetchBillingUsage();
          loadWorkspaceTasks();
          loadAgenticWorkspaceState();
          return;
        }

        statusBox.style.color = '#38bdf8';
        const stepInfo = task.currentStep ? (' [Step ' + task.currentStep + (task.currentTool ? (' • ' + task.currentTool) : '') + ']') : '';
        statusBox.textContent = '⏳ Task ' + taskId + ' is ' + (task.status || 'RUNNING') + stepInfo + '...';
        loadAgenticWorkspaceState();
        setTimeout(function () { pollTaskResult(taskId, statusBox, attempt + 1); }, 2000);
      } catch (e) {
        setTimeout(function () { pollTaskResult(taskId, statusBox, attempt + 1); }, 2500);
      }
    }


    async function loadWorkspaceTasks(resumeActive = false) {
      const box = document.getElementById('workspace-recent-tasks');
      if (!box) return;
      try {
        const res = await fetch('/api/tasks', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        const tasks = (data && Array.isArray(data.tasks)) ? data.tasks.slice(0, 4) : [];
        if (!tasks.length) {
          box.innerHTML = '';
          return;
        }
        if (resumeActive && (tasks[0].status === 'QUEUED' || tasks[0].status === 'RUNNING')) {
          const statusBox = document.getElementById('task-run-status');
          if (statusBox && statusBox.style.display === 'none') {
            statusBox.style.display = 'block';
            statusBox.style.color = '#38bdf8';
            statusBox.textContent = '⏳ Active task ' + tasks[0].id + ' (' + tasks[0].status + ')...';
            pollTaskResult(tasks[0].id, statusBox, 0);
          }
        }
        box.innerHTML = '<div style="font-size:10.5px; font-weight:700; color:#64748b; text-transform:uppercase; margin-bottom:6px; letter-spacing:0.5px;">Recent Tasks</div>'
          + tasks.map(function (t) {
            const st = String(t.status || 'COMPLETED').toUpperCase();
            const color = st === 'COMPLETED' ? '#10b981' : (st === 'FAILED' ? '#f87171' : '#38bdf8');
            const goalPreview = String(t.goal || '').slice(0, 65) + (String(t.goal || '').length > 65 ? '...' : '');
            return '<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:5px 7px; background:#070a12; border:1px solid #1e293b; border-radius:6px; margin-bottom:4px;">'
              + '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#cbd5e1; font-size:11px;" title="' + escapeHtmlAttr(t.goal || '') + '">' + escapeHtmlText(goalPreview) + '</span>'
              + '<span style="font-size:9.5px; font-weight:700; color:' + color + '; flex-shrink:0;">' + escapeHtmlText(st) + '</span>'
              + '</div>';
          }).join('');
      } catch (e) {}
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
      setPresetTierFilter(currentInlineTier === 'local_bridge' ? 'local_bridge' : (currentInlineTier === 'mcp' ? 'mcp' : 'all'));
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
        setInlineTierFilter('native');
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
        setInlineTierFilter('local_bridge');
        const bridgePlatformId = 'local_bridge:' + preset.id;
        let opt = platformSelect.querySelector('option[value="' + bridgePlatformId + '"]');
        if (!opt) {
          opt = document.createElement('option');
          opt.value = bridgePlatformId;
          opt.textContent = preset.name + ' (Local Bridge)' + (platformIsConnected(bridgePlatformId) ? ' ✓ connected' : '');
          platformSelect.appendChild(opt);
        }
        platformSelect.value = bridgePlatformId;
        activeMcpPreset = preset;
        onPlatformSelectChange();

        setTimeout(() => {
          const urlInput = document.querySelector('[data-cred-field="bridgeUrl"]') || document.querySelector('[data-cred-field="serverUrl"]');
          if (urlInput) urlInput.value = preset.url || 'http://127.0.0.1:8000/sse';
          setPlatformStatus('Configured 💻 Local Bridge for ' + preset.name + '. Click "Test Connection 🔌" to verify, then "Connect Account".', true);
        }, 50);
        return;
      }

      // Tier 3: Remote Cloud MCP Server
      setInlineTierFilter('mcp');
      const customPlatformId = 'mcp:' + preset.id;
      let opt = platformSelect.querySelector('option[value="' + customPlatformId + '"]');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = customPlatformId;
        opt.textContent = preset.name + (platformIsConnected(customPlatformId) ? ' ✓ connected' : '');
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


    // 10. 2-Mode Switcher (Chat vs Work) & Non-Destructive Agentic Workspace Hub
    let currentMainMode = 'chat';
    let currentWorkEngineTab = 'task';
    let currentAgenticTab = 'tasks';
    const AGENTIC_LOCAL_CACHE_KEY = 'shunops_agentic_state_v2_${safeUsername}';
    let cachedAgenticState = { files: [], tasks: [], memories: [], schedules: [] };
    let lastAgenticStateEtag = '';

    function saveLocalAgenticCache() {
      try {
        localStorage.setItem(AGENTIC_LOCAL_CACHE_KEY, JSON.stringify(cachedAgenticState));
      } catch (e) {}
    }

    function restoreLocalAgenticCache() {
      try {
        const raw = localStorage.getItem(AGENTIC_LOCAL_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          cachedAgenticState = {
            files: Array.isArray(parsed.files) ? parsed.files : [],
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
            memories: Array.isArray(parsed.memories) ? parsed.memories : [],
            schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
          };
        }
      } catch (e) {}
    }

    function switchWorkspaceMainMode(mode) {
      currentMainMode = mode === 'work' ? 'work' : 'chat';
      const chatView = document.getElementById('workspace-mode-chat');
      const workView = document.getElementById('workspace-mode-work');
      const chatBtn = document.getElementById('mode-tab-btn-chat');
      const workBtn = document.getElementById('mode-tab-btn-work');
      if (chatView) chatView.style.display = currentMainMode === 'chat' ? 'block' : 'none';
      if (workView) workView.style.display = currentMainMode === 'work' ? 'block' : 'none';
      if (chatBtn) chatBtn.classList.toggle('active', currentMainMode === 'chat');
      if (workBtn) workBtn.classList.toggle('active', currentMainMode === 'work');
    }

    function switchWorkEngineTab(subTab) {
      currentWorkEngineTab = subTab;
      ['task', 'code', 'swarm'].forEach(function(t) {
        const btn = document.getElementById('work-subtab-btn-' + t);
        const panel = document.getElementById('work-subpanel-' + t);
        if (btn) btn.classList.toggle('active', t === subTab);
        if (panel) panel.style.display = t === subTab ? 'block' : 'none';
      });
    }

    function switchAgenticTab(tab) {
      currentAgenticTab = tab;
      ['tasks', 'files', 'memory', 'schedules'].forEach(function(t) {
        const btn = document.getElementById('agentic-tab-btn-' + t);
        const panel = document.getElementById('agentic-panel-' + t);
        if (btn) {
          if (t === tab) {
            btn.style.background = '#2563eb';
            btn.style.color = '#fff';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = '#94a3b8';
          }
        }
        if (panel) {
          panel.style.display = t === tab ? 'block' : 'none';
        }
      });
    }

    function mergeNonDestructiveArrays(localArr, serverArr, keyField) {
      const map = new Map();
      (Array.isArray(localArr) ? localArr : []).forEach(function(item) {
        if (item && item[keyField] !== undefined) map.set(String(item[keyField]), item);
      });
      (Array.isArray(serverArr) ? serverArr : []).forEach(function(item) {
        if (item && item[keyField] !== undefined) map.set(String(item[keyField]), item);
      });
      return Array.from(map.values());
    }

    async function loadAgenticWorkspaceState(isManualSync) {
      const syncBadge = document.getElementById('sync-status-badge');
      if (isManualSync && syncBadge) {
        syncBadge.style.display = 'inline';
        syncBadge.style.color = '#38bdf8';
        syncBadge.textContent = '↻ Syncing...';
      }
      try {
        let data = null;
        if (isManualSync) {
          const res = await fetch('/api/workspace/agentic-state/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(cachedAgenticState),
          });
          if (res.ok) data = await res.json();
        } else {
          const hdrs = lastAgenticStateEtag ? { 'If-None-Match': lastAgenticStateEtag } : {};
          const res = await fetch('/api/workspace/agentic-state', { credentials: 'same-origin', headers: hdrs });
          if (res.status === 304) return;
          if (res.ok) {
            const newEtag = res.headers.get('ETag');
            if (newEtag) lastAgenticStateEtag = newEtag;
            data = await res.json();
          }
        }
        if (!data || !data.success) return;

        const serverFiles = Array.isArray(data.files) ? data.files : [];
        const serverTasks = Array.isArray(data.tasks) ? data.tasks : [];
        const serverMemories = Array.isArray(data.memories) ? data.memories : [];
        const serverSchedules = Array.isArray(data.schedules) ? data.schedules : [];

        const serverEmpty = serverFiles.length === 0 && serverTasks.length === 0 && serverMemories.length === 0 && serverSchedules.length === 0;
        const localHasRecords = (cachedAgenticState.files && cachedAgenticState.files.length > 0) ||
          (cachedAgenticState.tasks && cachedAgenticState.tasks.length > 0) ||
          (cachedAgenticState.memories && cachedAgenticState.memories.length > 0) ||
          (cachedAgenticState.schedules && cachedAgenticState.schedules.length > 0);

        if (serverEmpty && localHasRecords && !window.__shunopsUserEmptiedAll) {
          fetch('/api/workspace/agentic-state/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(cachedAgenticState),
          }).catch(function() {});
          renderAgenticWorkspaceState();
          return;
        }

        // Authoritative update when server has records (prevents deleted items from becoming zombie records),
        // while manual sync merges any unsynced local additions first via POST /api/workspace/agentic-state/sync.
        cachedAgenticState = {
          files: serverFiles,
          tasks: serverTasks,
          memories: serverMemories,
          schedules: serverSchedules,
        };
        const totalRemaining = serverTasks.length + serverFiles.length + serverMemories.length + serverSchedules.length;
        window.__shunopsUserEmptiedAll = (totalRemaining === 0);
        saveLocalAgenticCache();
        renderAgenticWorkspaceState();

        if (isManualSync && syncBadge) {
          syncBadge.style.color = '#10b981';
          syncBadge.textContent = '✓ Synced';
          setTimeout(function() {
            if (syncBadge) syncBadge.style.display = 'none';
          }, 2500);
        }
      } catch (e) {
        if (isManualSync && syncBadge) {
          syncBadge.style.color = '#f59e0b';
          syncBadge.textContent = 'Local Cache Active';
        }
      }
    }

    function renderAgenticWorkspaceState() {
      const tasks = cachedAgenticState.tasks || [];
      const files = cachedAgenticState.files || [];
      const memories = cachedAgenticState.memories || [];

      const tCount = document.getElementById('agentic-tasks-count');
      const fCount = document.getElementById('agentic-files-count');
      const schedules = cachedAgenticState.schedules || [];
      const mCount = document.getElementById('agentic-memory-count');
      const sCount = document.getElementById('agentic-schedules-count');
      if (tCount) tCount.textContent = String(tasks.length);
      if (fCount) fCount.textContent = String(files.length);
      if (mCount) mCount.textContent = String(memories.length);
      if (sCount) sCount.textContent = String(schedules.length);
      const chatFCount = document.getElementById('chat-header-files-count');
      if (chatFCount) chatFCount.textContent = String(files.length);
      const summaryBadge = document.getElementById('work-mode-summary-badge');
      if (summaryBadge) {
        const totalItems = tasks.length + files.length + memories.length + schedules.length;
        summaryBadge.textContent = totalItems > 0
          ? (tasks.length + ' Tasks • ' + files.length + ' Files')
          : 'Tasks • Code • Swarm';
      }
      saveLocalAgenticCache();

      // Render Tasks
      const tList = document.getElementById('agentic-tasks-list');
      const tProgBox = document.getElementById('agentic-tasks-progress');
      const tProgLbl = document.getElementById('agentic-tasks-progress-label');
      const tProgBar = document.getElementById('agentic-tasks-progress-bar');
      if (tList) {
        if (tasks.length === 0) {
          if (tProgBox) tProgBox.style.display = 'none';
          tList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px 0;">No active task plan yet. Ask the agent to create a plan or add a step below.</div>';
        } else {
          const doneCount = tasks.filter(function(t) { return t.status === 'completed'; }).length;
          const pct = Math.round((doneCount / tasks.length) * 100);
          if (tProgBox) tProgBox.style.display = 'block';
          if (tProgLbl) tProgLbl.textContent = doneCount + '/' + tasks.length + ' completed (' + pct + '%)';
          if (tProgBar) tProgBar.style.width = pct + '%';

          tList.innerHTML = tasks.map(function(t) {
            const isDone = t.status === 'completed';
            const isProg = t.status === 'in_progress';
            const badgeIcon = isDone ? '✅' : (isProg ? '⏳' : '⬜');
            const titleStyle = isDone ? 'text-decoration:line-through; color:#64748b;' : (isProg ? 'color:#38bdf8; font-weight:600;' : 'color:#e2e8f0;');
            return '<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:6px 8px; background:#070a12; border:1px solid ' + (isProg ? 'rgba(56,189,248,0.4)' : '#1e293b') + '; border-radius:6px; cursor:pointer;" data-task-id="' + t.id + '" data-task-status="' + escapeHtmlAttr(t.status) + '" onclick="cycleAgentTaskStatus(Number(this.dataset.taskId), this.dataset.taskStatus)" title="Click to cycle status (Pending -> In Progress -> Completed)">'
              + '<div style="display:flex; align-items:center; gap:6px; overflow:hidden;">'
              + '<span>' + badgeIcon + '</span>'
              + '<span style="font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ' + titleStyle + '">' + escapeHtmlText(t.title) + '</span>'
              + '</div>'
              + '<div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">'
              + '<span style="font-size:9.5px; color:#64748b; font-family:monospace;">#' + t.id + '</span>'
              + '<button type="button" data-task-id="' + t.id + '" onclick="event.stopPropagation(); deleteAgentTask(Number(this.dataset.taskId))" style="background:transparent; border:none; color:#64748b; font-size:11px; cursor:pointer; padding:0 3px; line-height:1; transition:color 0.15s;" onmouseover="this.style.color=\'#f87171\'" onmouseout="this.style.color=\'#64748b\'" title="Delete task">✕</button>'
              + '</div>'
              + '</div>';
          }).join('');
        }
      }

      // Render Files
      const fList = document.getElementById('agentic-files-list');
      if (fList) {
        if (files.length === 0) {
          fList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px 0;">No workspace files yet. Ask the agent to save notes, code, or reports.</div>';
        } else {
          fList.innerHTML = files.map(function(f, idx) {
            return '<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:6px 8px; background:#070a12; border:1px solid #1e293b; border-radius:6px;">'
              + '<div style="overflow:hidden; cursor:pointer; flex:1;" data-file-idx="' + idx + '" onclick="openWorkspaceFileByIdx(Number(this.dataset.fileIdx))" title="Click to view or edit file">'
              + '<div style="color:#38bdf8; font-weight:600; font-family:monospace; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📄 ' + escapeHtmlText(f.name) + '</div>'
              + '<div style="color:#64748b; font-size:10px;">' + (f.sizeBytes || 0) + ' bytes</div>'
              + '</div>'
              + '<div style="display:flex; gap:4px; flex-shrink:0;">'
              + '<button type="button" class="btn-sub" style="padding:2px 6px; font-size:10px;" data-file-idx="' + idx + '" onclick="openWorkspaceFileByIdx(Number(this.dataset.fileIdx))">Open</button>'
              + '<button type="button" class="btn-sub" style="padding:2px 6px; font-size:10px; border-color:rgba(239,68,68,0.35); color:#ef4444;" data-file-idx="' + idx + '" onclick="deleteWorkspaceFileByIdx(Number(this.dataset.fileIdx))">&times;</button>'
              + '</div>'
              + '</div>';
          }).join('');
        }
      }

      // Render Memories
      const mList = document.getElementById('agentic-memory-list');
      if (mList) {
        if (memories.length === 0) {
          mList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px 0;">No saved memories yet. Tell the agent to remember your stack or preferences.</div>';
        } else {
          mList.innerHTML = memories.map(function(m, idx) {
            return '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:6px; padding:6px 8px; background:#070a12; border:1px solid #1e293b; border-radius:6px;">'
              + '<div style="overflow:hidden; flex:1;">'
              + '<div style="color:#a855f7; font-weight:600; font-family:monospace; font-size:10.5px;">[' + escapeHtmlText(m.key) + ']</div>'
              + '<div style="color:#cbd5e1; font-size:11px; line-height:1.35; word-break:break-word;">' + escapeHtmlText(m.fact) + '</div>'
              + '</div>'
              + '<button type="button" class="btn-sub" style="padding:1px 5px; font-size:10px; border-color:rgba(239,68,68,0.35); color:#ef4444; flex-shrink:0;" data-mem-idx="' + idx + '" onclick="forgetAgentMemoryByIdx(Number(this.dataset.memIdx))" title="Forget memory">&times;</button>'
              + '</div>';
          }).join('');
        }
      }

      // Render Schedules
      const sList = document.getElementById('agentic-schedules-list');
      if (sList) {
        if (schedules.length === 0) {
          sList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px 0;">No active watchdogs yet. Add a website monitor or research digest below.</div>';
        } else {
          sList.innerHTML = schedules.map(function(s) {
            const stColor = s.lastStatus === 'ALERT' || s.lastStatus === 'ERROR' ? '#f87171' : '#10b981';
            return '<div style="padding:6px 8px; background:#070a12; border:1px solid #1e293b; border-radius:6px;">'
              + '<div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">'
              + '<strong style="color:#e2e8f0; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (s.enabled ? '🟢 ' : '⏸️ ') + escapeHtmlText(s.name) + '</strong>'
              + '<div style="display:flex; gap:3px; flex-shrink:0;">'
              + '<button type="button" class="btn-sub" style="padding:1px 5px; font-size:9.5px; color:#38bdf8;" onclick="runAgentScheduleNow(' + s.id + ')" title="Run monitor immediately">▶ Run</button>'
              + '<button type="button" class="btn-sub" style="padding:1px 5px; font-size:9.5px;" onclick="toggleAgentScheduleEnabled(' + s.id + ', ' + (!s.enabled) + ')">' + (s.enabled ? 'Pause' : 'Resume') + '</button>'
              + '<button type="button" class="btn-sub" style="padding:1px 5px; font-size:9.5px; color:#ef4444; border-color:rgba(239,68,68,0.35);" onclick="deleteAgentSchedule(' + s.id + ')">&times;</button>'
              + '</div>'
              + '</div>'
              + '<div style="font-size:10px; color:#64748b; margin-top:2px;">Every ' + s.intervalMinutes + 'm &rarr; <code>' + escapeHtmlText(s.outputFilename) + '</code> (Runs: ' + (s.runCount || 0) + ')</div>'
              + (s.lastSummary ? ('<div style="font-size:10px; color:' + stColor + '; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtmlText(s.lastSummary) + '</div>') : '')
              + '</div>';
          }).join('');
        }
      }
    }

    async function cycleAgentTaskStatus(taskId, currentStatus) {
      const nextStatus = currentStatus === 'pending' ? 'in_progress' : (currentStatus === 'in_progress' ? 'completed' : 'pending');
      try {
        const res = await fetch('/api/workspace/agent-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'update_task', taskId: taskId, status: nextStatus }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.tasks = data.tasks || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function addManualAgentTask() {
      const input = document.getElementById('agentic-new-task-input');
      if (!input) return;
      const title = (input.value || '').trim();
      if (!title) return;
      input.value = '';
      try {
        const res = await fetch('/api/workspace/agent-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'add_task', title: title }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.tasks = data.tasks || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function clearCompletedAgentTasks() {
      try {
        const res = await fetch('/api/workspace/agent-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'clear_completed' }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.tasks = data.tasks || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function clearAllAgentTasks() {
      try {
        const res = await fetch('/api/workspace/agent-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'clear_all' }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.tasks = [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function deleteAgentTask(taskId) {
      if (!taskId) return;
      try {
        const res = await fetch('/api/workspace/agent-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'delete_task', taskId: taskId }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.tasks = (cachedAgenticState.tasks || []).filter(function(t) { return t.id !== taskId; });
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    function openWorkspaceFileByName(filename) {
      filename = (filename || '').trim();
      if (!filename) return;
      var cleanName = filename.replace(/^[\\s📄\\-*#\\x60'"]+|[#\\x60'"\\s]+$/g, '');
      var files = cachedAgenticState.files || [];
      var target = files.find(function(f) {
        return (f.name || '').toLowerCase() === cleanName.toLowerCase();
      });
      if (!target) {
        target = files.find(function(f) {
          var fn = (f.name || '').toLowerCase();
          var cn = cleanName.toLowerCase();
          return fn.includes(cn) || cn.includes(fn);
        });
      }
      if (target) {
        openWorkspaceFileModal(target.name, target.content);
        return;
      }
      fetch('/api/workspace/agentic-state', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.success && Array.isArray(data.files)) {
            cachedAgenticState.files = data.files;
            renderAgenticWorkspaceState();
            var serverTarget = data.files.find(function(f) {
              return (f.name || '').toLowerCase() === cleanName.toLowerCase();
            }) || data.files.find(function(f) {
              var sfn = (f.name || '').toLowerCase();
              var scn = cleanName.toLowerCase();
              return sfn.includes(scn) || scn.includes(sfn);
            });
            if (serverTarget) {
              openWorkspaceFileModal(serverTarget.name, serverTarget.content);
              return;
            }
          }
          alert('Workspace file "' + cleanName + '" was not found in your workspace.');
        })
        .catch(function() {
          alert('Workspace file "' + cleanName + '" was not found in your workspace.');
        });
    }
    window.openWorkspaceFileByName = openWorkspaceFileByName;
    window.openWorkspaceFileByIdx = openWorkspaceFileByIdx;

    function openWorkspaceFileByIdx(idx) {
      const file = (cachedAgenticState.files || [])[idx];
      if (!file) return;
      openWorkspaceFileModal(file.name, file.content);
    }

    function openWorkspaceFileModal(filename, fileContent) {
      const modal = document.getElementById('workspace-file-modal');
      const nameInput = document.getElementById('workspace-file-name-input');
      const contentInput = document.getElementById('workspace-file-content-input');
      const runBtn = document.getElementById('workspace-file-run-btn');
      if (!modal || !nameInput || !contentInput) return;
      nameInput.value = filename || '';
      contentInput.value = fileContent || '';
      if (runBtn) {
        runBtn.style.display = (filename && filename.endsWith('.js')) ? 'inline-block' : 'none';
      }
      modal.classList.add('active');
    }

    function closeWorkspaceFileModal() {
      const modal = document.getElementById('workspace-file-modal');
      if (modal) modal.classList.remove('active');
    }

    async function saveCurrentWorkspaceFile() {
      const nameInput = document.getElementById('workspace-file-name-input');
      const contentInput = document.getElementById('workspace-file-content-input');
      if (!nameInput || !contentInput) return;
      const filename = (nameInput.value || '').trim();
      const fileContent = contentInput.value || '';
      if (!filename) {
        alert('Please enter a filename (e.g. notes.md).');
        return;
      }
      if (isGuest) {
        cachedAgenticState.files = mergeNonDestructiveArrays(cachedAgenticState.files, [{
          name: filename,
          content: fileContent,
          sizeBytes: fileContent.length,
          updatedAt: new Date().toISOString()
        }], 'name');
        saveLocalAgenticCache();
        renderAgenticWorkspaceState();
        closeWorkspaceFileModal();
        return;
      }
      try {
        const res = await fetch('/api/workspace/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'write', filename: filename, content: fileContent }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.files = data.files || [];
          renderAgenticWorkspaceState();
          closeWorkspaceFileModal();
        } else {
          alert((data && data.error) || 'Could not save file.');
        }
      } catch (e) {
        alert('Network error while saving file.');
      }
    }

    async function deleteWorkspaceFileByIdx(idx) {
      const file = (cachedAgenticState.files || [])[idx];
      if (!file) return;
      if (!confirm('Delete workspace file "' + file.name + '"?')) return;
      try {
        const res = await fetch('/api/workspace/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'delete', filename: file.name }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.files = data.files || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    function copyCurrentWorkspaceFile(btn) {
      const contentInput = document.getElementById('workspace-file-content-input');
      if (!contentInput) return;
      copyToClipboardStandard(btn, contentInput.value, 'Copied!');
    }

    function downloadCurrentWorkspaceFile() {
      const nameInput = document.getElementById('workspace-file-name-input');
      const contentInput = document.getElementById('workspace-file-content-input');
      if (!nameInput || !contentInput) return;
      const filename = (nameInput.value || 'workspace-file.txt').trim();
      const blob = new Blob([contentInput.value || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || 'file.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function addManualAgentMemory() {
      const keyInput = document.getElementById('agentic-mem-key-input');
      const factInput = document.getElementById('agentic-mem-fact-input');
      if (!keyInput || !factInput) return;
      const key = (keyInput.value || '').trim();
      const fact = (factInput.value || '').trim();
      if (!key || !fact) return;
      keyInput.value = '';
      factInput.value = '';
      try {
        const res = await fetch('/api/workspace/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'remember', key: key, fact: fact }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.memories = data.memories || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function forgetAgentMemoryByIdx(idx) {
      const mem = (cachedAgenticState.memories || [])[idx];
      if (!mem) return;
      try {
        const res = await fetch('/api/workspace/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'forget', key: mem.key }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.memories = data.memories || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }


    function runCurrentWorkspaceFileInSandbox() {
      const contentInput = document.getElementById('workspace-file-content-input');
      const codeVal = (contentInput && contentInput.value) || '';
      const workCodeIn = document.getElementById('work-sandbox-code-input');
      if (workCodeIn && codeVal) workCodeIn.value = codeVal;
      closeWorkspaceFileModal();
      openSandboxCodeModal(codeVal);
    }

    function loadSandboxTemplate(tplName, forModal) {
      const targetId = forModal ? 'sandbox-code-input' : 'work-sandbox-code-input';
      const input = document.getElementById(targetId);
      if (!input) return;
      if (tplName === 'blank') {
        input.value = '// Write your custom JavaScript task here:\\n';
        input.focus();
      } else if (tplName === 'benchmark') {
        input.value = [
          '// Custom Data Structure Speed Benchmark',
          'const N = 25000;',
          'const arr = Array.from({ length: N }, (_, i) => "id_" + i);',
          'const set = new Set(arr);',
          'const t0 = Date.now();',
          'let hitsArr = 0;',
          'for (let i = 0; i < 500; i++) { if (arr.includes("id_" + (N - 1))) hitsArr++; }',
          'const arrMs = Date.now() - t0;',
          'const t1 = Date.now();',
          'let hitsSet = 0;',
          'for (let i = 0; i < 500; i++) { if (set.has("id_" + (N - 1))) hitsSet++; }',
          'const setMs = Date.now() - t1;',
          'return { items: N, arrayLookupMs: arrMs, setLookupMs: setMs, winner: setMs <= arrMs ? "Set" : "Array" };'
        ].join('\\n');
      } else if (tplName === 'file_gen') {
        input.value = [
          '// Generate a custom report or JSON config and save it to your Workspace Files',
          'const report = {',
          '  generatedAt: new Date().toISOString(),',
          '  service: "ShunopsAI Multi-Cloud",',
          '  metrics: { p50Ms: 14, p95Ms: 39, cacheHitRatio: 0.88 }',
          '};',
          'writeWorkspaceFile("custom-metrics.json", JSON.stringify(report, null, 2));',
          'return { savedTo: "custom-metrics.json", preview: report };'
        ].join('\\n');
      } else if (tplName === 'stats') {
        input.value = [
          '// Quantitative Math & Statistical Analysis',
          'const latencies = [12, 18, 25, 14, 92, 19, 22, 16, 31];',
          'return {',
          '  count: latencies.length,',
          '  sum: sum(latencies),',
          '  mean: Number(mean(latencies).toFixed(2)),',
          '  median: median(latencies),',
          '  stdDev: Number(stdDev(latencies).toFixed(2))',
          '};'
        ].join('\\n');
      }
    }

    function openSandboxCodeModal(initialCode) {
      const modal = document.getElementById('sandbox-code-modal');
      const input = document.getElementById('sandbox-code-input');
      const outBox = document.getElementById('sandbox-output-box');
      const meta = document.getElementById('sandbox-run-meta');
      if (!modal || !input) return;
      if (initialCode !== undefined) {
        input.value = initialCode;
      }
      if (outBox) outBox.style.display = 'none';
      if (meta) meta.textContent = '';
      modal.classList.add('active');
    }

    function closeSandboxCodeModal() {
      const modal = document.getElementById('sandbox-code-modal');
      if (modal) modal.classList.remove('active');
    }

    async function runSandboxExecutionHelper(opts) {
      const { codeVal, taskPrompt, codeInputEl, outBox, outContent, meta, btn, defaultBtnLabel } = opts;
      if (btn) {
        btn.disabled = true;
        btn.textContent = taskPrompt ? '✨ AI Generating & Running...' : 'Running...';
      }
      if (meta) {
        meta.style.color = '#38bdf8';
        meta.textContent = taskPrompt ? 'AI is writing & executing JS in sandbox...' : 'Executing in sandbox...';
      }

      // Pillar 1: Client-Side WASM / WebWorker Run (Aapka Server Chhuyega Bhi Nahi)
      if (isGuest && !taskPrompt) {
        try {
          const res = await runCodeInBrowserSandbox(codeVal, 3000);
          if (outBox) outBox.style.display = 'block';
          if (btn) {
            btn.disabled = false;
            btn.textContent = defaultBtnLabel;
          }
          if (res.success) {
            if (meta) {
              meta.style.color = '#10b981';
              meta.textContent = '✓ Executed in ' + res.executionTimeMs + 'ms (Client QuickJS/WASM Sandbox • 0% Server Load)';
            }
            let outText = '';
            if (res.logs && res.logs.length > 0) {
              outText += '=== Console Logs ===\\n' + res.logs.join('\\n') + '\\n\\n';
            }
            if (res.writtenFiles && Object.keys(res.writtenFiles).length > 0) {
              outText += '=== Files Created in Browser Storage ===\\n';
              const newFiles = [];
              for (const [fn, cnt] of Object.entries(res.writtenFiles)) {
                outText += '📁 ' + fn + ' (' + cnt.length + ' chars)\\n';
                newFiles.push({
                  name: fn,
                  content: cnt,
                  sizeBytes: cnt.length,
                  updatedAt: new Date().toISOString()
                });
              }
              cachedAgenticState.files = mergeNonDestructiveArrays(cachedAgenticState.files, newFiles, 'name');
              saveLocalAgenticCache();
              renderAgenticWorkspaceState();
            }
            outText += '=== Return Value ===\\n' + (typeof res.result === 'object' ? JSON.stringify(res.result, null, 2) : String(res.result));
            if (outContent) outContent.textContent = outText;
          } else {
            if (meta) {
              meta.style.color = '#ef4444';
              meta.textContent = '✗ Halted in browser (' + res.executionTimeMs + 'ms)';
            }
            if (outContent) outContent.textContent = res.error || 'Execution failed in browser sandbox.';
          }
          return;
        } catch (clientErr) {
          if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
          if (meta) { meta.style.color = '#ef4444'; meta.textContent = '✗ Client sandbox error'; }
          if (outContent) outContent.textContent = String(clientErr);
          return;
        }
      }

      // Pillar 2 & 4: LLM Cost Shield & Quota check for guests
      if (isGuest && taskPrompt) {
        if (guestRunsLeft <= 0) {
          if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
          if (meta) { meta.textContent = ''; }
          openSignupGateModal('AI Code Generator', 'You have used all 3 free trial runs for today. Create a free account in 10 seconds to unlock unlimited AI code generation, PostgreSQL cloud storage, and autonomous watchdogs.');
          return;
        }
      }

      try {
        const headers = { 'Content-Type': 'application/json' };
        try {
          const vault = await loadVaultKeys();
          if (vault && vault.aiMode !== 'shared') {
            if (vault.groq) headers['x-groq-key'] = vault.groq;
            if (vault.gemini) headers['x-gemini-key'] = vault.gemini;
          }
        } catch (e) {}

        const res = await fetch('/api/workspace/execute-code', {
          method: 'POST',
          headers: headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            code: codeVal || undefined,
            taskPrompt: taskPrompt || undefined,
            turnstileToken: window.guestTurnstileToken || undefined,
            timeoutMs: 5000,
          }),
        });
        const data = await res.json();
        if (data.trialExhausted) {
          if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
          openSignupGateModal('Trial Limit Reached', 'You have reached the free guest limit of 3 trial runs per 24 hours. Sign up for a free account to continue without restrictions.');
          return;
        }
        if (isGuest && data.success) {
          guestRunsLeft = Math.max(0, guestRunsLeft - 1);
          localStorage.setItem('shunops_guest_runs_left', String(guestRunsLeft));
          updateGuestRunsDisplay();
        }
        if (outBox) outBox.style.display = 'block';
        if (btn) {
          btn.disabled = false;
          btn.textContent = defaultBtnLabel;
        }

        if (data.generatedCode && codeInputEl) {
          codeInputEl.value = data.generatedCode;
        }

        if (Array.isArray(data.files)) {
          cachedAgenticState = {
            files: mergeNonDestructiveArrays(cachedAgenticState.files, data.files, 'name'),
            tasks: mergeNonDestructiveArrays(cachedAgenticState.tasks, data.tasks, 'id'),
            memories: mergeNonDestructiveArrays(cachedAgenticState.memories, data.memories, 'key'),
            schedules: mergeNonDestructiveArrays(cachedAgenticState.schedules, data.schedules, 'id'),
          };
          saveLocalAgenticCache();
          renderAgenticWorkspaceState();
        }

        if (data.success) {
          if (meta) {
            meta.style.color = '#10b981';
            meta.textContent = '✓ Executed in ' + data.executionTimeMs + 'ms (' + (data.engine || 'sandbox') + ')';
          }
          let outText = '';
          if (Array.isArray(data.savedFiles) && data.savedFiles.length > 0) {
            outText += '📁 Saved Workspace Files: ' + data.savedFiles.join(', ') + '\\n\\n';
            switchAgenticTab('files');
          }
          if (data.logs && data.logs.length > 0) {
            outText += 'Console Output:\\n' + data.logs.join('\\n') + '\\n\\n';
          }
          outText += 'Return Value:\\n' + (data.result !== null ? JSON.stringify(data.result, null, 2) : 'null');
          if (outContent) {
            outContent.style.color = '#38bdf8';
            outContent.textContent = outText;
          }
        } else {
          if (meta) {
            meta.style.color = '#f87171';
            meta.textContent = '✗ Failed (' + (data.executionTimeMs || 0) + 'ms)';
          }
          let errText = 'Error: ' + (data.error || 'Unknown failure') + '\\n';
          if (data.logs && data.logs.length > 0) {
            errText += '\\nConsole Logs:\\n' + data.logs.join('\\n');
          }
          if (outContent) {
            outContent.style.color = '#f87171';
            outContent.textContent = errText;
          }
        }
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = defaultBtnLabel;
        }
        if (meta) {
          meta.style.color = '#f87171';
          meta.textContent = 'Network error';
        }
        if (outBox) outBox.style.display = 'block';
        if (outContent) {
          outContent.style.color = '#f87171';
          outContent.textContent = 'Network error while reaching sandbox endpoint.';
        }
      }
    }

    async function executeWorkSandboxCode() {
      const input = document.getElementById('work-sandbox-code-input');
      const promptIn = document.getElementById('work-code-task-prompt');
      const codeVal = (input && input.value ? input.value.trim() : '');
      const taskVal = (promptIn && promptIn.value ? promptIn.value.trim() : '');
      if (!codeVal && !taskVal) {
        alert('Type a task in the AI bar above or enter custom JavaScript code to execute.');
        return;
      }
      await runSandboxExecutionHelper({
        codeVal: codeVal,
        taskPrompt: !codeVal ? taskVal : undefined,
        codeInputEl: input,
        outBox: document.getElementById('work-sandbox-output-box'),
        outContent: document.getElementById('work-sandbox-output-content'),
        meta: document.getElementById('work-sandbox-run-meta'),
        btn: document.getElementById('work-sandbox-exec-btn'),
        defaultBtnLabel: '▶ Execute Custom Code',
      });
    }

    async function runAiCodeTaskFromWork() {
      const promptIn = document.getElementById('work-code-task-prompt');
      const input = document.getElementById('work-sandbox-code-input');
      const taskVal = (promptIn && promptIn.value ? promptIn.value.trim() : '');
      if (!taskVal) {
        alert('Describe the task you want AI to write and execute in the sandbox.');
        return;
      }
      await runSandboxExecutionHelper({
        codeVal: undefined,
        taskPrompt: taskVal,
        codeInputEl: input,
        outBox: document.getElementById('work-sandbox-output-box'),
        outContent: document.getElementById('work-sandbox-output-content'),
        meta: document.getElementById('work-sandbox-run-meta'),
        btn: document.getElementById('work-ai-code-btn'),
        defaultBtnLabel: '✨ AI Generate & Run',
      });
    }

    async function runAiCodeTaskFromModal() {
      const promptIn = document.getElementById('modal-code-task-prompt');
      const input = document.getElementById('sandbox-code-input');
      const taskVal = (promptIn && promptIn.value ? promptIn.value.trim() : '');
      if (!taskVal) {
        alert('Describe the task you want AI to write and execute.');
        return;
      }
      await runSandboxExecutionHelper({
        codeVal: undefined,
        taskPrompt: taskVal,
        codeInputEl: input,
        outBox: document.getElementById('sandbox-output-box'),
        outContent: document.getElementById('sandbox-output-content'),
        meta: document.getElementById('sandbox-run-meta'),
        btn: document.getElementById('modal-ai-code-btn'),
        defaultBtnLabel: '✨ AI Write & Run',
      });
    }

    async function executeSandboxCodeFromModal() {
      const input = document.getElementById('sandbox-code-input');
      const promptIn = document.getElementById('modal-code-task-prompt');
      const codeVal = (input && input.value ? input.value.trim() : '');
      const taskVal = (promptIn && promptIn.value ? promptIn.value.trim() : '');
      if (!codeVal && !taskVal) {
        alert('Enter JavaScript code or a task description to execute.');
        return;
      }
      await runSandboxExecutionHelper({
        codeVal: codeVal,
        taskPrompt: !codeVal ? taskVal : undefined,
        codeInputEl: input,
        outBox: document.getElementById('sandbox-output-box'),
        outContent: document.getElementById('sandbox-output-content'),
        meta: document.getElementById('sandbox-run-meta'),
        btn: document.getElementById('sandbox-exec-btn'),
        defaultBtnLabel: '▶ Execute Code',
      });
    }


    async function addManualAgentSchedule() {
      if (isGuest) {
        openSignupGateModal('Autonomous Watchdog Schedules', 'Watchdogs run 24/7 background monitors on cloud infrastructure. Sign up for a free account in 10 seconds to schedule watchdogs.');
        return;
      }
      const nameIn = document.getElementById('agentic-sched-name-input');
      const targetIn = document.getElementById('agentic-sched-target-input');
      if (!nameIn || !targetIn) return;
      const name = (nameIn.value || '').trim();
      const target = (targetIn.value || '').trim();
      if (!target) return;
      nameIn.value = '';
      targetIn.value = '';
      const isUrl = /^https?:\/\//i.test(target);
      try {
        const res = await fetch('/api/workspace/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            operation: 'create_schedule',
            name: name || (isUrl ? 'Website Monitor' : 'Research Digest'),
            actionType: isUrl ? 'website_monitor' : 'web_research_digest',
            targetUrl: isUrl ? target : undefined,
            query: !isUrl ? target : undefined,
            intervalMinutes: 30,
          }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.schedules = data.schedules || [];
          cachedAgenticState.files = data.files || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function runAgentScheduleNow(scheduleId) {
      try {
        const res = await fetch('/api/workspace/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'run_now', scheduleId: scheduleId }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.schedules = data.schedules || [];
          cachedAgenticState.files = data.files || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function toggleAgentScheduleEnabled(scheduleId, enable) {
      try {
        const res = await fetch('/api/workspace/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: enable ? 'resume_schedule' : 'pause_schedule', scheduleId: scheduleId }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.schedules = data.schedules || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    async function deleteAgentSchedule(scheduleId) {
      try {
        const res = await fetch('/api/workspace/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operation: 'delete_schedule', scheduleId: scheduleId }),
        });
        const data = await res.json();
        if (data && data.success) {
          cachedAgenticState.schedules = data.schedules || [];
          renderAgenticWorkspaceState();
        }
      } catch (e) {}
    }

    function openSwarmLauncherModal() {
      const modal = document.getElementById('swarm-launcher-modal');
      if (modal) modal.classList.add('active');
    }

    function closeSwarmLauncherModal() {
      const modal = document.getElementById('swarm-launcher-modal');
      if (modal) modal.classList.remove('active');
    }

    async function dispatchSwarmCommon(ids) {
      const objIn = document.getElementById(ids.objId);
      const modeSel = document.getElementById(ids.modeId);
      const fileIn = document.getElementById(ids.fileId);
      const btn = document.getElementById(ids.btnId);
      const meta = document.getElementById(ids.metaId);
      const box = document.getElementById(ids.boxId);
      if (!objIn || !box) return;

      if (isGuest) {
        openSignupGateModal('Multi-Agent Swarm Orchestrator', 'Autonomous Swarm Teams dispatch parallel Researcher, Coder, Analyst, and Auditor agents. Sign up for a free account to run Swarm teams.');
        return;
      }
      const objective = (objIn.value || '').trim();
      if (!objective) {
        alert('Please enter a Swarm Objective.');
        return;
      }
      const mode = (modeSel && modeSel.value) || 'hybrid_dag';
      const saveDeliverableAs = (fileIn && fileIn.value ? fileIn.value.trim() : 'swarm-report.md');

      if (btn) {
        btn.disabled = true;
        btn.textContent = '🐝 Running Swarm...';
      }
      if (meta) meta.textContent = 'Executing 4 specialized sub-agents...';
      box.style.display = 'block';
      box.innerHTML = '<div style="color:#94a3b8;">⏳ Dispatching Researcher, Coder, Analyst &amp; Auditor on Shared Blackboard...</div>';

      try {
        const res = await fetch('/api/workspace/swarm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            objective: objective,
            mode: mode,
            saveDeliverableAs: saveDeliverableAs || undefined,
            agents: [
              { role: 'researcher', task: 'Search live web documentation and best practices for: ' + objective, searchQuery: objective },
              { role: 'coder', task: 'Write and execute a runnable JavaScript benchmark or quantitative verification script in the sandbox for: ' + objective },
              { role: 'analyst', task: 'Synthesize Researcher & Coder findings into a structured architectural comparison for: ' + objective },
              { role: 'auditor', task: 'Audit the proposed architecture and code for security, reliability, and edge-case risks for: ' + objective }
            ]
          })
        });
        const data = await res.json();
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🐝 Dispatch 4-Agent Swarm';
        }
        if (data && data.success && data.swarm) {
          const sw = data.swarm;
          if (meta) {
            meta.textContent = '✓ Consensus: ' + (sw.consensusScore || 95) + '% • ' + sw.totalDurationMs + 'ms' + (sw.savedDeliverableFile ? (' -> ' + sw.savedDeliverableFile) : '');
          }
          box.innerHTML = (sw.blackboard || []).map(function(b) {
            return '<div style="background:#090d16; border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 10px; margin-bottom:8px;">'
              + '<div style="display:flex; justify-content:space-between; color:#c084fc; font-weight:700; font-size:11.5px; margin-bottom:4px;">'
              + '<span>🐝 ' + escapeHtmlText(b.role.toUpperCase()) + ' (Wave ' + (b.wave || 1) + ' • ' + escapeHtmlText(b.status || 'VERIFIED') + ')</span>'
              + '<span>' + b.durationMs + 'ms</span>'
              + '</div>'
              + (b.toolExecuted ? ('<div style="font-size:10.5px; color:#38bdf8; font-family:monospace; margin-bottom:4px;">Tool: ' + escapeHtmlText(b.toolExecuted) + '</div>') : '')
              + '<div style="color:#e2e8f0; font-size:11.5px; line-height:1.45;">' + renderSafeMarkdown(b.findings) + '</div>'
              + '</div>';
          }).join('');

          cachedAgenticState = {
            files: mergeNonDestructiveArrays(cachedAgenticState.files, data.files, 'name'),
            tasks: mergeNonDestructiveArrays(cachedAgenticState.tasks, data.tasks, 'id'),
            memories: mergeNonDestructiveArrays(cachedAgenticState.memories, data.memories, 'key'),
            schedules: mergeNonDestructiveArrays(cachedAgenticState.schedules, data.schedules, 'id'),
          };
          saveLocalAgenticCache();
          renderAgenticWorkspaceState();
          if (sw.savedDeliverableFile) {
            switchAgenticTab('files');
          }
        } else {
          if (meta) meta.textContent = '✗ Swarm failed';
          box.innerHTML = '<div style="color:#f87171;">' + escapeHtmlText((data && data.error) || 'Swarm execution failed.') + '</div>';
        }
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🐝 Dispatch 4-Agent Swarm';
        }
        if (meta) meta.textContent = 'Network error';
        box.innerHTML = '<div style="color:#f87171;">Network error while running swarm.</div>';
      }
    }

    async function dispatchSwarmFromModal() {
      await dispatchSwarmCommon({
        objId: 'swarm-objective-input',
        modeId: 'swarm-mode-select',
        fileId: 'swarm-deliverable-input',
        btnId: 'swarm-dispatch-btn',
        metaId: 'swarm-run-meta',
        boxId: 'swarm-blackboard-box',
      });
    }

    async function dispatchSwarmFromWork() {
      await dispatchSwarmCommon({
        objId: 'work-swarm-objective-input',
        modeId: 'work-swarm-mode-select',
        fileId: 'work-swarm-deliverable-input',
        btnId: 'work-swarm-dispatch-btn',
        metaId: 'work-swarm-run-meta',
        boxId: 'work-swarm-blackboard-box',
      });
    }

    window.addEventListener('DOMContentLoaded', () => {
      // Restore user preferred model
      try {
        const savedModel = localStorage.getItem('shunops_preferred_model');
        const chatSelect = document.getElementById('chat-model-select');
        const navSelect = document.getElementById('navbar-model-select');
        if (savedModel) {
          if (chatSelect) chatSelect.value = savedModel;
          if (navSelect) navSelect.value = savedModel;
          onModelPreferenceChange();
        }
      } catch (e) {}

      restoreLocalAgenticCache();
      renderAgenticWorkspaceState();
      loadSavedChatHistory();
      loadConversationsList();
      loadAgenticWorkspaceState(false);
      fetchWorkspaceApprovals();
      fetchBillingUsage();
      loadApiKeys();
      fetchModelStatus();
      loadPlatformCredentials();
      loadWorkspaceTasks(true);
      // Energy-Efficient Visibility-Aware & Idle-Backoff Poller (pauses when tab is hidden)
      let approvalPollTimer = null;
      function scheduleNextApprovalPoll() {
        if (approvalPollTimer) clearTimeout(approvalPollTimer);
        if (document.hidden) return;
        const isBusy = Boolean(currentChatAbortController);
        const box = document.getElementById('workspace-approvals-box');
        const hasPending = Boolean(box && box.style.display !== 'none');
        const nextDelayMs = (isBusy || hasPending) ? 3500 : 15000;
        approvalPollTimer = setTimeout(async function() {
          if (!document.hidden) {
            await fetchWorkspaceApprovals();
          }
          scheduleNextApprovalPoll();
        }, nextDelayMs);
      }
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
          fetchWorkspaceApprovals();
          loadAgenticWorkspaceState();
          scheduleNextApprovalPoll();
        } else if (approvalPollTimer) {
          clearTimeout(approvalPollTimer);
          approvalPollTimer = null;
        }
      });
      scheduleNextApprovalPoll();
    });`;
}
