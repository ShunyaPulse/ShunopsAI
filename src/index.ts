import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ChatRequestBody, ActionConfirmRequest } from './types.js';
import { executeAgentStream } from './agent/engine.js';
import { verifyActionToken, executeConfirmedAction } from './tools/registry.js';
import { WIDGET_JS_CONTENT } from './widget-script.js';

const app = new Hono<{ Bindings: Env }>();

// 1. Strict CORS Middleware
app.use('*', async (c, next) => {
  const configuredOrigin = c.env.ALLOWED_ORIGIN || '*';
  const corsMiddleware = cors({
    origin: (requestOrigin) => {
      if (configuredOrigin === '*' || !requestOrigin) {
        return requestOrigin || '*';
      }
      return requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
    exposeHeaders: ['Content-Length', 'X-Session-Id'],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

// Helper: Verify Cloudflare Turnstile token
async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string
): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteIp) formData.append('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) return false;
    const outcome = (await res.json()) as { success: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

// 2. Health & Status Check Endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    runtime: 'Cloudflare Workers (Edge)',
    primaryModel: c.env.PRIMARY_MODEL || 'gemini-3.8-flash',
    fallbackModel: c.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile',
  });
});

// 3. Real-Time Streaming AI Chat Endpoint (Server-Sent Events)
app.post('/api/chat', async (c) => {
  let body: ChatRequestBody;
  try {
    body = await c.req.json<ChatRequestBody>();
  } catch {
    return c.json({ error: 'Invalid JSON request body.' }, 400);
  }

  const { message } = body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'Field "message" is required and cannot be empty.' }, 400);
  }

  // Ensure sessionId exists
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    body.sessionId = `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
  }

  // Turnstile Bot Verification Guardrail
  if (c.env.TURNSTILE_SECRET_KEY) {
    if (!body.turnstileToken) {
      return c.json(
        { error: 'Turnstile verification token required for security clearance.' },
        403
      );
    }
    const clientIp = c.req.header('cf-connecting-ip');
    const isValid = await verifyTurnstileToken(
      body.turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      clientIp
    );
    if (!isValid) {
      return c.json({ error: 'Turnstile bot challenge failed. Access denied.' }, 403);
    }
  }

  // Execute Agent ReAct Stream on Edge
  return executeAgentStream(body, c.env);
});

// 4. Action Confirmation Endpoint (For Interactive Sensitive Commands)
app.post('/api/action/confirm', async (c) => {
  let body: ActionConfirmRequest;
  try {
    body = await c.req.json<ActionConfirmRequest>();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON request body.' }, 400);
  }

  const { sessionId, actionId, approved, actionType, payload, token } = body;

  if (!actionId || !actionType || typeof approved !== 'boolean' || !token) {
    return c.json(
      { success: false, message: 'Missing required confirmation parameters.' },
      400
    );
  }

  // Verify HMAC cryptographic signature
  const secret = c.env.ACTION_SECRET || 'edge-action-secret-key-2025';
  const isSignatureValid = await verifyActionToken(actionId, actionType, token, secret);

  if (!isSignatureValid) {
    return c.json(
      {
        success: false,
        actionId,
        status: 'failed',
        message: 'Security validation error: Action token is invalid or has expired.',
      },
      403
    );
  }

  // If user declined the action
  if (!approved) {
    return c.json({
      success: true,
      actionId,
      status: 'rejected',
      message: `Action "${actionType}" was rejected by the user.`,
    });
  }

  // Execute the authorized command
  const outcome = await executeConfirmedAction(
    actionType,
    payload || {},
    c.env,
    sessionId || 'unknown'
  );

  return c.json(outcome);
});

// 5. Standalone Chat Widget Script Delivery
app.get('/widget.js', (c) => {
  return c.text(WIDGET_JS_CONTENT, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    'Access-Control-Allow-Origin': '*',
  });
});

// 6. Interactive Live Demo Landing Page
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare Edge AI Command Agent & Widget</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #3b82f6;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #090d16 60%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      max-width: 900px;
      width: 100%;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: -1px;
      line-height: 1.15;
      margin-bottom: 16px;
      background: linear-gradient(135deg, #ffffff 40%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      font-size: 18px;
      color: var(--muted);
      line-height: 1.6;
      margin-bottom: 36px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }
    .card h3 {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card p {
      font-size: 14px;
      color: var(--muted);
      line-height: 1.5;
    }
    .code-box {
      background: #020617;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      color: #38bdf8;
      overflow-x: auto;
      line-height: 1.6;
    }
    .code-box pre { margin: 0; }
    .hint {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 12px;
      padding: 16px 20px;
      font-size: 14px;
      color: #6ee7b7;
      display: flex;
      align-items: center;
      gap: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;"></span>
      Production Edge AI Worker Live
    </div>

    <h1>Serverless Edge AI Agent<br>& Interactive Action Engine</h1>
    <p class="subtitle">
      Powered by Cloudflare Workers, Hono, and Server-Sent Events (SSE). Seamlessly switches between conversational Q&A and active command execution with structured tool calling.
    </p>

    <div class="grid">
      <div class="card">
        <h3>⚡ Real-Time Streaming</h3>
        <p>Ultra-low TTFB (&lt;100ms) with direct SSE token streaming. Powered by Gemini 3.8/3.7 Flash and Groq LPU failover.</p>
      </div>
      <div class="card">
        <h3>🛠️ Native Tool Calling</h3>
        <p>Understands user intent and executes <code>submit_lead</code>, <code>track_order_or_status</code>, <code>schedule_appointment</code>, and <code>trigger_system_action</code>.</p>
      </div>
      <div class="card">
        <h3>🛡️ Human-in-the-Loop Cards</h3>
        <p>Sensitive commands render interactive authorization cards in the chat with cryptographically signed confirmation tokens.</p>
      </div>
    </div>

    <div class="code-box">
      <p style="color:#94a3b8;margin-bottom:8px;">// Embed the floating widget into any website with 1 line of HTML:</p>
      <pre>&lt;script src="/widget.js" data-title="Cloudflare Edge AI" defer&gt;&lt;/script&gt;</pre>
    </div>

    <div class="hint">
      👉 Click the floating blue launcher icon in the bottom-right corner to test live conversations and commands!
    </div>
  </div>

  <!-- Embedded Live Widget Script -->
  <script src="/widget.js" data-title="Edge AI Command Engine" defer></script>
</body>
</html>`;

  return c.html(html);
});

export default app;
