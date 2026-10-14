import crypto from "crypto";
import { getSql, memStore } from "./store.js";

// ==========================================
// PER-USER PLATFORM CREDENTIALS (TENANT VAULT)
// ==========================================
//
// A user's own Neon / Redis / GitHub / Cloudflare credential. Agent tools run
// with THESE, never with the operator's server credentials, so a task started
// by a customer can only ever touch the customer's own account.
//
// Secrets are encrypted with AES-256-GCM before they are persisted, with the
// owning `(userId, platform)` pair bound into the GCM Additional Authenticated
// Data (AAD) so ciphertext from one tenant row can never be transplanted to
// another tenant or platform row.

export type PlatformId = "neon" | "redis" | "github" | "cloudflare" | "brave" | "tavily" | "gcp" | "supabase" | "upstash" | "local_bridge" | "mcp" | string;

export type PlatformTier = "native" | "local_bridge" | "mcp";

export interface PlatformFieldSpec {
  key: string;
  label: string;
  /** Rendered as a password input and never echoed back to the client. */
  secret: boolean;
  placeholder: string;
  optional?: boolean;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  description: string;
  tier: PlatformTier;
  fields: PlatformFieldSpec[];
}

export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  // ── Tier 1: Direct Native Drivers (Zero-Daemon, Direct APIs) ──
  neon: {
    id: "neon",
    label: "Neon Postgres",
    description: "Lets the assistant run read/write SQL queries in your Neon serverless database.",
    tier: "native",
    fields: [
      {
        key: "connectionString",
        label: "Connection string",
        secret: true,
        placeholder: "postgresql://user:pass@ep-xxx.neon.tech/dbname",
      },
    ],
  },
  redis: {
    id: "redis",
    label: "Redis Cache & Store",
    description: "Lets the assistant execute in-memory cache and data commands against Redis.",
    tier: "native",
    fields: [
      { key: "url", label: "Redis URL", secret: true, placeholder: "rediss://default:pass@host:6379" },
    ],
  },
  github: {
    id: "github",
    label: "GitHub",
    description: "Lets the assistant read issues/PRs and open issues/PRs in your repositories.",
    tier: "native",
    fields: [
      { key: "token", label: "Personal access token", secret: true, placeholder: "ghp_..." },
    ],
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    description: "Lets the assistant run Workers AI inference on your own Cloudflare account.",
    tier: "native",
    fields: [
      { key: "accountId", label: "Account ID", secret: false, placeholder: "023e105f4ecef8ad9ca31a8372d0c353" },
      { key: "apiToken", label: "API token", secret: true, placeholder: "cf_..." },
    ],
  },
  brave: {
    id: "brave",
    label: "Brave Web Search",
    description: "Lets the assistant perform live internet search and documentation lookup via Brave Search API.",
    tier: "native",
    fields: [
      { key: "apiKey", label: "Brave API Key", secret: true, placeholder: "BSA..." },
    ],
  },
  tavily: {
    id: "tavily",
    label: "Tavily AI Search",
    description: "Lets the assistant execute agentic research queries with direct citations via Tavily API.",
    tier: "native",
    fields: [
      { key: "apiKey", label: "Tavily API Key", secret: true, placeholder: "tvly-..." },
    ],
  },
  gcp: {
    id: "gcp",
    label: "Google Cloud Platform (GCP)",
    description: "Lets the assistant inspect Cloud Run services, query BigQuery, and read Cloud Logging.",
    tier: "native",
    fields: [
      { key: "projectId", label: "GCP Project ID", secret: false, placeholder: "my-gcp-project" },
      { key: "token", label: "OAuth Access Token / Service Account Key", secret: true, placeholder: "ya29... or Service Account token" },
    ],
  },
  supabase: {
    id: "supabase",
    label: "Supabase Postgres",
    description: "Lets the assistant execute read/write database queries directly in your Supabase project.",
    tier: "native",
    fields: [
      { key: "connectionString", label: "Connection URI", secret: true, placeholder: "postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres" },
    ],
  },
  upstash: {
    id: "upstash",
    label: "Upstash Serverless Redis",
    description: "Lets the assistant execute Redis commands over low-latency HTTPS REST API.",
    tier: "native",
    fields: [
      { key: "url", label: "Upstash REST URL", secret: false, placeholder: "https://xxx.upstash.io" },
      { key: "token", label: "Upstash REST Token", secret: true, placeholder: "AX..." },
    ],
  },

  // ── Tier 2: Self-Hosted / Local Bridge (Localhost, On-Prem, Private VPC) ──
  local_bridge: {
    id: "local_bridge",
    label: "Self-Hosted / Local Bridge",
    description: "Connect to a bridge running on your machine (e.g. Docker daemon, Local SQLite, Local Git, Ollama) on http://127.0.0.1:8000/sse.",
    tier: "local_bridge",
    fields: [
      { key: "bridgeUrl", label: "Local Bridge URL", secret: false, placeholder: "http://127.0.0.1:8000/sse or http://localhost:8000" },
      { key: "apiKey", label: "Local Auth Token (Optional)", secret: true, placeholder: "Optional secret token", optional: true },
    ],
  },

  // ── Tier 3: Remote Cloud Model Context Protocol (MCP) ──
  mcp: {
    id: "mcp",
    label: "Model Context Protocol (Remote MCP)",
    description: "Connect any remote or cloud-hosted MCP server to dynamically discover and run custom external tools.",
    tier: "mcp",
    fields: [
      { key: "serverUrl", label: "Remote MCP Server URL", secret: false, placeholder: "https://your-mcp-server.com/sse or http://127.0.0.1:8000" },
      { key: "apiKey", label: "Authorization Token / Header (Optional)", secret: true, placeholder: "Bearer token or secret key", optional: true },
    ],
  },
};

