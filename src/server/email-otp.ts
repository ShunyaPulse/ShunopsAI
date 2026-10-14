import crypto from "crypto";
import nodemailer from "nodemailer";
import { neon } from "@neondatabase/serverless";

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  return neon(dbUrl);
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER || "shunyapulse42@gmail.com";
  const pass = process.env.SMTP_PASS || "";

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: true,
      },
    });
    return transporter;
  }
  return null;
}

/**
 * Generate 6-digit cryptographically secure numeric OTP
 */
export function generateNumericOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Send 6-Digit Email OTP to recipient with Neon PostgreSQL persistence
 */
export async function sendEmailOTP(email: string): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const sql = getSql();

  // Rate limit: 1 OTP request per email per 30 seconds
  const recentCheck = await (sql as any).query(
    `SELECT created_at FROM shunops_email_otps 
     WHERE LOWER(email) = $1 AND created_at > NOW() - INTERVAL '30 seconds'
     LIMIT 1;`,
    [cleanEmail]
  );
  if (recentCheck.length > 0) {
    return {
      success: false,
      message: "Please wait 30 seconds before requesting another OTP.",
    };
  }

  const otp = generateNumericOTP();

  // Store in PostgreSQL with 10-minute validity (fail closed if DB persistence fails)
  try {
    await (sql as any).query(
      `INSERT INTO shunops_email_otps (email, otp, attempts, expires_at, used_at, created_at)
       VALUES ($1, $2, 0, NOW() + INTERVAL '10 minutes', NULL, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO UPDATE
       SET otp = $2, attempts = 0, expires_at = NOW() + INTERVAL '10 minutes', used_at = NULL, created_at = CURRENT_TIMESTAMP;`,
      [cleanEmail, otp]
    );
  } catch (dbErr: any) {
    console.warn("[Email OTP DB Save Warning]:", dbErr.message);
    return {
      success: false,
      message: "Could not generate verification code at this time. Please try again.",
    };
  }

  const mailTransporter = getTransporter();
  if (!mailTransporter) {
    return { success: false, message: "Mail server not configured." };
  }

  const fromAddress = process.env.SMTP_FROM || '"ShunopsAI Security" <shunyapulse42@gmail.com>';

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background-color: #0f172a; color: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #38bdf8; font-size: 24px; font-weight: 700; margin: 0;">⚡ ShunopsAI</h2>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 4px;">Security Verification Code</p>
      </div>
      
      <div style="background-color: #1e293b; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; border: 1px solid #334155;">
        <p style="color: #cbd5e1; font-size: 14px; margin-top: 0; margin-bottom: 12px;">Your 6-digit verification code is:</p>
        <div style="font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #10b981; background-color: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #059669; display: inline-block;">
          ${otp}
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 12px; margin-bottom: 0;">Code expires in 10 minutes. Do not share it with anyone.</p>
      </div>

      <p style="color: #64748b; font-size: 11px; text-align: center; margin: 0;">
        If you did not request this verification code, please ignore this email.
      </p>
    </div>
  `;

  try {
    await mailTransporter.sendMail({
      from: fromAddress,
      to: cleanEmail,
      subject: `[ShunopsAI] ${otp} is your verification code`,
      html: htmlContent,
      text: `Your ShunopsAI verification code is: ${otp}. It expires in 10 minutes.`,
    });

    return { success: true, message: "Verification code sent to your email." };
  } catch (err: any) {
    console.error("[Email OTP Send Error]: [REDACTED]");
    return { success: false, message: "Failed to send email OTP. Please check email address." };
  }
}

/**
 * Verify 6-digit Email OTP with grace period and attempt limits
 */
export async function verifyEmailOTP(email: string, code: string): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();

  if (!cleanCode || !/^\d{6}$/.test(cleanCode)) {
    return { success: false, message: "Invalid 6-digit OTP code format." };
  }

  const sql = getSql();

  try {
    // Atomically consume the OTP: this succeeds only when the code matches, has
    // not been used, is unexpired, AND has fewer than 5 failed attempts.
    // Enforcing `attempts < 5` inside the WHERE clause prevents brute-force
    // guessing from succeeding after the account is locked out.
    const consumed = await (sql as any).query(
      `UPDATE shunops_email_otps
       SET used_at = CURRENT_TIMESTAMP
       WHERE LOWER(TRIM(email)) = $1
         AND otp = $2
         AND used_at IS NULL
         AND expires_at > NOW()
         AND COALESCE(attempts, 0) < 5
       RETURNING email;`,
      [cleanEmail, cleanCode]
    );

    if (consumed.length > 0) {
      return { success: true, message: "OTP verified successfully." };
    }

    // Failure path: read the record only to produce an accurate diagnostic.
    const res = await (sql as any).query(
      `SELECT otp, attempts,
              (expires_at < NOW()) AS is_expired,
              (used_at IS NOT NULL) AS is_used
       FROM shunops_email_otps
       WHERE LOWER(TRIM(email)) = $1;`,
      [cleanEmail]
    );

    if (res.length === 0) {
      return { success: false, message: "No OTP was requested for this email. Please request a new code." };
    }

    const record = res[0];

    if (record.is_used) {
      return { success: false, message: "OTP has already been used. Please request a new OTP." };
    }

    if (record.is_expired) {
      return { success: false, message: "OTP has expired. Please request a new OTP." };
    }

    if (record.attempts >= 5) {
      return { success: false, message: "Too many failed attempts. Please request a new OTP." };
    }

    const bumped = await (sql as any).query(
      `UPDATE shunops_email_otps SET attempts = COALESCE(attempts, 0) + 1 WHERE LOWER(TRIM(email)) = $1 RETURNING attempts;`,
      [cleanEmail]
    );
    const newAttempts = bumped[0]?.attempts ?? record.attempts + 1;
    const remaining = Math.max(0, 5 - newAttempts);
    return { success: false, message: `Incorrect verification code. ${remaining} attempt(s) remaining.` };
  } catch (err: any) {
    console.error("[Email OTP Verify Error]: [REDACTED]");
    return { success: false, message: "Verification failed due to a server error." };
  }
}
