import { DASHBOARD_STYLES } from "./styles.js";

function getLegalPageShell(title: string, subtitle: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} • ShunopsAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${DASHBOARD_STYLES}
    .legal-container {
      max-width: 960px;
      margin: 40px auto;
      padding: 0 24px 60px;
      width: 100%;
    }
    .legal-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 36px 40px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .legal-header {
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 24px;
      margin-bottom: 28px;
    }
    .legal-header h1 {
      font-size: 28px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 8px;
      background: linear-gradient(90deg, #fff, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .legal-header p {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .legal-content h2 {
      font-size: 19px;
      font-weight: 700;
      color: #fff;
      margin-top: 32px;
      margin-bottom: 12px;
      border-left: 3px solid var(--accent);
      padding-left: 12px;
    }
    .legal-content h3 {
      font-size: 15px;
      font-weight: 600;
      color: #38bdf8;
      margin-top: 20px;
      margin-bottom: 8px;
    }
    .legal-content p, .legal-content li {
      color: #cbd5e1;
      font-size: 14px;
      line-height: 1.7;
      margin-bottom: 12px;
    }
    .legal-content ul {
      margin-left: 20px;
      margin-bottom: 16px;
    }
    .code-tag {
      background: rgba(0, 240, 255, 0.08);
      color: #00f0ff;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--code-font);
      font-size: 12px;
      border: 1px solid rgba(0, 240, 255, 0.2);
    }
    .callout-box {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .footer-nav {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .footer-nav a {
      color: #38bdf8;
      text-decoration: none;
      transition: color 0.15s;
    }
    .footer-nav a:hover {
      color: #fff;
      text-decoration: underline;
    }

    /* Mobile Responsiveness */
    @media (max-width: 768px) {
      .legal-container {
        margin: 16px auto;
        padding: 0 10px 40px;
      }
      .legal-card {
        padding: 20px 14px;
        border-radius: 12px;
      }
      .legal-header {
        padding-bottom: 16px;
        margin-bottom: 20px;
      }
      .legal-header h1 {
        font-size: 22px;
      }
      .legal-header p {
        font-size: 13px;
      }
      .legal-content h2 {
        font-size: 17px;
        margin-top: 24px;
      }
      .legal-content p, .legal-content li {
        font-size: 13.5px;
        line-height: 1.6;
      }
      .callout-box {
        padding: 12px 14px;
      }
      .footer-nav {
        flex-direction: column;
        text-align: center;
        gap: 12px;
      }
      .legal-models-grid {
        grid-template-columns: 1fr !important;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <a href="/" style="text-decoration:none; display:flex; align-items:center; gap:12px;">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-title">SHUNOPSAI</div>
          <div class="brand-subtitle">Autonomous DevOps &amp; AI Engine</div>
        </div>
      </a>
    </div>
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/workspace" class="btn btn-secondary" style="text-decoration:none; font-size:12px; padding:6px 14px;">
        ← Workspace
      </a>
      <a href="/portal" class="btn btn-secondary" style="text-decoration:none; font-size:12px; padding:6px 14px;">
        ⚙️ Settings
      </a>
    </div>
  </header>

  <div class="legal-container">
    <div class="legal-card">
      <div class="legal-header">
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      <div class="legal-content">
        ${contentHtml}
      </div>
      <div class="footer-nav">
        <div>&copy; 2026 ShunopsAI Autonomous Multi-Cloud Platform. All rights reserved.</div>
        <div style="display:flex; gap:16px;">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/about">About &amp; Architecture</a>
          <a href="/workspace">User Workspace</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Privacy Policy Page with complete cryptographic and data-handling technical specifications.
 */
export function getPrivacyPolicyHtml(): string {
  const content = `
    <h2>1. Overview & Zero-Persistence Architecture</h2>
    <p>
      ShunopsAI is engineered with a strict <strong>Zero-Persistence Architecture</strong>. We adhere to the fundamental invariant that user-supplied third-party API credentials (including BYOK keys for Groq, Google AI Studio Gemini, GitHub Personal Access Tokens, and Hugging Face User Access Tokens) must <em>never be stored</em> in our persistent database tables, written to server file systems, or retained in persistent application state.
    </p>

    <h2>2. Client-Side Cryptographic Vault (W3C WebCrypto API)</h2>
    <p>
      When users elect to store their API credentials for browser convenience, ShunopsAI utilizes client-side, hardware-backed isolation:
    </p>
    <ul>
      <li><strong>Algorithm:</strong> <span class="code-tag">AES-256-GCM</span> (Galois/Counter Mode with 128-bit authentication tags).</li>
      <li><strong>Key Generation:</strong> Master symmetric keys are generated via <span class="code-tag">crypto.subtle.generateKey</span> with <span class="code-tag">extractable: false</span>. The raw secret key bytes cannot be read by page scripts, browser extensions, or malicious AST injectors.</li>
      <li><strong>Storage Sandbox:</strong> Encrypted initialization vectors (IVs) and ciphertext are persisted solely within the browser's origin-scoped <span class="code-tag">IndexedDB</span> (<span class="code-tag">shunops_secure_vault_v3</span>). No unencrypted payload ever touches server disk.</li>
      <li><strong>Ephemeral Transit:</strong> During live inference requests, keys are transmitted via TLS 1.3 encrypted headers (<span class="code-tag">x-groq-key</span>, <span class="code-tag">x-gemini-key</span>). They are consumed in volatile server memory solely for the lifespan of that specific HTTP request and immediately garbage-collected.</li>
    </ul>

    <h2>3. Distributed Rate Limiting & Subnet Data Handling</h2>
    <p>
      To prevent denial-of-service bursts while maintaining anonymity:
    </p>
    <ul>
      <li><strong>Subnet Level Aggregation:</strong> Rate limits are calculated at the /24 IPv4 subnet or /48 IPv6 subnet boundary rather than individual persistent user tracking.</li>
      <li><strong>Edge IP Resolution:</strong> Client IP resolution strictly reads the trusted edge proxy hop (<span class="code-tag">CF-Connecting-IP</span> or the terminal hop appended by Cloud Run reverse proxies) to prevent header spoofing attacks.</li>
      <li><strong>Distributed Redis Cache:</strong> Counters are stored ephemerally in high-speed Redis instances hosted on Oracle Cloud Infrastructure (OCI) with automatic sliding expiration (TTL).</li>
    </ul>

    <h2>4. Account Data & Session Management</h2>
    <p>
      For registered user accounts:
    </p>
    <ul>
      <li><strong>Password Hashing:</strong> Passwords are cryptographically salted and hashed using <span class="code-tag">bcrypt</span> with adaptive work factor 10.</li>
      <li><strong>Hashed Session Tokens:</strong> Session cookies (<span class="code-tag">shunops_user_session</span>) are stored in PostgreSQL database tables exclusively as cryptographic <span class="code-tag">SHA-256</span> hashes. A read-only database snapshot leak cannot grant active session hijacking.</li>
      <li><strong>Cookie Flags:</strong> Session cookies enforce <span class="code-tag">HttpOnly</span>, <span class="code-tag">SameSite=Lax</span>, and <span class="code-tag">Secure</span> in production environments.</li>
      <li><strong>One-Time Passwords (OTP):</strong> Email authentication codes are single-use tokens that expire immediately upon first verification or after 5 minutes. No grace periods or replay windows are permitted.</li>
    </ul>

    <h2>5. Third-Party Model Providers & Egress</h2>
    <p>
      Inference requests cascade across authorized foundation model providers:
    </p>
    <ul>
      <li><strong>Google AI Studio / Gemini API:</strong> Generative Language REST endpoints (<span class="code-tag">generativelanguage.googleapis.com</span>).</li>
      <li><strong>Groq LPUs:</strong> Tensor streaming execution (<span class="code-tag">api.groq.com/openai/v1</span>).</li>
      <li><strong>OpenRouter:</strong> High-parameter reasoning router (<span class="code-tag">openrouter.ai/api/v1</span>).</li>
      <li><strong>Cloudflare Workers AI:</strong> Edge LoRA adapter inference via Cloudflare global network.</li>
    </ul>
    <p>
      No prompts or code snippets processed through ShunopsAI are used to train proprietary base models.
    </p>
  `;
  return getLegalPageShell(
    "Privacy Policy & Cryptographic Data Governance",
    "Detailed technical specifications on zero-persistence key vaults, ephemeral execution, and data protection.",
    content
  );
}

/**
 * Terms of Service Page detailing multi-provider consensus, rate limits, and SLA.
 */
export function getTermsOfServiceHtml(): string {
  const content = `
    <h2>1. Acceptance of Terms & Service Boundaries</h2>
    <p>
      By accessing or utilizing the ShunopsAI platform, workspace, REST API endpoints (<span class="code-tag">/api/chat</span>, <span class="code-tag">/api/task</span>), or embedded monitoring widgets, you agree to comply with these Terms of Service. ShunopsAI provides an autonomous multi-cloud operations engine, AI agent workflow automation, and security remediation tooling.
    </p>

    <h2>2. Rate Limits & Quota Policies</h2>
    <p>
      To preserve multi-tenant stability and protect infrastructure resources:
    </p>
    <ul>
      <li><strong>Shared Cloud Engine:</strong> Anonymous visitor queries are allocated 5 requests per 10-minute sliding window per network subnet. Step execution is capped at single-iteration inference.</li>
      <li><strong>Dedicated BYOK Mode:</strong> Users providing validated personal API keys (<span class="code-tag">gsk_...</span> or <span class="code-tag">AIzaSy...</span>) receive expanded agent iteration budgets (up to 3 multi-tool reasoning steps) and bypass anonymous subnet throttles.</li>
      <li><strong>BYOK Quota Responsibility:</strong> Users are solely responsible for compliance with their third-party provider quotas, billing tiers, and usage terms with Google, Groq, GitHub, and Cloudflare.</li>
    </ul>

    <h2>3. Dual-Model Consensus Invariant</h2>
    <p>
      For autonomous pull request evaluations, CodeQL alert remedies, and security modifications:
    </p>
    <ul>
      <li><strong>Zero Single-Model Merges:</strong> No code remediation or Pull Request can be merged by a single AI model alone.</li>
      <li><strong>Proposer Round:</strong> Active Gemini Flash models evaluate the diff/alert and propose the patch.</li>
      <li><strong>Auditor Round:</strong> Groq <span class="code-tag">openai/gpt-oss-120b</span> executes abstract syntax tree (AST) cross-auditing to verify absence of injection vectors, regressions, or syntax breakage.</li>
      <li><strong>Consensus Lock:</strong> Only unanimous approval allows automated git merging.</li>
    </ul>

    <h2>4. Autonomous Proactive Code Healing Limits</h2>
    <p>
      The autonomous repository sentinel operates under deterministic safety ceilings:
    </p>
    <ul>
      <li><strong>Flaw Remediation Cap:</strong> Maximum 5 flaw remediations per scheduled audit cycle to prevent token explosion.</li>
      <li><strong>Commit Deduplication Throttling:</strong> Consecutive audit cycles on identical commit SHAs are capped at 2 runs before LLM inference is suspended, preventing duplicate quota expenditure.</li>
      <li><strong>Typecheck Verification:</strong> Every remediated codebase must pass <span class="code-tag">tsc --noEmit</span> prior to commit creation.</li>
    </ul>

    <h2>5. Disclaimer of Warranties & Limitation of Liability</h2>
    <p>
      ShunopsAI is provided on an "as is" and "as available" basis without warranties of any kind. While our multi-provider fallback cascades and consensus locks are engineered to maximize uptime and prevent erroneous patches, users must maintain automated continuous integration pipelines, backups, and staging validation before applying autonomous patches to production mission-critical services.
    </p>
  `;
  return getLegalPageShell(
    "Terms of Service & Platform Governance",
    "Operating rules, dual-model consensus requirements, rate limits, and service boundaries.",
    content
  );
}

/**
 * About Page detailing the full technical architecture, model pool mechanics, and infrastructure.
 */
export function getAboutHtml(): string {
  const content = `
    <h2>1. Mission & System Philosophy</h2>
    <p>
      ShunopsAI is a <strong>self-healing, multi-provider autonomous operations platform</strong> designed to unite edge computing, multi-cloud redundancy, and generative AI reasoning. It eliminates single-point-of-failure vulnerabilities in AI pipelines by orchestrating seamless failover cascades across independent model architectures and hardware accelerators.
    </p>

    <h2>2. Technical Infrastructure Stack</h2>
    <div class="callout-box">
      <ul style="margin:0; padding-left:16px;">
        <li><strong>Compute Runtime:</strong> Node.js 20 LTS running Fastify v5 on Google Cloud Run (<span class="code-tag">asia-south1</span>) with auto-scaling to zero.</li>
        <li><strong>Database Layer:</strong> Neon Serverless PostgreSQL with WebSocket connection pooling and instant branch-first staging.</li>
        <li><strong>In-Memory Cache &amp; Distributed Quota:</strong> Redis 7 running on Oracle Cloud Infrastructure (OCI) Compute with AES-authenticated persistent pipes.</li>
        <li><strong>Edge &amp; Bot Defense:</strong> Cloudflare Turnstile bot deterrence, client-side Proof-of-Work SHA-256 HMAC challenges, and Cloudflare Workers global distribution.</li>
      </ul>
    </div>

    <h2>3. AI Model Hierarchy & Fallback Cascade</h2>
    <p>
      All inference paths adhere to the Multi-Provider Fallback Cascade Rule: a failure in any individual provider or model endpoint never terminates an active user session or background audit.
    </p>
    <div class="legal-models-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:14px; margin:20px 0;">
      <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:16px;">
        <h3 style="margin-top:0;">1. Google AI Studio Pool</h3>
        <p style="font-size:13px; color:#cbd5e1; margin-bottom:8px;">
          Primary high-throughput reasoning tier utilizing active non-lite Gemini models:
        </p>
        <ul style="font-size:12px; margin-left:16px; margin-bottom:0;">
          <li><span class="code-tag">gemini-3.8-flash</span> (Primary Active)</li>
          <li><span class="code-tag">gemini-3-flash-preview</span></li>
        </ul>
      </div>

      <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:16px;">
        <h3 style="margin-top:0;">2. Groq LPUs</h3>
        <p style="font-size:13px; color:#cbd5e1; margin-bottom:8px;">
          Ultra-low-latency tensor stream processors specialized for fast tool-calling and AST security audits:
        </p>
        <ul style="font-size:12px; margin-left:16px; margin-bottom:0;">
          <li><span class="code-tag">openai/gpt-oss-120b</span> (120B AST Reasoning)</li>
          <li><span class="code-tag">qwen/qwen3.8-27b</span> (Fast Tool Calling)</li>
        </ul>
      </div>

      <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:16px;">
        <h3 style="margin-top:0;">3. OpenRouter Heavyweights</h3>
        <p style="font-size:13px; color:#cbd5e1; margin-bottom:8px;">
          High-capacity fallback chain supporting massive context windows:
        </p>
        <ul style="font-size:12px; margin-left:16px; margin-bottom:0;">
          <li><span class="code-tag">nvidia/nemotron-3-ultra-550b-a55b:free</span></li>
          <li><span class="code-tag">meta-llama/llama-3.3-70b-instruct:free</span></li>
          <li><span class="code-tag">cohere/north-mini-code:free</span></li>
        </ul>
      </div>
    </div>

    <h2>4. Multi-Service API Key Pool Anti-Contention Invariant</h2>
    <p>
      When multiple distributed services (<span class="code-tag">SaralGati</span>, <span class="code-tag">Kanban Cloud</span>, <span class="code-tag">ShunopsAI</span>) share the centralized master 34-key pool, contention is eliminated via:
    </p>
    <ul>
      <li><strong>Startup Offset Permutation:</strong> Each runner instance generates a randomized startup offset upon initialization, guaranteeing different services begin at distinct indices.</li>
      <li><strong>Zero-Latency O(1) Round-Robin:</strong> Pointer advancement strictly executes in O(1) constant time (<span class="code-tag">(index + 1) % keys.length</span>) with zero runtime array shuffling or sorting on hot query paths.</li>
      <li><strong>Instant 429 Pointer Bumping:</strong> Upon encountering any HTTP 429 rate limit, the pointer immediately advances to the next key before model fallback.</li>
    </ul>

    <h2>5. Autonomous Cloud Sentinel &amp; Video Pipeline</h2>
    <p>
      In addition to conversational AI, ShunopsAI orchestrates:
    </p>
    <ul>
      <li><strong>24/7 Service Sentinel:</strong> 12-hour cadence health checks against Cloud Run revisions, Neon databases, and OCI Redis instances, with automatic container reboot triggers upon degraded latency.</li>
      <li><strong>Wan2.1 DiT Video Pipeline:</strong> Automated Kaggle Dual-T4 multi-GPU video synthesis for rendering 1080p educational documentaries with edge voice synthesis and auto-publishing to YouTube.</li>
    </ul>
  `;
  return getLegalPageShell(
    "About ShunopsAI • Architecture & Engineering Specifications",
    "In-depth guide to multi-provider inference, AST consensus, and distributed cloud infrastructure.",
    content
  );
}

