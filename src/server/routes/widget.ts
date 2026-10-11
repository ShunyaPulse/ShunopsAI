import type { FastifyInstance } from "fastify";

/**
 * 1-Line Embeddable Website Chat Widget (~5KB Vanilla JS) - Fastify Plugin.
 */
export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/widget.js", async (req, reply) => {
    // The Host header is attacker-controllable, so it must be validated before
    // being embedded into JavaScript (otherwise it is a reflected-XSS vector).
    // Prefer an explicit PUBLIC_BASE_URL when running behind a proxy.
    const configuredBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const rawHost = req.headers.host || "";
    const hostIsSafe = /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(rawHost) && !rawHost.startsWith(".");
    const apiBase = configuredBase || (hostIsSafe ? `${req.protocol}://${rawHost}` : "");
    const apiEndpoint = `${apiBase}/api/chat`;
    reply.header("X-Content-Type-Options", "nosniff");
    const script = `
(function() {
  const apiEndpoint = ${JSON.stringify(apiEndpoint)};
  const btn = document.createElement("button");
  btn.innerText = "💬 Chat";
  btn.style.position = "fixed";
  btn.style.bottom = "20px";
  btn.style.right = "20px";
  btn.style.padding = "12px 20px";
  btn.style.background = "#2563eb";
  btn.style.color = "#fff";
  btn.style.border = "none";
  btn.style.borderRadius = "24px";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  btn.style.zIndex = "999999";

  const box = document.createElement("div");
  box.style.display = "none";
  box.style.position = "fixed";
  box.style.bottom = "70px";
  box.style.right = "20px";
  box.style.width = "340px";
  box.style.height = "420px";
  box.style.background = "#fff";
  box.style.borderRadius = "12px";
  box.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
  box.style.zIndex = "999999";
  box.style.flexDirection = "column";
  box.style.overflow = "hidden";
  box.style.fontFamily = "sans-serif";

  box.innerHTML = \`
    <div style="background:#2563eb;color:#fff;padding:12px;font-weight:bold;display:flex;justify-content:space-between">
      <span>AI Assistant</span>
      <span id="close-chat" style="cursor:pointer">&times;</span>
    </div>
    <div id="chat-messages" style="flex:1;padding:12px;overflow-y:auto;font-size:14px;display:flex;flex-direction:column;gap:8px"></div>
    <div style="display:flex;border-top:1px solid #eee;padding:8px">
      <input id="chat-input" placeholder="Type a message..." style="flex:1;border:1px solid #ccc;padding:8px;border-radius:6px;outline:none" />
      <button id="chat-send" style="background:#2563eb;color:#fff;border:none;padding:8px 12px;margin-left:6px;border-radius:6px;cursor:pointer">Send</button>
    </div>
  \`;

  btn.onclick = () => { box.style.display = box.style.display === "none" ? "flex" : "none"; };
  document.body.appendChild(btn);
  document.body.appendChild(box);

  box.querySelector("#close-chat").onclick = () => { box.style.display = "none"; };

  const inputEl = box.querySelector("#chat-input");
  const sendBtn = box.querySelector("#chat-send");
  const msgContainer = box.querySelector("#chat-messages");

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function sendMsg() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    msgContainer.innerHTML += \`<div style="align-self:flex-end;background:#2563eb;color:#fff;padding:8px 12px;border-radius:8px;max-width:80%">\${esc(text)}</div>\`;
    msgContainer.scrollTop = msgContainer.scrollHeight;

    const botDiv = document.createElement("div");
    botDiv.style.alignSelf = "flex-start";
    botDiv.style.background = "#f1f5f9";
    botDiv.style.padding = "8px 12px";
    botDiv.style.borderRadius = "8px";
    botDiv.style.maxWidth = "80%";
    botDiv.innerText = "Thinking...";
    msgContainer.appendChild(botDiv);

    try {
      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      botDiv.innerText = data.reply || "No response";
    } catch (e) {
      botDiv.innerText = "Error contacting AI assistant.";
    }
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  sendBtn.onclick = sendMsg;
  inputEl.onkeypress = (e) => { if (e.key === "Enter") sendMsg(); };
})();
    `;
    return reply.type("application/javascript").send(script);
  });
}