export interface PlatformCredentialSummary {
  platform: PlatformId;
  label: string;
  hint: string;
  updatedAt: string;
  tier?: PlatformTier | undefined;
  /**
   * Field keys actually readable inside the stored secret — not the spec's wish
   * list — so the UI can show a complete/incomplete state.
   */
  fields: string[];
  /** False when the stored payload cannot be decrypted (e.g. after a key rotation). */
  readable: boolean;
}

export interface McpServerConfigEntry {
  id: string;
  name?: string | undefined;
  serverUrl: string;
  apiKey?: string | undefined;
}

/** Decrypted credential bundle handed to a single agent run (never persisted). */
export interface PlatformCredentialBundle {
  neon?: { connectionString: string };
  redis?: { url: string };
  github?: { token: string };
  cloudflare?: { accountId: string; apiToken: string };
  brave?: { apiKey: string };
  tavily?: { apiKey: string };
  gcp?: { projectId?: string | undefined; token: string };
  supabase?: { connectionString: string };
  upstash?: { url: string; token: string };
  localBridge?: { bridgeUrl: string; apiKey?: string | undefined };
  mcp?: { serverUrl: string; apiKey?: string | undefined };
  mcpServers?: McpServerConfigEntry[];
}

export class CredentialVaultError extends Error {}

const ALGORITHM = "aes-256-gcm";
const LEGACY_ENVELOPE_PREFIX = "v1";
const AAD_ENVELOPE_PREFIX = "v2";

/**
 * Resolve the vault key. `CREDENTIALS_ENCRYPTION_KEY` is preferred (64 hex chars
 * or base64 for a raw 32-byte key); any other passphrase is stretched with
 * scrypt. Falls back only to high-entropy server secrets (ACTION_SECRET, AUTH_SECRET)
 * before failing closed.
 */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (raw && raw.trim().length > 0) {
    const value = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
    const base64 = Buffer.from(value, "base64");
    if (base64.length === 32 && base64.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")) {
      return base64;
    }
    return crypto.scryptSync(value, "shunops-credential-vault", 32);
  }

  const fallback = process.env.ACTION_SECRET || process.env.AUTH_SECRET;

  if (fallback && fallback.trim().length > 0) {
    return crypto.scryptSync(fallback.trim(), "shunops-credential-vault", 32);
  }

  return null;
}

