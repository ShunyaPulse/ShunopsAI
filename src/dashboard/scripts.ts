/**
 * Server-side HTML escaper for untrusted values rendered into page markup.
 *
 * This is the Node counterpart of the `escapeHtml` helper embedded in
 * {@link DASHBOARD_SCRIPTS} below. Interpolate untrusted input (usernames,
 * provider labels, etc.) through this before placing it into server-generated
 * HTML to prevent stored/reflected XSS.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444; grid-column: 1 / -1;">Failed to fetch Sentinel report: ' + escapeHtml(String(e && e.message ? e.message : e)) + '</div>';
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
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

    // --- Human-in-the-Loop Approvals Queue ---
    async function fetchPendingApprovals() {
      const container = document.getElementById("approvals-list");
      if (!container) return;

      try {
        const res = await fetch("/api/pending-approvals", {
          headers: getAuthHeaders(),
          credentials: "same-origin"
        });
        if (!res.ok) return;
        const data = await res.json();
        const pending = data.pending || [];

        if (pending.length === 0) {
          container.innerHTML = '<div style="font-family: var(--code-font); color: var(--text-muted);">No pending sensitive actions awaiting approval.</div>';
          return;
        }

        container.innerHTML = pending.map(req => \`
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 6px;">
              <div>
                <strong style="color: #f87171; font-size: 14px;">⚠️ \${escapeHtml(req.action)}</strong>
                <div style="font-size: 12px; color: #cbd5e1; margin-top: 2px;">\${escapeHtml(req.riskReason)}</div>
              </div>
              <span style="font-size: 10px; font-family: var(--code-font); color: var(--text-muted);">\${escapeHtml(req.id)}</span>
            </div>
            <pre style="background: rgba(0,0,0,0.4); padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 8px 0; color: #f1f5f9;">\${escapeHtml(req.commandOrPayload)}</pre>
            <div style="display:flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
              <button class="btn btn-danger" style="padding: 4px 14px; font-size: 11px;" data-req-id="\${escapeHtml(req.id)}" onclick="resolveActionApproval(this.dataset.reqId, false)">❌ Reject</button>
              <button class="btn btn-success" style="padding: 4px 14px; font-size: 11px;" data-req-id="\${escapeHtml(req.id)}" onclick="resolveActionApproval(this.dataset.reqId, true)">✅ Approve</button>
            </div>
          </div>
        \`).join("");
      } catch (err) {}
    }

    async function resolveActionApproval(id, approved) {
      try {
        const res = await fetch("/api/approve", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin",
          body: JSON.stringify({ id, approved })
        });
        const data = await res.json();
        alert(data.message || (approved ? "Approved!" : "Rejected!"));
        fetchPendingApprovals();
      } catch (err) {
        alert("Failed to submit approval verdict: " + err.message);
      }
    }

    // --- Admin User Governance & Multi-Tenancy ---
    async function fetchAdminUsers() {
      const container = document.getElementById("users-table-container");
      if (!container) return;

      try {
        // Fetch stats
        const statsRes = await fetch("/api/admin/stats", { headers: getAuthHeaders(), credentials: "same-origin" });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (statsData.stats) {
            document.getElementById("stat-total-users").innerText = statsData.stats.totalUsers || 0;
            document.getElementById("stat-total-tasks").innerText = statsData.stats.totalTasks || 0;
            document.getElementById("stat-total-msgs").innerText = statsData.stats.totalChatMessages || 0;
          }
        }

        // Fetch users
        const usersRes = await fetch("/api/admin/users?limit=50", { headers: getAuthHeaders(), credentials: "same-origin" });
        if (!usersRes.ok) return;
        const usersData = await usersRes.json();
        const users = usersData.users || [];

        if (users.length === 0) {
          container.innerHTML = '<div style="font-family: var(--code-font); color: var(--text-muted);">No registered users found.</div>';
          return;
        }

        container.innerHTML = \`
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: var(--code-font);">
            <thead>
              <tr style="border-bottom: 1px solid var(--border); color: var(--text-muted); text-align: left;">
                <th style="padding: 8px 6px;">ID</th>
                <th style="padding: 8px 6px;">Username</th>
                <th style="padding: 8px 6px;">Email</th>
                <th style="padding: 8px 6px;">Role</th>
                <th style="padding: 8px 6px;">Plan</th>
                <th style="padding: 8px 6px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              \${users.map(u => \`
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 8px 6px; color: var(--text-muted);">\${Number(u.id) || 0}</td>
                  <td style="padding: 8px 6px; font-weight: 600; color: #fff;">\${escapeHtml(u.username)}</td>
                  <td style="padding: 8px 6px; color: var(--text-muted);">\${escapeHtml(u.email || 'N/A')}</td>
                  <td style="padding: 8px 6px;">
                    <span style="padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; background: \${u.role === 'admin' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)'}; color: \${u.role === 'admin' ? '#38bdf8' : '#94a3b8'};">
                      \${escapeHtml(u.role.toUpperCase())}
                    </span>
                  </td>
                  <td style="padding: 8px 6px; color: #10b981;">\${escapeHtml((u.plan || 'community').toUpperCase())}</td>
                  <td style="padding: 8px 6px; text-align: right;">
                    <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px; margin-right: 4px;" onclick="changeUserRole(\${Number(u.id) || 0}, '\${u.role === 'admin' ? 'user' : 'admin'}')">
                      \${u.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                    <button class="btn btn-danger" style="padding: 2px 8px; font-size: 10px;" onclick="revokeUserSessions(\${Number(u.id) || 0})">
                      Revoke
                    </button>
                  </td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      } catch (err) {
        container.innerHTML = '<div style="color: #ef4444;">Failed to load users: ' + escapeHtml(err.message) + '</div>';
      }
    }

    async function changeUserRole(userId, newRole) {
      if (!confirm("Change user role to '" + newRole + "'?")) return;
      try {
        const res = await fetch("/api/admin/users/" + userId + "/role", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin",
          body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (data.success) {
          fetchAdminUsers();
        } else {
          alert("Error: " + (data.error || "Could not change role"));
        }
      } catch (e) {
        alert("Failed to update role: " + e.message);
      }
    }

    async function revokeUserSessions(userId) {
      if (!confirm("Revoke all active sessions for user " + userId + "? They will be logged out immediately.")) return;
      try {
        const res = await fetch("/api/admin/users/" + userId + "/revoke-sessions", {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "same-origin"
        });
        const data = await res.json();
        alert(data.message || "Sessions revoked.");
      } catch (e) {
        alert("Failed to revoke sessions: " + e.message);
      }
    }

    // Auto-load on startup
    window.addEventListener("DOMContentLoaded", () => {
      refreshSentinel();
      checkAutonomyStatus();
      fetchPendingApprovals();
      fetchAdminUsers();
      setInterval(checkAutonomyStatus, 10000);
      setInterval(fetchPendingApprovals, 4000); // Live approvals polling
    });
  `;
