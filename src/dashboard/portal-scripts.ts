/**
 * Client-side JavaScript for the Assistant & Integrations settings portal
 * (`portal.ts`). Kept as a plain string so the page stays a zero-build,
 * single-response HTML document.
 */
export const PORTAL_SCRIPTS = `    // State
    let aiMode = "shared"; // "shared" | "byok"
    const activeServices = {
      video: true,
      sentinel: true,
      github: false,
      widget: true
    };

    function setAiMode(mode) {
      aiMode = mode;
      const radioShared = document.getElementById("radio-shared");
      const radioByok = document.getElementById("radio-byok");
      const modeShared = document.getElementById("mode-shared");
      const modeByok = document.getElementById("mode-byok");

      if (mode === "byok") {
        if (radioByok) radioByok.checked = true;
        if (radioShared) radioShared.checked = false;
        if (modeByok) {
          modeByok.style.borderColor = "#00f0ff";
          modeByok.style.boxShadow = "0 0 12px rgba(0, 240, 255, 0.2)";
        }
        if (modeShared) {
          modeShared.style.borderColor = "#1e293b";
          modeShared.style.boxShadow = "none";
        }
      } else {
        if (radioShared) radioShared.checked = true;
        if (radioByok) radioByok.checked = false;
        if (modeShared) {
          modeShared.style.borderColor = "#00f0ff";
          modeShared.style.boxShadow = "0 0 12px rgba(0, 240, 255, 0.2)";
        }
        if (modeByok) {
          modeByok.style.borderColor = "#1e293b";
          modeByok.style.boxShadow = "none";
        }
      }
      applySectionVisibility();
    }

    const DB_NAME = "shunops_secure_vault_v3";
    const DB_VERSION = 1;
    const STORE_NAME = "keys_store";

    function openVaultDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function getOrCreateNonExtractableKey(db) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get("non_extractable_master_key");

        getReq.onsuccess = async () => {
          if (getReq.result) {
            resolve(getReq.result);
          } else {
            try {
              const newKey = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
              );
              const putTx = db.transaction(STORE_NAME, "readwrite");
              const putStore = putTx.objectStore(STORE_NAME);
              putStore.put(newKey, "non_extractable_master_key");
              putTx.oncomplete = () => resolve(newKey);
              putTx.onerror = () => reject(putTx.error);
            } catch (err) {
              reject(err);
            }
          }
        };
        getReq.onerror = () => reject(getReq.error);
      });
    }

    async function storeEncryptedInIndexedDB(keysObj) {
      const db = await openVaultDB();
      const cryptoKey = await getOrCreateNonExtractableKey(db);

      const enc = new TextEncoder();
      const encodedBytes = enc.encode(JSON.stringify(keysObj));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        encodedBytes
      );

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({ iv, ciphertext, updatedAt: new Date().toISOString() }, "encrypted_payload");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function loadEncryptedFromIndexedDB() {
      try {
        const db = await openVaultDB();
        const cryptoKey = await getOrCreateNonExtractableKey(db);

        const record = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get("encrypted_payload");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        if (!record || !record.iv || !record.ciphertext) return null;

        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv },
          cryptoKey,
          record.ciphertext
        );

        const dec = new TextDecoder();
        return JSON.parse(dec.decode(decryptedBuffer));
      } catch (err) {
        return null;
      }
    }

    async function purgeIndexedDB() {
      try {
        const db = await openVaultDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        await new Promise((res) => { tx.oncomplete = res; });
      } catch (e) {}
    }

    const SVG_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const SVG_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    function toggleMask(inputId, btn) {
      const el = document.getElementById(inputId);
      if (!el) return;
      if (el.type === "password") {
        el.type = "text";
        btn.innerHTML = SVG_EYE_OPEN;
        btn.title = "Hide";
      } else {
        el.type = "password";
        btn.innerHTML = SVG_EYE_OFF;
        btn.title = "Show";
      }
    }

    function openSecurityModal() {
      document.getElementById("security-modal").style.display = "flex";
    }

    function closeSecurityModal() {
      document.getElementById("security-modal").style.display = "none";
    }

    function closeSecurityModalOnBackdrop(e) {
      if (e.target.id === "security-modal") {
        closeSecurityModal();
      }
    }

    function showStatusMessage(text, isError) {
      const status = document.getElementById("save-status");
      if (!status) return;
      status.textContent = text;
      status.style.color = isError ? "#ef4444" : "#10b981";
      status.style.fontWeight = "600";
      setTimeout(() => { status.textContent = ""; }, 5000);
    }

    function setBadge(containerId, isValid, message) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.textContent = "";
      if (!message) return;
      const span = document.createElement("span");
      span.className = "verify-badge " + (isValid ? "success" : "error");
      span.textContent = (isValid ? "✅ " : "❌ ") + message;
      el.appendChild(span);
    }

    function clearAllBadges() {
      ["status-badge-groq", "status-badge-gemini", "status-badge-github", "status-badge-hf", "status-badge-gcp"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      });
    }

    
    function copyWidgetSnippet(btn) {
      const code = '<' + 'script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" data-api-url="https://edge-agent-widget.shunopsai.workers.dev" defer><' + '/script>';
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        const label = btn.querySelector('.btn-label');
        const origHtml = btn.innerHTML;
        btn.classList.add('copied');
        if (label) {
          label.textContent = 'Copied!';
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
        prompt('Copy this embed code:', code);
      });
    }

    function applySectionVisibility() {
      document.getElementById("section-ai-keys").style.display =
        (aiMode === "byok") ? "block" : "none";
      document.getElementById("section-video-keys").style.display =
        activeServices.video ? "block" : "none";
      document.getElementById("section-github-keys").style.display =
        activeServices.github ? "block" : "none";
      document.getElementById("section-sentinel-keys").style.display =
        activeServices.sentinel ? "block" : "none";
      const widgetSection = document.getElementById("section-widget-keys");
      if (widgetSection) widgetSection.style.display = activeServices.widget ? "block" : "none";
    }

    function toggleService(key) {
      if (!(key in activeServices)) return;
      activeServices[key] = !activeServices[key];
      const card = document.getElementById("card-" + key);
      const chk = document.getElementById("chk-" + key);
      
      if (card && chk) {
        if (activeServices[key]) {
          card.classList.add("selected");
          chk.textContent = "✓";
        } else {
          card.classList.remove("selected");
          chk.textContent = "";
        }
      }

      applySectionVisibility();
    }

    async function saveAndTestKeys() {
      const btn1 = document.getElementById("btn-save-test");
      const btn2 = document.getElementById("btn-save-test-bottom");
      if (btn1) btn1.textContent = "⏳ Testing Connection...";
      if (btn2) btn2.textContent = "⏳ Testing Connection...";

      clearAllBadges();

      const groq = document.getElementById("input-groq-key").value.trim();
      const gemini = document.getElementById("input-gemini-key").value.trim();
      const kaggleUser = document.getElementById("input-kaggle-user").value.trim();
      const kaggleKey = document.getElementById("input-kaggle-key").value.trim();
      const hf = document.getElementById("input-hf-token").value.trim();
      const gcp = (document.getElementById("input-gcp-key")?.value || "").trim();
      const github = document.getElementById("input-github-token").value.trim();
      const monitorUrl = document.getElementById("input-monitor-url").value.trim();

      const keys = {
        aiMode,
        groq,
        gemini,
        kaggleUser,
        kaggleKey,
        hf,
        gcp,
        github,
        monitorUrl,
        services: activeServices
      };

      try {
        const res = await fetch("/api/portal/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groq, gemini, github, hf, gcp }),
        });

        if (res.ok) {
          const data = await res.json();
          const results = data.results || {};
          let allPassed = true;

          if (groq && results.groq) {
            setBadge("status-badge-groq", results.groq.valid, results.groq.message);
            if (!results.groq.valid) allPassed = false;
          }
          if (gemini && results.gemini) {
            setBadge("status-badge-gemini", results.gemini.valid, results.gemini.message);
            if (!results.gemini.valid) allPassed = false;
          }
          if (github && results.github) {
            setBadge("status-badge-github", results.github.valid, results.github.message);
            if (!results.github.valid) allPassed = false;
          }
          if (hf && results.hf) {
            setBadge("status-badge-hf", results.hf.valid, results.hf.message);
            if (!results.hf.valid) allPassed = false;
          }
          if (gcp && results.gcp) {
            setBadge("status-badge-gcp", results.gcp.valid, results.gcp.message);
            if (!results.gcp.valid) allPassed = false;
          }

          await storeEncryptedInIndexedDB(keys);
          localStorage.removeItem("shunops_byok_keys");
          localStorage.removeItem("shunops_secure_vault_v2");

          // Synchronize platform-level keys (GitHub & GCP) to the user's server-side encrypted Platform Vault
          // so connected keys in /portal are immediately active for agent runs in /workspace.
          if (github && (!results.github || results.github.valid)) {
            fetch("/api/user/platform-credentials", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ platform: "github", values: { token: github } }),
            }).catch(() => {});
          }
          if (gcp && (!results.gcp || results.gcp.valid)) {
            let gcpProjectId = "default-project";
            try {
              const parsedGcp = JSON.parse(gcp);
              if (parsedGcp && parsedGcp.project_id) gcpProjectId = parsedGcp.project_id;
            } catch {}
            fetch("/api/user/platform-credentials", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ platform: "gcp", values: { projectId: gcpProjectId, token: gcp } }),
            }).catch(() => {});
          }

          if (allPassed) {
            showStatusMessage("✅ Connected! All keys verified and saved privately.", false);
          } else {
            showStatusMessage("⚠️ Saved, but please check the badges above.", true);
          }
        } else {
          await storeEncryptedInIndexedDB(keys);
          showStatusMessage("✅ Saved privately in your browser.", false);
        }
      } catch (err) {
        await storeEncryptedInIndexedDB(keys).catch(() => {});
        showStatusMessage("✅ Saved privately in your browser.", false);
      } finally {
        if (btn1) btn1.textContent = "💾 Save & Connect";
        if (btn2) btn2.textContent = "💾 Save & Connect";
      }
    }

    async function loadSavedKeys() {
      try {
        let keys = await loadEncryptedFromIndexedDB();
        if (!keys) {
          const raw = localStorage.getItem("shunops_byok_keys");
          if (raw) {
            try {
              keys = JSON.parse(raw);
              await storeEncryptedInIndexedDB(keys);
              localStorage.removeItem("shunops_byok_keys");
            } catch (e) {}
          }
        }

        if (!keys) return;
        if (keys.groq) document.getElementById("input-groq-key").value = keys.groq;
        if (keys.gemini) document.getElementById("input-gemini-key").value = keys.gemini;
        if (keys.kaggleUser) document.getElementById("input-kaggle-user").value = keys.kaggleUser;
        if (keys.kaggleKey) document.getElementById("input-kaggle-key").value = keys.kaggleKey;
        if (keys.hf) document.getElementById("input-hf-token").value = keys.hf;
        if (keys.gcp && document.getElementById("input-gcp-key")) document.getElementById("input-gcp-key").value = keys.gcp;
        if (keys.github) document.getElementById("input-github-token").value = keys.github;
        if (keys.monitorUrl) document.getElementById("input-monitor-url").value = keys.monitorUrl;
        
        if (keys.services) {
          for (const s of Object.keys(keys.services)) {
            if (s in activeServices && activeServices[s] !== keys.services[s]) {
              toggleService(s);
            }
          }
        }

        if (keys.aiMode) {
          setAiMode(keys.aiMode);
        } else if (keys.groq || keys.gemini) {
          setAiMode("byok");
        } else {
          setAiMode("shared");
        }
      } catch (e) {
        // Silently ignore load errors
      }
    }

    async function clearAllKeys() {
      if (!confirm("Are you sure you want to remove your saved keys from this browser?")) {
        return;
      }
      await purgeIndexedDB();
      localStorage.removeItem("shunops_byok_keys");
      localStorage.removeItem("shunops_secure_vault_v2");

      document.getElementById("input-groq-key").value = "";
      document.getElementById("input-gemini-key").value = "";
      document.getElementById("input-kaggle-user").value = "";
      document.getElementById("input-kaggle-key").value = "";
      document.getElementById("input-hf-token").value = "";
      if (document.getElementById("input-gcp-key")) document.getElementById("input-gcp-key").value = "";
      document.getElementById("input-github-token").value = "";
      document.getElementById("input-monitor-url").value = "";

      clearAllBadges();
      showStatusMessage("🗑️ All saved keys cleared from your browser.", true);
    }

    window.addEventListener("DOMContentLoaded", () => {
      applySectionVisibility();
      loadSavedKeys();
    });`;
