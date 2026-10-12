import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  Env,
  ChatRequestBody,
  ActionConfirmRequest,
  ShieldChallenge,
  ShieldSolutionPayload,
} from './types.js';
import { executeAgentStream } from './agent/engine.js';
import { verifyActionToken, executeConfirmedAction } from './tools/registry.js';
import { WIDGET_JS_CONTENT } from './widget-script.js';

const app = new Hono<{ Bindings: Env }>();

// 1. Strict CORS Middleware
app.use('*', async (c, next) => {
  const configuredOrigin = c.env.ALLOWED_ORIGIN || '*';
  const allowedOrigins = configuredOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  const corsMiddleware = cors({
    origin: (requestOrigin) => {
      if (!requestOrigin) return '*';
      if (configuredOrigin === '*' || allowedOrigins.includes('*')) {
        return '*';
      }
      return allowedOrigins.includes(requestOrigin) ? requestOrigin : '';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
    exposeHeaders: ['Content-Length', 'X-Session-Id'],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

/**
 * Salt used to sign edge proof-of-work challenges.
 *
 * Returns null when unconfigured: a hardcoded default salt is public, which
 * would make the puzzle forgeable and turn the shield into security theatre.
 */
function getEdgeShieldSecret(env: Env): string | null {
  return env.ACTION_SECRET || null;
}

// Helper: Generate Cryptographic Proof-of-Work Challenge on Edge
async function generateEdgeShieldChallenge(secret: string): Promise<ShieldChallenge> {
  const salt = crypto.randomUUID().replace(/-/g, '');
  const timestamp = Date.now();
  const targetDifficulty = 2; // '00' prefix requirement
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${salt}:${timestamp}:${targetDifficulty}`)
  );
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    salt,
    targetDifficulty,
    timestamp,
    signature,
  };
}

// Helper: Verify Cryptographic Proof-of-Work Solution on Edge
async function verifyEdgeShieldSolution(
  secret: string,
  shield: ShieldSolutionPayload
): Promise<boolean> {
  if (!shield || !shield.salt || !shield.timestamp || !shield.signature || !shield.solution) {
    return false;
  }
  // Expire challenges older than 10 minutes
  if (Date.now() - shield.timestamp > 10 * 60 * 1000) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = shield.signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16));
  if (!sigBytes || sigBytes.length !== 32) return false;
  const sigBuf = new Uint8Array(sigBytes);

  const isSigValid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBuf,
    enc.encode(`${shield.salt}:${shield.timestamp}:${shield.targetDifficulty}`)
  );
  if (!isSigValid) return false;

  const hashBuf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${shield.salt}:${shield.solution}`)
  );
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const PREFIX_TABLE: Record<number, string> = {
    1: '0',
    2: '00',
    3: '000',
    4: '0000',
  };
  const prefix = PREFIX_TABLE[shield.targetDifficulty] || '00';
  return hash.startsWith(prefix);
}

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
    fallbackModel: c.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b',
  });
});

// 3. Cryptographic Bot Shield Challenge Endpoint
app.get('/api/shield/challenge', async (c) => {
  const secret = getEdgeShieldSecret(c.env);
  if (!secret) {
    return c.json(
      { error: 'Bot shield is not configured on this server (ACTION_SECRET missing).' },
      503
    );
  }
  const challenge = await generateEdgeShieldChallenge(secret);
  return c.json(challenge);
});