export function isVaultConfigured(): boolean {
  return getEncryptionKey() !== null;
}

function buildVaultAad(userId: number, platform: string): Buffer {
  return Buffer.from(`shunops-vault:${userId}:${platform}`, "utf8");
}

function encryptValues(values: Record<string, string>, userId: number, platform: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new CredentialVaultError(
      "Credential storage is not configured on this server. Set CREDENTIALS_ENCRYPTION_KEY before connecting a platform account."
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(buildVaultAad(userId, platform));
  const plaintext = JSON.stringify(values);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [AAD_ENVELOPE_PREFIX, iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decryptValues(payload: string, userId: number, platform: string): Record<string, string> {
  const key = getEncryptionKey();
  if (!key) throw new CredentialVaultError("Credential storage is not configured on this server.");

  const parts = String(payload).split(":");
  if (parts.length !== 4 || (parts[0] !== AAD_ENVELOPE_PREFIX && parts[0] !== LEGACY_ENVELOPE_PREFIX)) {
    throw new CredentialVaultError("Stored credential payload is malformed.");
  }
  const version = parts[0];
  const iv = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const data = Buffer.from(parts[3]!, "hex");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new CredentialVaultError("Stored credential IV or auth tag is invalid.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  if (version === AAD_ENVELOPE_PREFIX) {
    decipher.setAAD(buildVaultAad(userId, platform));
  }
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

/** Mask a secret for display: keep a 4-char tail so users can sanity-check it. */
function buildHint(spec: PlatformSpec, values: Record<string, string>): string {
  const primary = spec.fields.find((f) => f.secret) ?? spec.fields[0];
  if (!primary) return "";
  const value = values[primary.key] || "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function getPlatformSpec(platform: string): PlatformSpec | null {
  if (platform === "local_bridge" || platform.startsWith("local_bridge:")) {
    const base = PLATFORM_SPECS.local_bridge;
    if (!base) return null;
    return {
      id: platform,
      label: base.label,
      description: base.description,
      tier: base.tier,
      fields: base.fields,
    };
  }
  if (platform === "mcp" || platform.startsWith("mcp:")) {
    const base = PLATFORM_SPECS.mcp;
    if (!base) return null;
    return {
      id: platform,
      label: base.label,
      description: base.description,
      tier: base.tier,
      fields: base.fields,
    };
  }
  return PLATFORM_SPECS[platform] ?? null;
}

/**
 * Describe a stored payload without revealing it: which spec fields it actually
 * holds, and whether this server can decrypt it at all. A row that fails to
 * decrypt is reported as unreadable instead of silently looking healthy.
 */
function inspectStoredPayload(
  userId: number,
  platform: string,
  payload: string
): { fields: string[]; readable: boolean } {
  const spec = getPlatformSpec(platform);
  if (!spec) return { fields: [], readable: false };

  try {
    const values = decryptValues(payload, userId, platform);
    const fields = spec.fields
      .map((field) => field.key)
      .filter((key) => {
        const value =
          values[key] ??
          (key === "serverUrl" ? values.bridgeUrl : key === "bridgeUrl" ? values.serverUrl : undefined);
        return typeof value === "string" && value.trim().length > 0;
      });
    return { fields, readable: true };
  } catch {
    return { fields: [], readable: false };
  }
}

/** Validate that every non-optional field is present before storing. */
function normalizeValues(spec: PlatformSpec, values: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const field of spec.fields) {
    let raw = values?.[field.key];
    // Allow seamless interop between `bridgeUrl` and `serverUrl` for Local Bridge & MCP presets
    if (raw === undefined && field.key === "serverUrl" && typeof values?.bridgeUrl === "string") {
      raw = values.bridgeUrl;
    } else if (raw === undefined && field.key === "bridgeUrl" && typeof values?.serverUrl === "string") {
      raw = values.serverUrl;
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value && !field.optional) {
      throw new CredentialVaultError(`${field.label} is required for ${spec.label}.`);
    }
    if (value) {
      normalized[field.key] = value;
    }
  }
  return normalized;
}

export async function upsertUserPlatformCredential(
  userId: number,
  platform: string,
  values: Record<string, unknown>,
  label?: string
): Promise<PlatformCredentialSummary> {
  const spec = getPlatformSpec(platform);
  if (!spec) throw new CredentialVaultError(`Unknown platform "${platform}".`);

  const normalized = normalizeValues(spec, values);
  const payload = encryptValues(normalized, userId, spec.id);
  const hint = buildHint(spec, normalized);
  const cleanLabel = (label || spec.label).trim().slice(0, 64);

  const sql = getSql();
  if (!sql) {
    const key = `${userId}:${spec.id}`;
    const existing = memStore.platformCredentials.get(key);
    const now = new Date().toISOString();
    const record = {
      id: existing?.id ?? memStore.nextCredentialId++,
      userId,
      platform: spec.id,
      label: cleanLabel,
      hint,
      payload,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    memStore.platformCredentials.set(key, record);
    return {
      platform: spec.id,
      label: record.label,
      hint: record.hint,
      updatedAt: record.updatedAt,
      tier: spec.tier,
      fields: Object.keys(normalized),
      readable: true,
    };
  }

  const rows = await (sql as any).query(
    `INSERT INTO shunops_user_platform_credentials (user_id, platform, label, secret_hint, secret_payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, platform) DO UPDATE
       SET label = EXCLUDED.label,
           secret_hint = EXCLUDED.secret_hint,
           secret_payload = EXCLUDED.secret_payload,
           updated_at = CURRENT_TIMESTAMP
     RETURNING updated_at;`,
    [userId, spec.id, cleanLabel, hint, payload]
  );

  return {
    platform: spec.id,
    label: cleanLabel,
    hint,
    updatedAt: rows?.[0]?.updated_at ?? new Date().toISOString(),
    tier: spec.tier,
    fields: Object.keys(normalized),
    readable: true,
  };
}

export async function listUserPlatformCredentials(userId: number): Promise<PlatformCredentialSummary[]> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.platformCredentials.values())
      .filter((c) => c.userId === userId)
      .map((c) => {
        const stored = inspectStoredPayload(userId, c.platform, c.payload);
        const spec = getPlatformSpec(c.platform);
        return {
          platform: c.platform as PlatformId,
          label: c.label ?? "",
          hint: c.hint,
          updatedAt: c.updatedAt,
          tier: spec?.tier,
          fields: stored.fields,
          readable: stored.readable,
        };
      });
  }

  const rows = await (sql as any).query(
    `SELECT platform, label, secret_hint, updated_at, secret_payload FROM shunops_user_platform_credentials WHERE user_id = $1 ORDER BY platform;`,
    [userId]
  );

  return (rows || []).map((row: any) => {
    const stored = inspectStoredPayload(userId, row.platform, String(row.secret_payload ?? ""));
    const spec = getPlatformSpec(row.platform);
    return {
      platform: row.platform as PlatformId,
      label: row.label ?? "",
      hint: row.secret_hint ?? "",
      updatedAt: row.updated_at ?? "",
      tier: spec?.tier,
      fields: stored.fields,
      readable: stored.readable,
    };
  });
}

export async function deleteUserPlatformCredential(userId: number, platform: string): Promise<boolean> {
  const spec = getPlatformSpec(platform);
  if (!spec) return false;

  const sql = getSql();
  if (!sql) {
    return memStore.platformCredentials.delete(`${userId}:${spec.id}`);
  }

  const result = await (sql as any).query(
    `DELETE FROM shunops_user_platform_credentials WHERE user_id = $1 AND platform = $2 RETURNING id;`,
    [userId, spec.id]
  );
  return result.length > 0;
}

/**
 * Decrypt every credential this user has connected, for one agent run. Rows that
 * fail to decrypt are skipped (e.g. after a key rotation) instead of aborting
 * the whole run; the affected tool then reports "not connected".
 */
export async function getUserCredentialBundle(userId: number): Promise<PlatformCredentialBundle> {
  const bundle: PlatformCredentialBundle = {};
  const mcpServers: McpServerConfigEntry[] = [];

  const rows: Array<{ platform: string; label?: string | undefined; payload: string }> = [];
  const sql = getSql();
  if (!sql) {
    for (const record of memStore.platformCredentials.values()) {
      if (record.userId === userId) rows.push({ platform: record.platform, label: record.label || undefined, payload: record.payload });
    }
  } else {
    const result = await (sql as any).query(
      `SELECT platform, label, secret_payload AS payload FROM shunops_user_platform_credentials WHERE user_id = $1;`,
      [userId]
    );
    rows.push(...(result || []));
  }

  for (const row of rows) {
    try {
      const payload = row.payload || (row as any).secret_payload;
      const values = decryptValues(payload, userId, row.platform);
      if (row.platform === "neon") {
        if (values.connectionString) bundle.neon = { connectionString: values.connectionString };
      } else if (row.platform === "redis") {
        if (values.url) bundle.redis = { url: values.url };
      } else if (row.platform === "github") {
        if (values.token) bundle.github = { token: values.token };
      } else if (row.platform === "cloudflare") {
        if (values.accountId && values.apiToken) {
          bundle.cloudflare = { accountId: values.accountId, apiToken: values.apiToken };
        }
      } else if (row.platform === "brave") {
        if (values.apiKey) bundle.brave = { apiKey: values.apiKey };
      } else if (row.platform === "tavily") {
        if (values.apiKey) bundle.tavily = { apiKey: values.apiKey };
      } else if (row.platform === "gcp") {
        if (values.token) bundle.gcp = { projectId: values.projectId, token: values.token };
      } else if (row.platform === "supabase") {
        if (values.connectionString) bundle.supabase = { connectionString: values.connectionString };
      } else if (row.platform === "upstash") {
        if (values.url && values.token) bundle.upstash = { url: values.url, token: values.token };
      } else if (row.platform === "local_bridge" || row.platform.startsWith("local_bridge:")) {
        const bridgeUrl = values.bridgeUrl || values.serverUrl;
        if (bridgeUrl) {
          if (!bundle.localBridge) {
            bundle.localBridge = { bridgeUrl, apiKey: values.apiKey };
          }
          mcpServers.push({
            id: row.platform,
            name: row.label || "Self-Hosted Local Bridge",
            serverUrl: bridgeUrl,
            apiKey: values.apiKey || undefined,
          });
        }
      } else if (row.platform === "mcp" || row.platform.startsWith("mcp:")) {
        const serverUrl = values.serverUrl || values.bridgeUrl;
        if (serverUrl) {
          if (row.platform === "mcp" && !bundle.mcp) {
            bundle.mcp = { serverUrl, apiKey: values.apiKey };
          }
          mcpServers.push({
            id: row.platform,
            name: row.label || row.platform,
            serverUrl,
            apiKey: values.apiKey || undefined,
          });
        }
      }
    } catch (err: any) {
      console.warn("[Vault] Could not decrypt %s credential for user %s:", row.platform, userId, err?.message || err);
    }
  }

  if (mcpServers.length > 0) {
    bundle.mcpServers = mcpServers;
    if (!bundle.mcp && mcpServers[0]) {
      bundle.mcp = { serverUrl: mcpServers[0].serverUrl, apiKey: mcpServers[0].apiKey };
    }
  }

  return bundle;
}
