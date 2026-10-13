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
// Secrets are encrypted with AES-256-GCM before they are persisted. The UI only
// ever receives a masked hint; plaintext is decrypted on demand for one run.

export type PlatformId = "neon" | "redis" | "github" | "cloudflare";

export interface PlatformFieldSpec {
  key: string;
  label: string;
  /** Rendered as a password input and never echoed back to the client. */
  secret: boolean;
  placeholder: string;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  description: string;
  fields: PlatformFieldSpec[];
}

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  neon: {
    id: "neon",
    label: "Neon Postgres",
    description: "Lets the assistant run read/write SQL in your own Neon database.",
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
    label: "Redis",
    description: "Lets the assistant run data commands against your own Redis instance.",
    fields: [
      { key: "url", label: "Redis URL", secret: true, placeholder: "rediss://default:pass@host:6379" },
    ],
  },
  github: {
    id: "github",
    label: "GitHub",
    description: "Lets the assistant read issues/PRs and open issues/PRs in your repositories.",
    fields: [
      { key: "token", label: "Personal access token", secret: true, placeholder: "ghp_..." },
    ],
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    description: "Lets the assistant run Workers AI inference on your own Cloudflare account.",
    fields: [
      { key: "accountId", label: "Account ID", secret: false, placeholder: "023e105f4ecef8ad9ca31a8372d0c353" },
      { key: "apiToken", label: "API token", secret: true, placeholder: "cf_..." },
    ],
  },
};

export interface PlatformCredentialSummary {
  platform: PlatformId;
  label: string;
  hint: string;
  updatedAt: string;
  /**
   * Field keys actually readable inside the stored secret — not the spec's wish
   * list — so the UI can show a complete/incomplete state.
   */
  fields: string[];
  /** False when the stored payload cannot be decrypted (e.g. after a key rotation). */
  readable: boolean;
}

/** Decrypted credential bundle handed to a single agent run (never persisted). */
export interface PlatformCredentialBundle {
  neon?: { connectionString: string };
  redis?: { url: string };
  github?: { token: string };
  cloudflare?: { accountId: string; apiToken: string };
}

export class CredentialVaultError extends Error {}

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_PREFIX = "v1";

/**
 * Resolve the vault key. `CREDENTIALS_ENCRYPTION_KEY` is preferred (64 hex chars
 * or base64 for a raw 32-byte key); any other passphrase is stretched with
 * scrypt. Falls back through available server secrets (ACTION_SECRET, AUTH_SECRET,
 * ORIGIN_SECRET, GOOGLE_CLIENT_SECRET) before failing closed.
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

  const fallback =
    process.env.ACTION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.ORIGIN_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;

  if (fallback && fallback.trim().length > 0) {
    return crypto.scryptSync(fallback.trim(), "shunops-credential-vault", 32);
  }

  return null;
}

export function isVaultConfigured(): boolean {
  return getEncryptionKey() !== null;
}

function encryptValues(values: Record<string, string>): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new CredentialVaultError(
      "Credential storage is not configured on this server. Set CREDENTIALS_ENCRYPTION_KEY before connecting a platform account."
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(values);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decryptValues(payload: string): Record<string, string> {
  const key = getEncryptionKey();
  if (!key) throw new CredentialVaultError("Credential storage is not configured on this server.");

  const parts = String(payload).split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new CredentialVaultError("Stored credential payload is malformed.");
  }
  const iv = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const data = Buffer.from(parts[3]!, "hex");
  if (tag.length !== 16) {
    throw new CredentialVaultError("Stored credential auth tag is invalid.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
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
  return (PLATFORM_SPECS as Record<string, PlatformSpec | undefined>)[platform] ?? null;
}

/**
 * Describe a stored payload without revealing it: which spec fields it actually
 * holds, and whether this server can decrypt it at all. A row that fails to
 * decrypt is reported as unreadable instead of silently looking healthy.
 */
function inspectStoredPayload(
  platform: string,
  payload: string
): { fields: string[]; readable: boolean } {
  const spec = getPlatformSpec(platform);
  if (!spec) return { fields: [], readable: false };

  try {
    const values = decryptValues(payload);
    const fields = spec.fields
      .map((field) => field.key)
      .filter((key) => {
        const value = values[key];
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
    const raw = values?.[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      throw new CredentialVaultError(`${field.label} is required for ${spec.label}.`);
    }
    normalized[field.key] = value;
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
  const payload = encryptValues(normalized);
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
      fields: spec.fields.map((f) => f.key),
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
    fields: spec.fields.map((f) => f.key),
    readable: true,
  };
}

export async function listUserPlatformCredentials(userId: number): Promise<PlatformCredentialSummary[]> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.platformCredentials.values())
      .filter((c) => c.userId === userId)
      .map((c) => {
        const stored = inspectStoredPayload(c.platform, c.payload);
        return {
          platform: c.platform as PlatformId,
          label: c.label ?? "",
          hint: c.hint,
          updatedAt: c.updatedAt,
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
    const stored = inspectStoredPayload(row.platform, String(row.secret_payload ?? ""));
    return {
      platform: row.platform as PlatformId,
      label: row.label ?? "",
      hint: row.secret_hint ?? "",
      updatedAt: row.updated_at ?? "",
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

  const rows: Array<{ platform: string; payload: string }> = [];
  const sql = getSql();
  if (!sql) {
    for (const record of memStore.platformCredentials.values()) {
      if (record.userId === userId) rows.push({ platform: record.platform, payload: record.payload });
    }
  } else {
    const result = await (sql as any).query(
      `SELECT platform, secret_payload AS payload FROM shunops_user_platform_credentials WHERE user_id = $1;`,
      [userId]
    );
    rows.push(...(result || []));
  }

  for (const row of rows) {
    try {
      const payload = row.payload || (row as any).secret_payload;
      const values = decryptValues(payload);
      switch (row.platform) {
        case "neon":
          if (values.connectionString) bundle.neon = { connectionString: values.connectionString };
          break;
        case "redis":
          if (values.url) bundle.redis = { url: values.url };
          break;
        case "github":
          if (values.token) bundle.github = { token: values.token };
          break;
        case "cloudflare":
          if (values.accountId && values.apiToken) {
            bundle.cloudflare = { accountId: values.accountId, apiToken: values.apiToken };
          }
          break;
      }
    } catch (err: any) {
      console.warn(`[Vault] Could not decrypt ${row.platform} credential for user ${userId}:`, err?.message || err);
    }
  }

  return bundle;
}