// 4. Real-Time Streaming AI Chat Endpoint (Server-Sent Events)
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

  // Ensure sessionId exists and is safe to use as a KV key. A client-supplied
  // id must be strictly validated, otherwise an attacker could read or collide
  // with another visitor's stored conversation (IDOR).
  if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(body.sessionId)) {
    body.sessionId = `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}_${Date.now().toString(36)}`;
  }

  const clientIp = c.req.header('cf-connecting-ip') || '127.0.0.1';

  // KV-backed edge rate limiter (10 requests / 10 minutes per IP)
  if (c.env.CHAT_SESSIONS) {
    const slot = Math.floor(Date.now() / 600000);
    const rlKey = `rl:chat:${clientIp}:${slot}`;
    try {
      const currentCountStr = await c.env.CHAT_SESSIONS.get(rlKey);
      const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
      if (currentCount >= 10) {
        return c.json(
          { error: 'Rate limit exceeded: maximum 10 requests per 10 minutes from this IP.' },
          429
        );
      }
      await c.env.CHAT_SESSIONS.put(rlKey, String(currentCount + 1), { expirationTtl: 600 });
    } catch {}
  }

  // Bot gate. This endpoint proxies paid model APIs, and the KV limiter above
  // only bounds volume per IP — a bot can stay under it forever. So every
  // request must clear a challenge: Turnstile when configured, otherwise a
  // mandatory proof-of-work shield. With neither configured the endpoint fails
  // closed instead of behaving as an open LLM proxy.
  if (c.env.TURNSTILE_SECRET_KEY) {
    if (!body.turnstileToken) {
      return c.json(
        { error: 'Turnstile verification token required for security clearance.' },
        403
      );
    }
    const isValid = await verifyTurnstileToken(
      body.turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      clientIp
    );
    if (!isValid) {
      return c.json({ error: 'Turnstile bot challenge failed. Access denied.' }, 403);
    }
  } else {
    const shieldSecret = getEdgeShieldSecret(c.env);
    if (!shieldSecret) {
      return c.json(
        {
          error:
            'Chat is unavailable: no bot gate is configured. Set TURNSTILE_SECRET_KEY or ACTION_SECRET.',
        },
        503
      );
    }
    if (!body.shield) {
      return c.json(
        {
          error:
            'Proof-of-work bot shield required. Fetch /api/shield/challenge, solve it, and resend with the "shield" field.',
        },
        403
      );
    }
    const isShieldValid = await verifyEdgeShieldSolution(shieldSecret, body.shield);
    if (!isShieldValid) {
      return c.json({ error: 'Proof-of-Work bot shield challenge failed. Access denied.' }, 403);
    }
  }

  // Execute Agent ReAct Stream on Edge
  return executeAgentStream(body, c.env);
});

// 5. Action Confirmation Endpoint (For Interactive Sensitive Commands)
app.post('/api/action/confirm', async (c) => {
  let body: ActionConfirmRequest;
  try {
    body = await c.req.json<ActionConfirmRequest>();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON request body.' }, 400);
  }

  const { sessionId, actionId, approved, actionType, payload, token, expiresAt } = body;

  if (
    !actionId ||
    !actionType ||
    typeof approved !== 'boolean' ||
    !token ||
    typeof expiresAt !== 'number'
  ) {
    return c.json(
      { success: false, message: 'Missing required confirmation parameters.' },
      400
    );
  }

  // Verify HMAC cryptographic signature. The secret is mandatory (no insecure
  // default) and the signature binds the payload and expiry.
  const secret = c.env.ACTION_SECRET;
  if (!secret) {
    return c.json(
      { success: false, message: 'Action confirmation is not configured on this server.' },
      500
    );
  }
  const isSignatureValid = await verifyActionToken(
    actionId,
    actionType,
    payload || {},
    expiresAt,
    token,
    secret
  );

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

  // Eliminate action replay: verify actionId has not been previously consumed.
  // Fails closed: a reusable confirmation token is exactly the replay window
  // this guard exists to close, so it must not silently no-op when the binding
  // is missing or the store is unreachable.
  const kv = c.env.CHAT_SESSIONS;
  if (!kv) {
    return c.json(
      {
        success: false,
        message: 'Action confirmation is unavailable: replay protection is not configured.',
      },
      503
    );
  }
  const consumedKey = `action_consumed:${actionId}`;
  try {
    const alreadyConsumed = await kv.get(consumedKey);
    if (alreadyConsumed) {
      return c.json(
        {
          success: false,
          actionId,
          status: 'failed',
          message: 'Security validation error: Action token has already been consumed (replay prevention).',
        },
        409
      );
    }
    // Burn token immediately with 24-hour expiration TTL
    await kv.put(consumedKey, '1', { expirationTtl: 86400 });
  } catch {
    return c.json(
      {
        success: false,
        message: 'Action confirmation is unavailable: replay protection check failed.',
      },
      503
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

/*
// 6. Preview Route (Commented Out)
app.get('/', (c) => {
  return c.json({
    service: 'ShunopsAI Edge Agent Widget CDN & API',
    status: 'healthy',
    runtime: 'Cloudflare Workers Edge (V8 Isolates)',
    embed_snippet: '<script src="https://edge-agent-widget.shunopsai.workers.dev/widget.js" defer></script>',
    endpoints: {
      widget_script: '/widget.js',
      shield_challenge: '/api/shield/challenge',
      chat_stream: '/api/chat',
      health: '/api/health',
    },
    documentation: 'https://shunopsai-685823552970.asia-south1.run.app/portal',
  });
});
*/

export default app;
