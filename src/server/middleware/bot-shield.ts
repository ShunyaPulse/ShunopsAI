import crypto from "crypto";

const SECRET = process.env.ACTION_SECRET || process.env.AGENT_API_TOKEN || "shunopsai-shield-master-key-2026";

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
    .createHmac("sha256", SECRET)
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
 * Verify that the puzzle solution provided by the client is mathematically valid
 * and solved within a reasonable timeframe (10 minutes).
 */
export function verifyShieldSolution(
  salt: string,
  timestamp: number,
  targetDifficulty: number,
  signature: string,
  solution: string
): boolean {
  if (!salt || !timestamp || !signature || !solution) return false;

  // Expire challenges older than 10 minutes
  if (Date.now() - timestamp > 10 * 60 * 1000) return false;

  // Verify HMAC signature to prevent client tampering
  const expectedSig = crypto
    .createHmac("sha256", SECRET)
    .update(`${salt}:${timestamp}:${targetDifficulty}`)
    .digest("hex");

  if (expectedSig !== signature) return false;

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
  return hash.startsWith(prefix);
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

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
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
