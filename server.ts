import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import * as crypto from "node:crypto";
import { runAutonomousAgent, PRIMARY_MODEL, FALLBACK_MODELS, toolRegistry, type ToolName } from "./agent.js";
import { listPendingApprovals, resolveApproval } from "./src/tools/safety.js";
import { getShunopsDashboardHtml } from "./src/dashboard/html.js";
import { runComprehensiveSentinelScan, autoHealService } from "./src/tools/sentinel.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
// Bind to localhost by default; expose publicly only via HOST=0.0.0.0 behind auth.
const HOST = process.env.HOST || "127.0.0.1";

// Shared bearer token guarding privileged endpoints. If unset we stay localhost-only.
const API_TOKEN = process.env.AGENT_API_TOKEN || process.env.API_SECRET || "";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Middleware — capture raw body so webhook signatures can be verified.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

// Standard CORS protection
app.use(
  cors({
    origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
    credentials: true,
  })
);

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Bearer/X-API-Key auth for privileged endpoints. */
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!API_TOKEN) {
    // No token configured: refuse to run privileged work unless bound to localhost.
    if (HOST === "127.0.0.1" || HOST === "localhost") {
      next();
      return;
    }
    res.status(503).json({ error: "Server misconfigured: set AGENT_API_TOKEN before binding to a public interface." });
    return;
  }
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = bearer || (req.headers["x-api-key"] as string) || "";
  if (provided && timingSafeEqualStr(provided, API_TOKEN)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized." });
}

/** Minimal in-memory fixed-window rate limiter. */
function rateLimit(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
    next();
  };
}

const heavyLimiter = rateLimit(Number(process.env.RATE_LIMIT_MAX) || 20, Number(process.env.RATE_LIMIT_WINDOW) || 60_000);
const chatLimiter = rateLimit(60, 60_000);

/**
 * 1. Root Information & Dashboard Endpoint
 */
