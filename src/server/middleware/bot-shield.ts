import crypto from "crypto";

const PROCESS_FALLBACK_SECRET = crypto.randomBytes(32).toString("hex");
const SHIELD_TTL_MS = 10 * 60 * 1000;
const MAX_CONSUMED_SALTS = 10_000;

// Bounded replay guard so a solved Proof-of-Work challenge can only be used once
const consumedShieldSalts = new Map<string, number>();

function pruneConsumedSalts(now: number): void {
  if (consumedShieldSalts.size < MAX_CONSUMED_SALTS) return;
  for (const [k, exp] of consumedShieldSalts) {
    if (exp <= now) consumedShieldSalts.delete(k);
  }
  while (consumedShieldSalts.size >= MAX_CONSUMED_SALTS) {
    const oldest = consumedShieldSalts.keys().next().value;
    if (oldest === undefined) break;
    consumedShieldSalts.delete(oldest);
  }
}

function getShieldSecret(): string {
  const secret = process.env.ACTION_SECRET || process.env.AGENT_API_TOKEN;
  if (secret) return secret;
  // Ephemeral per-process CSPRNG secret when unconfigured so signatures cannot be forged offline
  return PROCESS_FALLBACK_SECRET;
}

export interface ShieldChallenge {
  salt: string;
  targetDifficulty: number; // e.g., 2 leading hex zeroes '00'
  timestamp: number;
  signature: string;
}

export interface ShieldSolutionPayload {
  salt: string;
  timestamp: number;
  targetDifficulty: number;
  signature: string;
  solution: string;
}

/**
 * Generate a cryptographically signed puzzle for the client browser.
 * Real browser solves in ~30-50ms via WebCrypto API.
 */
export function generateShieldChallenge(): ShieldChallenge {
  const salt = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now();
  const targetDifficulty = 2; // '00' prefix requirement

  const signature = crypto
    .createHmac("sha256", getShieldSecret())
    .update(`${salt}:${timestamp}:${targetDifficulty}`)
    .digest("hex");

  return {
    salt,
    targetDifficulty,
    timestamp,
    signature,
  };
}

/**
 * Verify that the puzzle solution provided by the client is mathematically valid,
 * solved within a reasonable timeframe (10 minutes), and has not been replayed.
 */
export function verifyShieldSolution(
  salt: string,
  timestamp: number,
  targetDifficulty: number,
  signature: string,
  solution: string
): boolean {
  if (!salt || !timestamp || !signature || !solution) return false;

  const now = Date.now();
  // Expire challenges older than 10 minutes or timestamps in the future
  if (now - timestamp > SHIELD_TTL_MS || timestamp > now + 60_000) return false;

  // Reject replayed challenges
  const existingExp = consumedShieldSalts.get(salt);
  if (existingExp && existingExp > now) return false;

  // Verify HMAC signature to prevent client tampering using constant-time comparison
  const expectedSig = crypto
    .createHmac("sha256", getShieldSecret())
    .update(`${salt}:${timestamp}:${targetDifficulty}`)
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedSig, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return false;
    }
  } catch {
    return false;
  }

  // Verify proof-of-work solution without dynamic String.prototype.repeat (prevents js/resource-exhaustion)
  const hash = crypto
    .createHash("sha256")
    .update(`${salt}:${solution}`)
    .digest("hex");

  const PREFIX_TABLE: Record<number, string> = {
    1: "0",
    2: "00",
    3: "000",
    4: "0000",
    5: "00000",
    6: "000000",
    7: "0000000",
    8: "00000000",
  };

  const prefix = PREFIX_TABLE[targetDifficulty];
  if (!prefix) return false;
  if (!hash.startsWith(prefix)) return false;

  // Consume salt so this solved puzzle cannot be replayed
  pruneConsumedSalts(now);
  consumedShieldSalts.set(salt, timestamp + SHIELD_TTL_MS);
  return true;
}

/**
 * Server-side Cloudflare Turnstile Verification.
 * Hits official Cloudflare /siteverify endpoint.
 */
export async function verifyCloudflareTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // If not configured, pass-through gracefully to fallback on PoW bot-shield
    return true;
  }
  if (!token || typeof token !== "string" || !token.trim()) {
    return false;
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token.trim());
    if (remoteIp && remoteIp !== "unknown" && remoteIp !== "127.0.0.1") {
      formData.append("remoteip", remoteIp);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return Boolean(data.success);
  } catch (err: any) {
    console.warn("Cloudflare Turnstile verification warning: [REDACTED]");
    return false;
  }
}
