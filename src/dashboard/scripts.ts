/**
 * Client-side JavaScript for the ShunopsAI Command Center dashboard.
 *
 * Kept as a plain string (not a separate asset) so the dashboard stays a
 * zero-build, single-response HTML page.
 */
export const DASHBOARD_SCRIPTS = `
    function getAuthHeaders() {
      const headers = { "Content-Type": "application/json" };
      const savedKey = localStorage.getItem("shunops_api_key");
      if (savedKey) headers["Authorization"] = "Bearer " + savedKey;
      return headers;
    }

    async function refreshSentinel() {
      const grid = document.getElementById("services-grid");
      grid.innerHTML = '<div style="padding: 20px; color: #67e8f9; font-family: var(--code-font); grid-column: 1 / -1;">Running live Sentinel scan across all cloud providers...</div>';

      try {
        const res = await fetch("/api/sentinel/status", { credentials: "same-origin", headers: getAuthHeaders() });
        const data = await res.json();
        renderServices(data);
      } catch (e) {
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444; grid-column: 1 / -1;">Failed to fetch Sentinel report: ' + e.message + '</div>';
      }
    }

    function renderServices(summary) {
      const grid = document.getElementById("services-grid");
      if (!summary || !summary.services) return;

      const badgeMap = {
        healthy: '<span class="sc-badge badge-ok">HEALTHY</span>',
        degraded: '<span class="sc-badge badge-deg">DEGRADED</span>',
        down: '<span class="sc-badge badge-down">DOWN</span>',
        unconfigured: '<span class="sc-badge">UNCONFIGURED</span>'
      };

      grid.innerHTML = summary.services.map(s => \`
        <div class="service-card">
          <div>
            <div class="sc-header">
              <div class="sc-title">\${escapeHtml(String(s.service))}</div>
              \${badgeMap[s.status] || badgeMap.healthy}
            </div>
            <div class="sc-metric">\${s.latencyMs !== undefined ? s.latencyMs + 'ms' : 'Active'}</div>
          </div>
          <div class="sc-body">
            <div>Category: \${escapeHtml(String(s.category || '').toUpperCase())}</div>
            <div style="font-size: 11px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              \${s.error ? '<span style="color:#ef4444">' + escapeHtml(String(s.error)) + '</span>' : escapeHtml(JSON.stringify(s.details || {}))}
            </div>
          </div>
        </div>
      \`).join("");

      const statusEl = document.getElementById("overall-status");
      // Always render the live counts so the header cannot claim a fleet size
      // that does not match the services actually being monitored.
      const tallied = summary.healthyCount + "/" + summary.totalServices;
      if (summary.overallStatus === "all_systems_operational") {
        statusEl.innerText = "ALL SYSTEMS NOMINAL (" + tallied + ")";
        statusEl.style.color = "var(--green)";
      } else {
        statusEl.innerText = summary.overallStatus.toUpperCase() + " (" + tallied + ")";
        statusEl.style.color = "var(--yellow)";
      }
    }

    async function runHeal() {
      appendMsg("Auto-Healing triggered across degraded cloud services...", "user");
      try {
        const res = await fetch("/api/sentinel/heal", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin",
          body: JSON.stringify({ serviceName: "all" })
        });
        const data = await res.json();
        appendMsg("ShunopsAI Auto-Healing Result: " + JSON.stringify(data, null, 2), "agent");
        refreshSentinel();
      } catch (e) {
        appendMsg("Auto-healing error: " + e.message, "agent");
      }
    }

    function insertPrompt(p) {
      document.getElementById("prompt-input").value = p;
      document.getElementById("prompt-input").focus();
    }

    function appendMsg(text, sender) {
      const box = document.getElementById("chat-stream");
      const div = document.createElement("div");
      div.className = "chat-bubble " + (sender === "user" ? "chat-user" : "chat-agent");

      if (sender === "agent" && (text.includes("---") || text.includes("{") || text.includes("|"))) {
        div.innerHTML = "<strong>ShunopsAI:</strong><pre>" + escapeHtml(text) + "</pre>";
      } else {
        div.innerHTML = (sender === "user" ? "<strong>You: </strong>" : "<strong>ShunopsAI: </strong>") + escapeHtml(text);
      }
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    async function handleSend(e) {
      e.preventDefault();
      const input = document.getElementById("prompt-input");
      const btn = document.getElementById("send-btn");
      const task = input.value.trim();
      if (!task) return;

      appendMsg(task, "user");
      input.value = "";
      btn.disabled = true;
      btn.innerText = "Thinking...";

      try {
        const res = await fetch("/api/task", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin",
          body: JSON.stringify({ goal: task, maxSteps: 8 })
        });
        const data = await res.json();
        if (data.finalAnswer) {
          appendMsg(data.finalAnswer, "agent");
        } else {
          appendMsg(JSON.stringify(data, null, 2), "agent");
        }
      } catch (err) {
        appendMsg("Execution error: " + err.message, "agent");
      } finally {
        btn.disabled = false;
        btn.innerText = "Dispatch";
      }
    }

    // --- Autonomy Master Killswitch ---
    async function checkAutonomyStatus() {
      try {
        const res = await fetch("/api/autonomy/status", {
          headers: getAuthHeaders(),
          credentials: "same-origin"
        });
        if (!res.ok) return;
        const data = await res.json();
        updateAutonomyUI(data.paused);
      } catch (e) {}
    }

    function updateAutonomyUI(isPaused) {
      const btn = document.getElementById("btn-toggle-autonomy");
      const icon = document.getElementById("autonomy-btn-icon");
      const text = document.getElementById("autonomy-btn-text");
      const banner = document.getElementById("autonomy-paused-banner");
      const statusPill = document.getElementById("overall-status");

      if (isPaused) {
        if (banner) banner.style.display = "flex";
        if (btn) {
          btn.className = "btn btn-success";
          btn.title = "Click to resume all background tasks and AI operations";
        }
        if (icon) icon.innerText = "▶️";
        if (text) text.innerText = "Resume Autonomy";
        if (statusPill) {
          statusPill.innerText = "AUTONOMY PAUSED";
          statusPill.style.color = "#f87171";
        }
      } else {
        if (banner) banner.style.display = "none";
        if (btn) {
          btn.className = "btn btn-danger";
          btn.title = "Click to pause all scheduled crons, repo healing, and background AI";
        }
        if (icon) icon.innerText = "⏸️";
        if (text) text.innerText = "Pause Autonomy";
        if (statusPill && statusPill.innerText === "AUTONOMY PAUSED") {
          statusPill.innerText = "SENTINEL ACTIVE";
          statusPill.style.color = "";
        }
      }
    }

    async function toggleAutonomyPause() {
      const isCurrentlyPaused = document.getElementById("autonomy-paused-banner")?.style.display === "flex";
      const actionWord = isCurrentlyPaused ? "RESUME" : "PAUSE";
      const confirmed = confirm(
        isCurrentlyPaused
          ? "Resume all automatic background tasks, scheduled crons, and AI operations?"
          : "⚠️ Are you sure you want to PAUSE all automatic background tasks, scheduled crons, and AI operations?"
      );
      if (!confirmed) return;

      const btn = document.getElementById("btn-toggle-autonomy");
      if (btn) btn.disabled = true;

      try {
        const res = await fetch("/api/autonomy/toggle", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin",
          body: JSON.stringify({ reason: "User toggled via Command Center" })
        });
        const data = await res.json();
        if (data.success) {
          updateAutonomyUI(data.paused);
          appendMsg(data.message, "agent");
        } else {
          alert("Error: " + (data.error || "Could not toggle autonomy state."));
        }
      } catch (err) {
        alert("Failed to communicate with autonomy endpoint: " + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // Auto-load on startup
    window.addEventListener("DOMContentLoaded", () => {
      refreshSentinel();
      checkAutonomyStatus();
      setInterval(checkAutonomyStatus, 10000);
    });
  `;