app.get("/", (req: Request, res: Response) => {
  // If visited from a web browser, render the ShunopsAI Command Center UI
  if (req.headers.accept?.includes("text/html")) {
    res.type("text/html").send(
      getShunopsDashboardHtml({
        models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
        tools: Object.keys(toolRegistry),
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }

  res.json({
    status: "online",
    name: "ShunopsAI Autonomous Multi-Cloud & DevOps API",
    primaryModel: PRIMARY_MODEL,
    fallbackModels: FALLBACK_MODELS,
    availableTools: Object.keys(toolRegistry),
    endpoints: {
      dashboard: "GET / (in browser)",
      health: "GET /health",
      sentinelStatus: "GET /api/sentinel/status",
      sentinelHeal: "POST /api/sentinel/heal",
      runTask: "POST /api/task",
      websiteChat: "POST /api/chat",
      pendingApprovals: "GET /api/pending-approvals",
      approveAction: "POST /api/approve",
      githubWebhook: "POST /api/github-webhook",
      embeddableWidget: "GET /widget.js",
    },
    integrations: {
      n8n: "Use 'HTTP Request' node pointing to POST /api/task or import integrations/n8n/shunops-n8n-workflow.json",
      dify: "Use 'API Extension' pointing to POST /api/chat with integrations/dify/dify-tool-openapi.yaml",
    },
  });
});

/**
 * 1.1 Dedicated /dashboard route
 */
app.get("/dashboard", (_req: Request, res: Response) => {
  res.type("text/html").send(
    getShunopsDashboardHtml({
      models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
      tools: Object.keys(toolRegistry),
      uptimeSeconds: Math.floor(process.uptime()),
    })
  );
});

/**
 * 1.2 Infrastructure Sentinel Live Telemetry
 */
app.get("/api/sentinel/status", async (_req: Request, res: Response) => {
  try {
    const summary = await runComprehensiveSentinelScan();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to scan infrastructure: " + err.message });
  }
});

/**
 * 1.3 Infrastructure Sentinel Auto-Healing Trigger
 */
app.post("/api/sentinel/heal", async (req: Request, res: Response) => {
  const serviceName = req.body?.serviceName || "all";
  const reason = req.body?.reason;
  try {
    const healResult = await autoHealService(serviceName, reason);
    res.json(healResult);
  } catch (err: any) {
    res.status(500).json({ error: "Self-healing failed: " + err.message });
  }
});

/**
 * 2. Health Check
 */
app.get("/health", (_req: Request, res: Response) => {
  // Public endpoint: report liveness only, not which secrets are configured.
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * 3. Autonomous Task Execution Endpoint (Used by Flowise, n8n, Dify, or CLI)
 * Body: { goal: string, maxSteps?: number, context?: string }
 */
app.post("/api/task", requireAuth, heavyLimiter, async (req: Request, res: Response) => {
  const body = req.body || {};
  const taskGoal =
    body.goal ||
    body.task ||
    body.prompt ||
    body.message ||
    body.body?.task ||
    body.body?.goal ||
    (typeof body === "string" && body.length > 0 ? body : "Perform autonomous repository and database health check");

  const { maxSteps, context } = body;

  try {
    const result = await runAutonomousAgent(taskGoal, {
      maxSteps: typeof maxSteps === "number" ? maxSteps : 6,
      initialContext: context,
    });

    // Do not return the full history: it can contain file contents and secrets.
    res.json({
      success: result.success,
      finalAnswer: result.finalAnswer,
      stepsTaken: result.stepsTaken,
    });
  } catch (error: any) {
    console.error("[api/task] error:", error?.message);
    res.status(500).json({ success: false, error: "Failed to execute autonomous agent task." });
  }
});

/**
 * 4. Website Chat Endpoint (Fast conversational Q&A for website visitors)
 * Body: { message: string, history?: string }
 */
app.post("/api/chat", chatLimiter, async (req: Request, res: Response) => {
  const { message, history } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing required parameter 'message'." });
    return;
  }

  try {
    const goal = `Answer this website visitor query politely and helpfully: "${message}". Context/History: ${history || "None"}`;
    // Public endpoint: expose NO tools, so visitor input cannot trigger shell/fs/cloud actions.
    const result = await runAutonomousAgent(goal, {
      maxSteps: 3,
      disabledTools: Object.keys(toolRegistry) as ToolName[],
    });

    res.json({
      reply: result.finalAnswer || "I'm here to help! Could you please clarify your question?",
      success: result.success,
    });
  } catch (error: any) {
    console.error("[api/chat] error:", error?.message);
    res.status(500).json({
      reply: "Sorry, I encountered an issue processing your request. Please try again shortly.",
    });
  }
});

/**
 * 5. Pending Human-in-the-Loop Approvals
 */
app.get("/api/pending-approvals", requireAuth, (_req: Request, res: Response) => {
  res.json({ pending: listPendingApprovals() });
});

/**
 * 6. Approve or Reject a Sensitive Action
 * Body: { id: string, approved: boolean }
 */
app.post("/api/approve", requireAuth, (req: Request, res: Response) => {
  const { id, approved } = req.body;

  if (!id || typeof approved !== "boolean") {
    res.status(400).json({ error: "Provide 'id' (string) and 'approved' (boolean)." });
    return;
  }

  const success = resolveApproval(id, approved);
  if (success) {
    res.json({ success: true, message: `Request ${id} marked as ${approved ? "APPROVED" : "REJECTED"}.` });
  } else {
    res.status(404).json({ success: false, message: `Request ${id} not found or already resolved.` });
  }
});

/**
 * 7. GitHub Webhook Listener (Triggers remediation on issues / PRs)
 */
app.post("/api/github-webhook", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  // Verify GitHub HMAC signature when a webhook secret is configured.
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = (req.headers["x-hub-signature-256"] as string) || "";
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(payload || {}));
    const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (!signature || !timingSafeEqualStr(signature, expected)) {
      res.status(401).json({ error: "Invalid webhook signature." });
      return;
    }
  } else {
    console.warn("[GitHub Webhook] GITHUB_WEBHOOK_SECRET not set — signature verification is disabled.");
  }

  res.status(202).json({ received: true, event });

  if (event === "issues" && payload.action === "opened") {
    const issueTitle = payload.issue?.title;
    const issueBody = payload.issue?.body;
    const issueNum = payload.issue?.number;
    const repo = payload.repository?.full_name;

    console.log(`\n\x1b[35m[GitHub Webhook]\x1b[0m New Issue #${issueNum} in ${repo}: ${issueTitle}`);

    // Trigger agent asynchronously to analyze and draft fix
    runAutonomousAgent(
      `GitHub Issue #${issueNum} opened in ${repo}:\nTitle: ${issueTitle}\nDescription: ${issueBody}\nInspect codebase, draft a fix, and verify.`,
      { maxSteps: 10 }
    ).catch(console.error);
  }
});

/**
 * 8. 1-Line Embeddable Website Chat Widget (~5KB Vanilla JS)
 */
app.get("/widget.js", (req: Request, res: Response) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.type("application/javascript").send(`
(function() {
  const apiEndpoint = "${host}/api/chat";
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

  async function sendMsg() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    msgContainer.innerHTML += \`<div style="align-self:flex-end;background:#2563eb;color:#fff;padding:8px 12px;border-radius:8px;max-width:80%">\${text}</div>\`;
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
  `);
});

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`\n\x1b[32m\x1b[1m========================================================\x1b[0m`);
  console.log(`\x1b[32m\x1b[1m🚀 Multi-Agent Autonomous API Server Live on port ${PORT}\x1b[0m`);
  const authConfigured = Boolean(API_TOKEN);
  console.log(`\x1b[36m👉 Bind:\x1b[0m     ${HOST}:${PORT}  (auth: ${authConfigured ? "enabled" : "disabled"})`);
  console.log(`\x1b[36m👉 Base URL:\x1b[0m http://localhost:${PORT}`);
  console.log(`\x1b[36m👉 Health:\x1b[0m   http://localhost:${PORT}/health`);
  console.log(`\x1b[36m👉 Run Task:\x1b[0m POST http://localhost:${PORT}/api/task`);
  console.log(`\x1b[36m👉 Widget:\x1b[0m   http://localhost:${PORT}/widget.js`);
  console.log(`\x1b[32m\x1b[1m========================================================\x1b[0m\n`);
});
