# ⚡ Cloudflare Workers Serverless AI Agent & Floating Command Widget

A production-grade, zero-cost, serverless AI Agent deployed on **Cloudflare Workers** with **real-time Server-Sent Events (SSE) streaming**, native **Function Calling (Tool Calling)**, and an interactive dark-mode floating website widget.

---

## 🌟 Key Architecture & Capabilities

1. **Dual-Capability Engine:**
   - **Conversational Mode:** Instant real-time streaming Q&A (<100ms TTFB) for website FAQs, documentation, and advisory.
   - **Active Command Mode:** Detects actionable intent and triggers structured native tools:
     - `submit_lead(name, email, phone, requirements)`: Lead intake with webhook dispatch.
     - `track_order_or_status(referenceId)`: Queries order/ticket status with live milestone breakdown.
     - `schedule_appointment(date, time, contact, notes)`: Reserves calendar slots and confirms bookings.
     - `trigger_system_action(actionType, payload)`: Generates interactive confirmation cards with HMAC authorization tokens.
2. **Edge Multi-Provider Fallback Cascade:**
   - **Primary:** Google Gemini Flash (`gemini-3.8-flash` / `gemini-3.7-flash`) with randomized key permutation across `GEMINI_KEYS` to eliminate anti-contention spikes.
   - **Failover:** Groq LPUs (`openai/gpt-oss-120b` or `llama-3.3-70b-versatile`) on rate-limit (429) or upstream outage (503).
3. **State & Session Memory:**
   - Powered by Cloudflare KV (`CHAT_SESSIONS`). Stores the last 10 conversation turns per `sessionId` with automated TTL expiration.
4. **Security & Guardrails:**
   - Strict CORS policy (`ALLOWED_ORIGIN`).
   - Cloudflare Turnstile bot verification (`TURNSTILE_SECRET_KEY`).
   - HMAC-SHA256 signature verification on action confirmations.
   - Zero-cleartext logging sanitization.

---

## 📁 Codebase Layout

| File | Purpose |
| :--- | :--- |
| [`wrangler.jsonc`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/wrangler.jsonc) | Cloudflare Workers configuration with KV bindings & env vars |
| [`src/types.ts`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/src/types.ts) | TypeScript interfaces for Environment, Chat, Tools, and SSE events |
| [`src/tools/registry.ts`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/src/tools/registry.ts) | Tool schemas, execution handlers, and HMAC cryptographic signing |
| [`src/agent/engine.ts`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/src/agent/engine.ts) | Edge ReAct loop, KV history loader, fallback cascade, SSE streamer |
| [`src/index.ts`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/src/index.ts) | Hono routing app (`/api/chat`, `/api/action/confirm`, `/widget.js`, `/`) |
| [`src/widget-script.ts`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/src/widget-script.ts) | Embedded widget script string for edge delivery without filesystem |
| [`public/widget.js`](file:///c:/Users/LENOVO/OneDrive/Desktop/AA/public/widget.js) | Standalone client-side script with Glassmorphism, SSE reader & cards |

---

## 🚀 Quickstart & Local Development

### 1. Local Development
Start the local Worker dev server using Wrangler:
```bash
npm run worker:dev
```
Or with specific port:
```bash
npx wrangler dev --port 8787
```

Open `http://localhost:8787` in your browser to view the interactive preview landing page and test the widget launcher.

### 2. Configure Cloudflare KV & Secrets
Create the Cloudflare KV namespace:
```bash
npx wrangler kv namespace create CHAT_SESSIONS
```
Update the `id` in `wrangler.jsonc` with the output ID.

Set production secrets:
```bash
# Gemini API Key(s)
npx wrangler secret put GEMINI_API_KEY
# (Optional) Comma-separated pool for key rotation:
# npx wrangler secret put GEMINI_KEYS

# Groq API Key (Fallback)
npx wrangler secret put GROQ_API_KEY

# Action Confirmation HMAC Secret
npx wrangler secret put ACTION_SECRET

# (Optional) Cloudflare Turnstile Secret Key
npx wrangler secret put TURNSTILE_SECRET_KEY
```

### 3. Deploy to Cloudflare Edge
```bash
npm run worker:deploy
```

---

## 🌐 Embedding the Widget in Your Website

Add this single script tag to any HTML page (WordPress, Webflow, Next.js, static HTML):

```html
<script 
  src="https://<YOUR_WORKER_SUBDOMAIN>.workers.dev/widget.js" 
  data-api-url="https://<YOUR_WORKER_SUBDOMAIN>.workers.dev"
  data-title="AI Assistant & Action Engine"
  data-welcome="Hello! I am your AI Assistant on Cloudflare Workers. Ask me anything or issue commands."
  defer>
</script>
```

### Customization Attributes
- `data-api-url`: URL of your deployed Worker backend (defaults to current origin).
- `data-title`: Chat modal header title.
- `data-welcome`: Initial greeting message shown to visitors.
- `data-turnstile-sitekey`: (Optional) Cloudflare Turnstile public site key for bot verification.
